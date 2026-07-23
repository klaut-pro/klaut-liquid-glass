/**
 * Closeups for dual-leg a/k/u pour + o aperture; per-column tipW.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

async function zoomChars(page, chars) {
  await page.evaluate((want) => {
    const cam = window.__scratchCamera;
    const meshes = window.__scratchLetterMeshes;
    const labels = window.__scratch?.letterChars || [];
    const controls = window.__scratchControls;
    const box = new window.THREE.Box3();
    for (let i = 0; i < meshes.length; i++) {
      if (want.includes(labels[i])) box.expandByObject(meshes[i]);
    }
    const c = box.getCenter(new window.THREE.Vector3());
    const size = box.getSize(new window.THREE.Vector3());
    const dist = Math.max(size.x * 1.15, size.y * 2.5, 2.2);
    cam.position.set(c.x, c.y - size.y * 0.05, dist);
    cam.lookAt(c.x, c.y - size.y * 0.28, c.z);
    if (controls) {
      controls.target.set(c.x, c.y - size.y * 0.22, c.z);
      controls.update();
    }
  }, chars);
  await page.waitForTimeout(350);
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
    await page.waitForTimeout(400);
  }

  await zoomChars(page, ["k", "a", "u"]);
  const akuPath = join(outDir, "scratch-honey-aku-closeup.png");
  await page.screenshot({ path: akuPath, fullPage: false });

  await zoomChars(page, ["o"]);
  const oPath = join(outDir, "scratch-honey-o-closeup.png");
  await page.screenshot({ path: oPath, fullPage: false });

  const colMetrics = await page.evaluate(() => {
    const s = window.__scratch;
    const meshes = window.__scratchLetterMeshes;
    const out = [];
    for (let mi = 0; mi < meshes.length; mi++) {
      const ch = s.letterChars?.[mi] ?? "?";
      if (!"akuo".includes(ch)) continue;
      const pos = meshes[mi].geometry.attributes.position.array;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < pos.length; i += 3) {
        minY = Math.min(minY, pos[i]);
        maxY = Math.max(maxY, pos[i]);
      }
      const span = Math.max(maxY - minY, 1e-4);
      const tipBand = minY + span * 0.12;
      const tipXs = [];
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i + 1] <= tipBand) tipXs.push(pos[i]);
      }
      tipXs.sort((a, b) => a - b);
      let gap = 0;
      let split = -1;
      for (let i = 1; i < tipXs.length; i++) {
        const d = tipXs[i] - tipXs[i - 1];
        if (d > gap) {
          gap = d;
          split = i;
        }
      }
      const groups =
        split > 0 && gap > 0.08 ? [tipXs.slice(0, split), tipXs.slice(split)] : [tipXs];
      const tips = groups.map((g) => {
        if (!g.length) return null;
        return {
          tipW: +(g[g.length - 1] - g[0]).toFixed(4),
          n: g.length,
          cx: +((g[0] + g[g.length - 1]) / 2).toFixed(3),
        };
      });
      // o aperture proxy: hole = midX span of inner empty? use mid-band thickness
      let midMinX = Infinity;
      let midMaxX = -Infinity;
      const midLo = minY + span * 0.45;
      const midHi = minY + span * 0.7;
      for (let i = 0; i < pos.length; i += 3) {
        const y = pos[i + 1];
        if (y >= midLo && y <= midHi) {
          midMinX = Math.min(midMinX, pos[i]);
          midMaxX = Math.max(midMaxX, pos[i]);
        }
      }
      out.push({
        ch,
        hang: +span.toFixed(4),
        tipGroups: tips,
        tipSpan: tipXs.length
          ? +(tipXs[tipXs.length - 1] - tipXs[0]).toFixed(4)
          : null,
        gap: +gap.toFixed(4),
        midOuterW: +(midMaxX - midMinX).toFixed(4),
      });
    }
    return out;
  });

  await writeFile(
    join(outDir, "scratch-honey-aku-columns.json"),
    JSON.stringify({ akuPath, oPath, colMetrics }, null, 2),
  );
  console.log(JSON.stringify({ akuPath, oPath, colMetrics }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
