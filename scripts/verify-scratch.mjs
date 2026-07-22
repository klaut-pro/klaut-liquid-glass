/**
 * Verify scratch.html shows a visible glass K (not HUD-only).
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleLogs = [];
  const failed = [];
  page.on("console", (m) => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => consoleLogs.push({ type: "pageerror", text: String(e) }));
  page.on("requestfailed", (r) =>
    failed.push({ url: r.url(), error: r.failure()?.errorText }),
  );

  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3500);

  const stats = await page.evaluate(() => {
    const c = document.getElementById("c");
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const ctx = tmp.getContext("2d");
    ctx.drawImage(c, 0, 0);
    const img = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let nonDark = 0;
    let maxLum = 0;
    // Sample center band (where K should sit), skip HUD corner
    for (let y = 120; y < tmp.height - 40; y += 8) {
      for (let x = 380; x < tmp.width - 40; x += 8) {
        const i = (y * tmp.width + x) * 4;
        const lum = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        if (lum > maxLum) maxLum = lum;
        if (lum > 40) nonDark++;
      }
    }
    return {
      badge: document.getElementById("stageBadge")?.textContent,
      sub: document.querySelector(".sub")?.textContent?.trim()?.slice(0, 80),
      canvas: { w: c.width, h: c.height },
      nonDark,
      maxLum,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });

  const shot = join(outDir, "scratch-verify.png");
  await page.screenshot({ path: shot });
  const report = { url, stats, consoleLogs, failed, shot };
  await writeFile(join(outDir, "scratch-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const ok =
    failed.length === 0 &&
    !consoleLogs.some((l) => l.type === "pageerror" || l.type === "error") &&
    stats.nonDark > 200 &&
    stats.maxLum > 100 &&
    !String(stats.sub || "").includes("Failed to load");
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
