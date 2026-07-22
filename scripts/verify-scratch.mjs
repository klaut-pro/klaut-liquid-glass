/**
 * Verify scratch.html shows a readable glass "klaut.pro" wordmark (not HUD-only).
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  const consoleLogs = [];
  const failed = [];
  page.on("console", (m) => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => consoleLogs.push({ type: "pageerror", text: String(e) }));
  page.on("requestfailed", (r) =>
    failed.push({ url: r.url(), error: r.failure()?.errorText }),
  );

  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => {
    const c = document.getElementById("c");
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, tmp.width, tmp.height).data;

    // Horizontal luminance profile across mid band — wordmark should modulate
    // brightness across a wide span (not a single letter blob).
    const y0 = Math.floor(tmp.height * 0.28);
    const y1 = Math.floor(tmp.height * 0.72);
    const x0 = Math.floor(tmp.width * 0.08);
    const x1 = Math.floor(tmp.width * 0.92);
    const cols = 48;
    const colW = (x1 - x0) / cols;
    const colAvg = new Array(cols).fill(0);
    const colCount = new Array(cols).fill(0);
    let nonDark = 0;
    let maxLum = 0;

    for (let y = y0; y < y1; y += 4) {
      for (let x = x0; x < x1; x += 4) {
        const i = (y * tmp.width + x) * 4;
        const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        if (lum > maxLum) maxLum = lum;
        if (lum > 45) nonDark++;
        const ci = Math.min(cols - 1, Math.floor((x - x0) / colW));
        colAvg[ci] += lum;
        colCount[ci]++;
      }
    }
    for (let i = 0; i < cols; i++) {
      colAvg[i] = colCount[i] ? colAvg[i] / colCount[i] : 0;
    }
    const mean = colAvg.reduce((a, b) => a + b, 0) / cols;
    const variance =
      colAvg.reduce((a, b) => a + (b - mean) * (b - mean), 0) / cols;
    // Columns with glass highlight / letter body (brighter than wash or darker rim)
    const activeCols = colAvg.filter((v) => Math.abs(v - mean) > 4).length;
    const spanCols = (() => {
      let first = -1;
      let last = -1;
      for (let i = 0; i < cols; i++) {
        if (Math.abs(colAvg[i] - mean) > 3.5) {
          if (first < 0) first = i;
          last = i;
        }
      }
      return first < 0 ? 0 : last - first + 1;
    })();

    const sub = document.querySelector(".sub")?.textContent || "";
    const hint = document.querySelector(".hint")?.textContent || "";
    return {
      badge: document.getElementById("stageBadge")?.textContent,
      sub: sub.trim().slice(0, 120),
      hintHasGlb: hint.includes("wordmark-klaut-pro.glb"),
      hudSaysKlautPro: /klaut\.pro/i.test(sub),
      scratch: window.__scratch || null,
      canvas: { w: c.width, h: c.height },
      nonDark,
      maxLum,
      colVariance: variance,
      activeCols,
      spanCols,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });

  const shot = join(outDir, "scratch-verify.png");
  await page.screenshot({ path: shot });
  const report = { url, stats, consoleLogs, failed, shot };
  await writeFile(join(outDir, "scratch-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const readableWordmark =
    stats.scratch?.wordmark === "klaut.pro" &&
    stats.scratch?.ready === true &&
    stats.hudSaysKlautPro &&
    stats.hintHasGlb &&
    // Wide horizontal occupancy (full word, not single letter)
    stats.spanCols >= 16 &&
    stats.scratch.size?.x > stats.scratch.size?.y * 2.5 &&
    stats.nonDark > 400 &&
    stats.maxLum > 100;

  const ok =
    failed.length === 0 &&
    !consoleLogs.some((l) => l.type === "pageerror" || l.type === "error") &&
    !String(stats.sub || "").includes("Failed to load") &&
    readableWordmark;

  await browser.close();
  if (!ok) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
