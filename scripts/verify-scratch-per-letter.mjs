/**
 * Verify per-letter GravityMeltSim + font picker + roundness (no drip blobs).
 * Usage: node scripts/verify-scratch-per-letter.mjs [url]
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => window.__scratch?.ready === true, null, {
    timeout: 60000,
  });

  // Wait for settle → freeze
  await page.waitForFunction(() => window.__scratch?.frozen === true, null, {
    timeout: 20000,
  }).catch(() => {});

  await page.waitForTimeout(800);

  const mid = await page.evaluate(() => {
    const s = window.__scratch;
    return {
      ready: s?.ready,
      frozen: s?.frozen,
      settle: s?.settle,
      dripBlobs: s?.dripBlobs,
      slotCount: s?.slotCount,
      letterChars: s?.letterChars,
      fontId: s?.fontId,
      fontLabel: s?.fontLabel,
      fonts: s?.fonts,
      roundness: s?.roundness,
      letterOverrides: s?.letterOverrides,
      badge: document.getElementById("stageBadge")?.textContent,
      fontOptions: [...document.querySelectorAll("#fontSelect option")].map(
        (o) => ({ id: o.value, label: o.textContent }),
      ),
      glyphButtons: document.querySelectorAll("#glyphButtons button").length,
    };
  });

  await page.screenshot({
    path: join(outDir, "scratch-per-letter-default.png"),
    fullPage: false,
  });

  // Disable melt on letter 0 (k) and resettle
  await page.evaluate(() => {
    document.querySelector('#glyphButtons button[data-index="0"]')?.click();
    const en = document.getElementById("letterEnable");
    if (en) {
      en.checked = false;
      en.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.getElementById("btnResettle")?.click();
  });
  await page.waitForTimeout(1500);

  const afterDisable = await page.evaluate(() => ({
    overrides: window.__scratch?.letterOverrides,
    frozen: window.__scratch?.frozen,
    settle: window.__scratch?.settle,
  }));

  await page.screenshot({
    path: join(outDir, "scratch-per-letter-k-off.png"),
    fullPage: false,
  });

  // Switch font if Impact available
  const hasImpact = mid.fontOptions.some((f) => f.id === "impact");
  let afterFont = null;
  if (hasImpact) {
    await page.selectOption("#fontSelect", "impact");
    await page.waitForFunction(
      () => window.__scratch?.fontId === "impact" && window.__scratch?.ready === true,
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(2000);
    afterFont = await page.evaluate(() => ({
      fontId: window.__scratch?.fontId,
      fontLabel: window.__scratch?.fontLabel,
      slotCount: window.__scratch?.slotCount,
      dripBlobs: window.__scratch?.dripBlobs,
      mesh: window.__scratch?.mesh,
    }));
    await page.screenshot({
      path: join(outDir, "scratch-per-letter-impact.png"),
      fullPage: false,
    });
  }

  const checks = {
    ready: !!mid.ready,
    stage5: mid.badge === "stage 5",
    dripBlobsZero: mid.dripBlobs === 0,
    nineLetters: mid.slotCount === 9 && mid.glyphButtons === 9,
    charsMatch: Array.isArray(mid.letterChars) && mid.letterChars.join("") === "klaut.pro",
    fontsListed: (mid.fontOptions?.length || 0) >= 3,
    roundnessFlags:
      mid.roundness?.teardrop === true &&
      mid.roundness?.softMinBulb === true &&
      mid.roundness?.taubin === true &&
      mid.roundness?.dripBlobs === 0,
    kDisabled: afterDisable.overrides?.[0]?.enable === false,
    fontSwapOk: !hasImpact || afterFont?.fontId === "impact",
    noPageErrors: errors.length === 0,
  };

  const ok = Object.values(checks).every(Boolean);
  const report = {
    ok,
    url,
    checks,
    mid,
    afterDisable,
    afterFont,
    errors,
    frames: [
      "scratch-per-letter-default.png",
      "scratch-per-letter-k-off.png",
      hasImpact ? "scratch-per-letter-impact.png" : null,
    ].filter(Boolean),
  };

  await writeFile(
    join(outDir, "scratch-per-letter-verify.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
