/**
 * Final verify: frozen honey defaults + full + p-closeup vs concept darkness.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

async function measure(page) {
  return page.evaluate(() => {
    const s = window.__scratch;
    const meshes = window.__scratchLetterMeshes;
    if (!meshes?.length) return { error: "no meshes" };
    const letters = [];
    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      const ch = s.letterChars?.[mi] ?? "?";
      const pos = mesh.geometry.attributes.position.array;
      let minY = Infinity,
        maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        minY = Math.min(minY, pos[i]);
        maxY = Math.max(maxY, pos[i]);
      }
      const span = Math.max(maxY - minY, 1e-4);
      const tipBand = minY + span * 0.14;
      const midLo = minY + span * 0.4;
      const midHi = minY + span * 0.55;
      let tipMinX = Infinity,
        tipMaxX = -Infinity,
        midMinX = Infinity,
        midMaxX = -Infinity,
        tipCount = 0;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1],
          x = pos[i];
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
        tipW: +tipW.toFixed(4),
        midW: +midW.toFixed(4),
        bulbRatio: midW > 1e-4 ? +(tipW / midW).toFixed(3) : null,
        hang: +span.toFixed(4),
      });
    }
    const ratios = letters.map((l) => l.bulbRatio).filter((r) => r != null);
    return {
      letters,
      meanBulbRatio: ratios.length
        ? +(ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(3)
        : 0,
      bulbsOver13: ratios.filter((r) => r >= 1.3).length,
      frozen: s.frozen,
      params: {
        gravity: s.gravity,
        viscosity: s.viscosity,
        freezeHeight: s.freezeHeight,
      },
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 180000,
  });
  await page.evaluate(() => document.querySelector('[data-stage="5"]')?.click());
  await page
    .waitForFunction(() => window.__scratch?.frozen === true, null, { timeout: 45000 })
    .catch(() => {});
  if (!(await page.evaluate(() => window.__scratch?.frozen))) {
    await page.evaluate(() => document.getElementById("btnFreeze")?.click());
    await page.waitForTimeout(500);
  }

  // Full framing
  await page.evaluate(() => {
    const cam = window.__scratchCamera;
    const meshes = window.__scratchLetterMeshes;
    const controls = window.__scratchControls;
    if (!cam || !meshes?.length) return;
    const box = new window.THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    const c = box.getCenter(new window.THREE.Vector3());
    const size = box.getSize(new window.THREE.Vector3());
    const dist = Math.max(size.x * 0.85, size.y * 2.2, 6);
    cam.position.set(c.x, c.y + size.y * 0.05, dist);
    cam.lookAt(c.x, c.y - size.y * 0.15, c.z);
    if (controls) {
      controls.target.set(c.x, c.y - size.y * 0.2, c.z);
      controls.update();
    }
  });
  await page.waitForTimeout(400);
  const full = join(outDir, "scratch-honey-final.png");
  await page.screenshot({ path: full, fullPage: false });

  // p closeup
  await page.evaluate(() => {
    const cam = window.__scratchCamera;
    const meshes = window.__scratchLetterMeshes;
    const chars = window.__scratch?.letterChars || [];
    const controls = window.__scratchControls;
    let idx = chars.indexOf("p");
    if (idx < 0) idx = chars.indexOf("k");
    if (idx < 0) idx = 0;
    const mesh = meshes[idx];
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox.clone();
    bb.applyMatrix4(mesh.matrixWorld);
    const c = bb.getCenter(new window.THREE.Vector3());
    const size = bb.getSize(new window.THREE.Vector3());
    cam.position.set(c.x + size.x * 0.2, c.y - size.y * 0.15, Math.max(size.y * 2.6, 1.6));
    cam.lookAt(c.x, c.y - size.y * 0.35, c.z);
    if (controls) {
      controls.target.set(c.x, c.y - size.y * 0.3, c.z);
      controls.update();
    }
  });
  await page.waitForTimeout(350);
  const closeup = join(outDir, "scratch-honey-final-closeup.png");
  await page.screenshot({ path: closeup, fullPage: false });

  const metrics = await measure(page);
  await writeFile(join(outDir, "scratch-honey-final.json"), JSON.stringify(metrics, null, 2));

  // Side-by-side evidence: copy a concept ref next to final
  try {
    await copyFile(
      join(
        "C:/Users/Julian/Documents/Programming/klaut.pro/concept_art/1c6PD.jpg",
      ),
      join(outDir, "concept-ref-1c6PD.jpg"),
    );
    await copyFile(
      join(
        "C:/Users/Julian/Documents/Programming/klaut.pro/concept_art/EL2Hz.jpg",
      ),
      join(outDir, "concept-ref-EL2Hz.jpg"),
    );
  } catch (_) {}

  console.log(JSON.stringify({ full, closeup, metrics }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
