/**
 * Parameter sweep for GravityMeltSim honey droplets on scratch demo.
 * Captures frozen screenshots + tip/mid bulbRatio metrics per combo.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames", "honey-sweep");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

/** Compact grid aimed at concept_art neck→teardrop bulbs. */
const COMBOS = [
  { id: "A-baseline", gravity: 0.88, freeze: 0.58, visc: 0.86, sag: 1.35, bulbSoft: 1.0, neckMul: 1.45, bulbMul: 2.15 },
  { id: "B-long-hang", gravity: 0.95, freeze: 0.62, visc: 0.9, sag: 1.7, bulbSoft: 1.0, neckMul: 1.55, bulbMul: 2.4 },
  { id: "C-fat-bulb", gravity: 0.85, freeze: 0.55, visc: 0.92, sag: 1.25, bulbSoft: 1.0, neckMul: 1.65, bulbMul: 2.7 },
  { id: "D-thin-neck", gravity: 0.9, freeze: 0.6, visc: 0.78, sag: 1.5, bulbSoft: 0.95, neckMul: 1.85, bulbMul: 2.3 },
  { id: "E-syrup", gravity: 0.82, freeze: 0.5, visc: 0.96, sag: 1.45, bulbSoft: 1.0, neckMul: 1.4, bulbMul: 2.55 },
  { id: "F-concept", gravity: 0.92, freeze: 0.6, visc: 0.88, sag: 1.55, bulbSoft: 1.0, neckMul: 1.7, bulbMul: 2.5 },
];

async function measureBulbs(page) {
  return page.evaluate(() => {
    const s = window.__scratch;
    const meshes = window.__scratchLetterMeshes;
    if (!meshes?.length) return { error: "no meshes", letters: [] };
    const letters = [];
    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      const ch = s.letterChars?.[mi] ?? "?";
      const pos = mesh.geometry.attributes.position.array;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        minY = Math.min(minY, pos[i]);
        maxY = Math.max(maxY, pos[i]);
      }
      const span = Math.max(maxY - minY, 1e-4);
      const tipBand = minY + span * 0.14;
      const midLo = minY + span * 0.38;
      const midHi = minY + span * 0.55;
      let tipMinX = Infinity,
        tipMaxX = -Infinity;
      let midMinX = Infinity,
        midMaxX = -Infinity;
      let tipCount = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        const x = pos[i];
        if (y <= tipBand) {
          tipMinX = Math.min(tipMinX, x);
          tipMaxX = Math.max(tipMaxX, x);
          tipCount++;
        } else if (y >= midLo && y <= midHi) {
          midMinX = Math.min(midMinX, x);
          midMaxX = Math.max(midMaxX, x);
        }
      }
      const tipW = tipMaxX - tipMinX;
      const midW = midMaxX - midMinX;
      letters.push({
        ch,
        tipCount,
        tipW: Number.isFinite(tipW) ? +tipW.toFixed(4) : null,
        midW: Number.isFinite(midW) ? +midW.toFixed(4) : null,
        bulbRatio:
          Number.isFinite(tipW) && Number.isFinite(midW) && midW > 1e-4
            ? +(tipW / midW).toFixed(3)
            : null,
        hang: +span.toFixed(4),
      });
    }
    const ratios = letters.map((l) => l.bulbRatio).filter((r) => r != null && r > 0);
    const mean =
      ratios.length > 0 ? +(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3) : 0;
    const gt13 = ratios.filter((r) => r >= 1.3).length;
    return { letters, meanBulbRatio: mean, bulbsOver13: gt13, n: ratios.length };
  });
}

async function applyCombo(page, combo) {
  await page.evaluate((c) => {
    const set = (id, v, valId) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (valId) {
        const lab = document.getElementById(valId);
        if (lab) lab.textContent = Number(v).toFixed(2);
      }
    };
    set("gravity", c.gravity, "gravityVal");
    set("freezeHeight", c.freeze, "freezeHeightVal");
    set("viscosity", c.visc, "viscosityVal");
    set("sagAmp", c.sag, "sagAmpVal");
    set("bulbSoft", c.bulbSoft, "bulbSoftVal");

    // Patch master multipliers via __scratch + resettle with overridden letter mul
    if (window.__scratch?.letterOverrides) {
      for (const ov of window.__scratch.letterOverrides) {
        if (!ov || ov.enable === false) continue;
        ov.neckPinchMul = c.neckMul;
        ov.bulbGrowMul = Math.max(ov.bulbGrowMul ?? 1, c.bulbMul * 0.85);
        ov.sagAmpMul = Math.max(ov.sagAmpMul ?? 1, c.sag * 0.85);
      }
    }
    document.querySelector('[data-stage="5"]')?.click();
    document.getElementById("btnResettle")?.click();
  }, combo);
}

