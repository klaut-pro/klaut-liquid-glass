/**
 * One-shot: wait for frozen gravity-melt klaut.pro, save scratch-physics-show.png
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

async function main() {
  await mkdir(outDir, { recursive: true });

  const health = await fetch(url);
  console.log("HTTP", health.status, url);
  if (health.status !== 200) {
    throw new Error(`Expected 200, got ${health.status}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.error("PAGEERROR", String(e)));

  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 120000,
  });

  await page.evaluate(() => document.querySelector('[data-stage="5"]')?.click());
  await page.waitForTimeout(400);

  await page
    .waitForFunction(() => window.__scratch?.frozen === true, null, {
      timeout: 25000,
    })
    .catch(() => {});

  const frozen = await page.evaluate(() => window.__scratch?.frozen);
  if (!frozen) {
    await page.evaluate(() => document.getElementById("btnFreeze")?.click());
    await page.waitForTimeout(600);
  }

  await page.waitForTimeout(1000);

  const meta = await page.evaluate(() => {
    const s = window.__scratch;
    return {
      ready: s?.ready,
      frozen: s?.frozen,
      settle: s?.settle,
      wordmark: s?.wordmark,
      dripBlobs: s?.dripBlobs,
      slotCount: s?.slotCount,
      roundness: s?.roundness,
      letterOverrides: s?.letterOverrides,
      badge: document.getElementById("stageBadge")?.textContent,
    };
  });
  console.log("META", JSON.stringify(meta, null, 2));

  const shot = join(outDir, "scratch-physics-show.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("SHOT", shot);
  await browser.close();

  if (!meta.ready || meta.wordmark !== "klaut.pro") {
    process.exit(1);
  }
  console.log("CAPTURE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
