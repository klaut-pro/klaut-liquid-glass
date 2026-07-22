/**
 * Zoom on k/p tips after freeze — prove honey pendant bulbs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 120000,
  });
  await page.evaluate(() => document.querySelector('[data-stage="5"]')?.click());
  await page
    .waitForFunction(() => window.__scratch?.frozen === true, null, {
      timeout: 25000,
    })
    .catch(() => {});
  if (!(await page.evaluate(() => window.__scratch?.frozen))) {
    await page.evaluate(() => document.getElementById("btnFreeze")?.click());
    await page.waitForTimeout(500);
  }

  const metrics = await page.evaluate(() => {
    const THREE = window.THREE;
    const s = window.__scratch;
    const root = window.__scratchLetterRoot;
    // Fallback: search scene via exposed hooks
    const meshes = window.__scratchLetterMeshes;
    if (!meshes?.length) {
      return { error: "no meshes exposed", scratch: !!s };
    }
    const out = [];
    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      const ch = s.letterChars?.[mi] ?? "?";
      const pos = mesh.geometry.attributes.position.array;
      const base = mesh.userData.basePos;
      let minY = Infinity;
      let maxY = -Infinity;
      let tipXs = [];
      let midXs = [];
      let tipCount = 0;
      // world-ish local: find Y span of deformed
      for (let i = 1; i < pos.length; i += 3) {
        minY = Math.min(minY, pos[i]);
        maxY = Math.max(maxY, pos[i]);
      }
      const span = Math.max(maxY - minY, 1e-4);
      const tipBand = minY + span * 0.12;
      const midLo = minY + span * 0.35;
      const midHi = minY + span * 0.55;
      let tipMinX = Infinity,
        tipMaxX = -Infinity;
      let midMinX = Infinity,
        midMaxX = -Infinity;
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
      out.push({
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
    return { letters: out, viscosity: s.viscosity, bulb: s.roundness };
  });

  // Expose meshes if missing — zoom camera via page
  await page.evaluate(() => {
    const cam = window.__scratchCamera;
    const meshes = window.__scratchLetterMeshes;
    if (!cam || !meshes?.length) return;
    // Focus on 'p' (index of p in klaut.pro)
    const chars = window.__scratch?.letterChars || [];
    let idx = chars.indexOf("p");
    if (idx < 0) idx = 0;
    const mesh = meshes[idx];
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox.clone();
    bb.applyMatrix4(mesh.matrixWorld);
    const c = bb.getCenter(new window.THREE.Vector3());
    const size = bb.getSize(new window.THREE.Vector3());
    cam.position.set(c.x + size.x * 0.2, c.y - size.y * 0.15, Math.max(size.y * 2.2, 1.4));
    cam.lookAt(c.x, c.y - size.y * 0.25, c.z);
    cam.updateProjectionMatrix();
  });
  await page.waitForTimeout(400);

  const shot = join(outDir, "scratch-honey-closeup.png");
  await page.screenshot({ path: shot, fullPage: false });
  const metaPath = join(outDir, "scratch-honey-metrics.json");
  await writeFile(metaPath, JSON.stringify(metrics, null, 2));
  console.log("METRICS", JSON.stringify(metrics, null, 2));
  console.log("SHOT", shot);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