async function waitFrozen(page) {
  await page
    .waitForFunction(() => window.__scratch?.frozen === true || (window.__scratch?.settle ?? 0) > 0.98, null, {
      timeout: 45000,
    })
    .catch(() => {});
  if (!(await page.evaluate(() => window.__scratch?.frozen))) {
    await page.evaluate(() => document.getElementById("btnFreeze")?.click());
    await page.waitForTimeout(400);
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(120000);

  console.log("Loading", url);
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => document.querySelector('[data-stage="5"]')?.click());

  const results = [];
  for (const combo of COMBOS) {
    console.log("Sweep", combo.id, combo);
    await applyCombo(page, combo);
    await waitFrozen(page);
    await page.waitForTimeout(600);
    const metrics = await measureBulbs(page);
    const shot = join(outDir, `sweep-${combo.id}.png`);
    await page.screenshot({ path: shot, fullPage: false });

    // Close-up on 'p' if present
    await page.evaluate(() => {
      const cam = window.__scratchCamera;
      const meshes = window.__scratchLetterMeshes;
      const chars = window.__scratch?.letterChars || [];
      if (!cam || !meshes?.length) return;
      let idx = chars.indexOf("p");
      if (idx < 0) idx = chars.indexOf("k");
      if (idx < 0) idx = 0;
      const mesh = meshes[idx];
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox.clone();
      bb.applyMatrix4(mesh.matrixWorld);
      const c = bb.getCenter(new window.THREE.Vector3());
      const size = bb.getSize(new window.THREE.Vector3());
      cam.position.set(c.x + size.x * 0.15, c.y - size.y * 0.2, Math.max(size.y * 2.4, 1.5));
      cam.lookAt(c.x, c.y - size.y * 0.3, c.z);
      cam.updateProjectionMatrix();
      if (window.__scratchControls) {
        window.__scratchControls.target.set(c.x, c.y - size.y * 0.25, c.z);
        window.__scratchControls.update();
      }
    });
    await page.waitForTimeout(350);
    const closeup = join(outDir, `sweep-${combo.id}-closeup.png`);
    await page.screenshot({ path: closeup, fullPage: false });

    // Reset camera framing for next full shot
    await page.evaluate(() => {
      document.getElementById("btnResettle")?.click();
    });

    const score =
      (metrics.meanBulbRatio || 0) * 10 + (metrics.bulbsOver13 || 0) * 3;
    results.push({ ...combo, metrics, score, shot, closeup });
    console.log(
      `  meanBulb=${metrics.meanBulbRatio} over1.3=${metrics.bulbsOver13} score=${score.toFixed(2)}`,
    );
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (best) {
    await copyFile(best.shot, join(outDir, "BEST-full.png"));
    await copyFile(best.closeup, join(outDir, "BEST-closeup.png"));
    await copyFile(
      best.shot,
      join(__dirname, "..", "demo", "frames", "scratch-honey-best.png"),
    );
    await copyFile(
      best.closeup,
      join(__dirname, "..", "demo", "frames", "scratch-honey-best-closeup.png"),
    );
  }

  const report = {
    url,
    ranked: results.map((r) => ({
      id: r.id,
      score: r.score,
      meanBulbRatio: r.metrics.meanBulbRatio,
      bulbsOver13: r.metrics.bulbsOver13,
      params: {
        gravity: r.gravity,
        freeze: r.freeze,
        visc: r.visc,
        sag: r.sag,
        bulbSoft: r.bulbSoft,
        neckMul: r.neckMul,
        bulbMul: r.bulbMul,
      },
      letters: r.metrics.letters,
    })),
    best: best
      ? {
          id: best.id,
          score: best.score,
          params: {
            gravity: best.gravity,
            freeze: best.freeze,
            visc: best.visc,
            sag: best.sag,
            bulbSoft: best.bulbSoft,
            neckMul: best.neckMul,
            bulbMul: best.bulbMul,
          },
        }
      : null,
  };
  await writeFile(join(outDir, "sweep-report.json"), JSON.stringify(report, null, 2));
  await writeFile(
    join(__dirname, "..", "demo", "frames", "scratch-honey-sweep.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("BEST", JSON.stringify(report.best, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
