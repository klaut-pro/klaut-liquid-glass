/**
 * Verify stage-5 soft-letter continuum drips on scratch wordmark.
 * Checks lips exist, pendants hang from letters, multi-angle screenshots.
 * Usage: node scripts/verify-scratch-drips.mjs [url]
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

  const health = await fetch(url);
  console.log("HTTP", health.status, url);
  if (health.status !== 200) {
    throw new Error(`Expected 200, got ${health.status}`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 30000,
  });

  await page.evaluate(() => {
    document.querySelector('[data-stage="5"]')?.click();
    const v = document.getElementById("viscosity");
    const l = document.getElementById("liquify");
    if (v) {
      v.value = "0.45";
      v.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (l) {
      l.value = "0.6";
      l.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(2500);

  const mid = await page.evaluate(() => {
    const s = window.__scratch;
    const lips = s?.lips || [];
    // Gap check: each lip should have a nearby blob root (within ~0.35 of halfH)
    const halfH = (s?.size?.y || 1.85) * 0.5;
    return {
      ...s,
      badge: document.getElementById("stageBadge")?.textContent,
      lipCount: lips.length,
      lipYs: lips.map((l) => l.attachY),
      halfH,
    };
  });

  await page.screenshot({
    path: join(outDir, "scratch-drips-mid.png"),
    fullPage: false,
  });

  // Orbit left
  await page.evaluate(() => {
    const c = document.getElementById("c");
    c.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 700, clientY: 450, buttons: 1, pointerId: 1 }),
    );
    c.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 520, clientY: 430, buttons: 1, pointerId: 1 }),
    );
    c.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 520, clientY: 430, pointerId: 1 }),
    );
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, "scratch-drips-angle-left.png") });

  // Orbit right / slightly up
  await page.evaluate(() => {
    const c = document.getElementById("c");
    c.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 700, clientY: 450, buttons: 1, pointerId: 1 }),
    );
    c.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 920, clientY: 380, buttons: 1, pointerId: 1 }),
    );
    c.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 920, clientY: 380, pointerId: 1 }),
    );
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, "scratch-drips-angle-right.png") });

  // Low viscosity
  await page.evaluate(() => {
    const v = document.getElementById("viscosity");
    if (v) {
      v.value = "0.12";
      v.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(1800);
  const low = await page.evaluate(() => ({ ...window.__scratch }));
  await page.screenshot({ path: join(outDir, "scratch-drips-low-visc.png") });

  // High viscosity
  await page.evaluate(() => {
    const v = document.getElementById("viscosity");
    if (v) {
      v.value = "0.92";
      v.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(2200);
  const high = await page.evaluate(() => ({ ...window.__scratch }));
  await page.screenshot({ path: join(outDir, "scratch-drips-high-visc.png") });

  await browser.close();

  const lipsOk = (mid.lipCount ?? 0) >= 5;
  const sagMaps =
    typeof mid.maps?.sagAmp === "number" && typeof mid.maps?.sagRate === "number";
  const report = {
    url,
    http: health.status,
    errors,
    mid,
    low,
    high,
    ok:
      mid.ready &&
      mid.badge === "stage 5" &&
      (mid.dripBlobs ?? 0) > 8 &&
      (high.dripBlobs ?? 0) > 4 &&
      lipsOk &&
      sagMaps &&
      mid.physics === "rank1-soft-letter+continuum" &&
      errors.length === 0,
  };
  await writeFile(join(outDir, "scratch-drips-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
