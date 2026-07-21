/**
 * Capture demo frames for visual QA (hyperframes stand-in).
 * Usage: node scripts/capture-frames.mjs [baseUrl]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const base = process.argv[2] || "http://localhost:5179";

const COMBOS = [
  "chromeDrip",
  "watery",
  "syrup",
  "muddy_overdisp",
  "clean_pane",
  "orb_film",
  "light_right",
  "light_left",
];

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${base}/demo/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Run in-page sweep if present
  const verdicts = await page.evaluate(async () => {
    if (typeof window.__lgSweep === "function") {
      return await window.__lgSweep();
    }
    return [];
  });

  // Capture pane canvas after each preset button click as backup
  for (const name of COMBOS) {
    const btn = page.locator("#presets button", { hasText: name === "chromeDrip" ? "chromeDrip" : name });
    // presets only have preset names — for combos rely on sweep frames via captureFrame
    void btn;
  }

  // Grab current waitlist canvas
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector("#waitlist canvas");
    return c ? c.toDataURL("image/png") : null;
  });
  if (dataUrl) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await writeFile(join(outDir, "current.png"), Buffer.from(b64, "base64"));
  }

  await page.screenshot({ path: join(outDir, "full-page.png"), fullPage: true });
  await writeFile(join(outDir, "verdicts.json"), JSON.stringify(verdicts, null, 2));
  await browser.close();
  console.log("Wrote frames to", outDir);
  console.log(JSON.stringify(verdicts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
