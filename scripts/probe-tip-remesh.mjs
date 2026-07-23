/**
 * Probe tip-lattice after freeze: tipU counts + tip AABB roundness.
 */
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  await page.waitForTimeout(400);
}

const probe = await page.evaluate(() => {
  const s = window.__scratch;
  const meshes = window.__scratchLetterMeshes;
  const melt = window.__scratchMeltSim;
  const out = {
    roundness: s?.roundness,
    dripBlobs: s?.dripBlobs,
    letters: [],
  };
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const ch = s.letterChars?.[mi] ?? "?";
    const pos = mesh.geometry.attributes.position.array;
    const n = (pos.length / 3) | 0;
    // tipU lives on melt sim slots — expose via scratch if available
    const tipU = mesh.userData.tipU;
    let tipSeed = 0;
    let seedMinY = Infinity,
      seedMaxY = -Infinity,
      seedMinX = Infinity,
      seedMaxX = -Infinity;
    let allMinY = Infinity,
      allMaxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      const x = pos[i * 3];
      allMinY = Math.min(allMinY, y);
      allMaxY = Math.max(allMaxY, y);
      if (tipU && tipU[i] > 0) {
        tipSeed++;
        seedMinY = Math.min(seedMinY, y);
        seedMaxY = Math.max(seedMaxY, y);
        seedMinX = Math.min(seedMinX, x);
        seedMaxX = Math.max(seedMaxX, x);
      }
    }
    const seedH = seedMaxY - seedMinY;
    const seedW = seedMaxX - seedMinX;
    out.letters.push({
      ch,
      vertCount: n,
      tipSeed,
      seedHang: tipSeed ? +seedH.toFixed(4) : 0,
      seedWidth: tipSeed ? +seedW.toFixed(4) : 0,
      seedAspect: tipSeed && seedH > 1e-4 ? +(seedW / seedH).toFixed(3) : null,
      letterHang: +(allMaxY - allMinY).toFixed(4),
      indexCount: mesh.geometry.index?.count ?? null,
    });
  }
  return out;
});

console.log(JSON.stringify(probe, null, 2));
await browser.close();
