/**
 * Capture chrome/diffraction + drip proof: multi-angle + chroma probe.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";

async function waitReady(page) {
  await page.waitForFunction(
    () => window.__scratch?.ready === true && window.__scratchCamera,
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(2500);
}

async function setView(page, view) {
  return page.evaluate((v) => {
    const cam = window.__scratchCamera;
    const controls = window.__scratchControls;
    if (!cam || !controls) throw new Error("camera/controls missing");
    const target = controls.target.clone();
    if (v === "front") {
      cam.position.set(0, 0.55, 11.5);
      target.y = 0.9;
    } else if (v === "side") {
      cam.position.set(12.5, 1.35, 0.0);
      target.y = 1.2;
    } else if (v === "threeQuarter") {
      cam.position.set(6.5, 1.6, 7.5);
      target.y = 1.0;
    } else if (v === "close") {
      cam.position.set(1.2, 0.8, 4.2);
      target.set(0.2, 0.7, 0);
    }
    controls.target.copy(target);
    cam.lookAt(target);
    controls.update();
    return { view: v, cam: cam.position.toArray(), target: target.toArray() };
  }, view);
}

async function snap(page, outPng) {
  await page.evaluate(
    () =>
      new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      }),
  );
  await page.waitForTimeout(400);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.getElementById("c");
    return canvas ? canvas.toDataURL("image/png") : null;
  });
  if (!dataUrl) throw new Error("no canvas dataUrl");
  await writeFile(outPng, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
  return outPng;
}

async function chromaProbe(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("c");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    // Sample via 2d draw — preserveDrawingBuffer is true
    const c2 = document.createElement("canvas");
    c2.width = canvas.width;
    c2.height = canvas.height;
    const ctx = c2.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c2.width, c2.height);
    let cyan = 0,
      magenta = 0,
      gold = 0,
      bright = 0,
      n = 0;
    // Sample center band where wordmark sits
    const y0 = Math.floor(height * 0.28);
    const y1 = Math.floor(height * 0.72);
    const x0 = Math.floor(width * 0.12);
    const x1 = Math.floor(width * 0.88);
    for (let y = y0; y < y1; y += 3) {
      for (let x = x0; x < x1; x += 3) {
        const i = (y * width + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (a < 8) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max < 40) continue;
        n++;
        const sat = max === 0 ? 0 : (max - min) / max;
        if (max > 160) bright++;
        // cyan: B&G high, R low
        if (b > r + 25 && g > r + 10 && sat > 0.12) cyan++;
        // magenta/pink: R&B high, G lower
        if (r > g + 20 && b > g + 10 && sat > 0.12) magenta++;
        // gold: R&G high, B lower
        if (r > b + 25 && g > b + 10 && sat > 0.12) gold++;
      }
    }
    const fontSel = document.getElementById("fontSelect");
    return {
      samples: n,
      cyan,
      magenta,
      gold,
      bright,
      cyanPct: n ? +(cyan / n).toFixed(4) : 0,
      magentaPct: n ? +(magenta / n).toFixed(4) : 0,
      goldPct: n ? +(gold / n).toFixed(4) : 0,
      metalness: window.__scratch?.materials?.glass?.metalness ?? null,
      fringe: window.__scratch?.fringe ?? null,
      fontId: window.__scratch?.fontId ?? null,
      fontLabel: window.__scratch?.fontLabel ?? fontSel?.selectedOptions?.[0]?.textContent ?? null,
      fonts: [...(fontSel?.options || [])].map((o) => ({ id: o.value, label: o.textContent })),
      softBooleanBake: window.__scratch?.roundness?.softBooleanBake,
      mesh: window.__scratch?.mesh,
    };
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitReady(page);

  const views = [
    ["front", "scratch-drip-bottom-front.png"],
    ["side", "scratch-drip-bottom-side.png"],
    ["threeQuarter", "scratch-drip-bottom-3q.png"],
    ["close", "scratch-chrome-diffraction-close.png"],
  ];
  const shots = [];
  for (const [view, name] of views) {
    const meta = await setView(page, view);
    const path = join(outDir, name);
    await snap(page, path);
    shots.push({ ...meta, path: `demo/frames/${name}` });
    console.log("wrote", path);
  }

  await setView(page, "threeQuarter");
  await page.waitForTimeout(300);
  const chroma = await chromaProbe(page);

  const outJson = join(outDir, "scratch-chrome-drip-proof.json");
  await writeFile(
    outJson,
    JSON.stringify({ url, chroma, shots, probe: await page.evaluate(() => ({
      ready: window.__scratch?.ready,
      stage: document.getElementById("stageBadge")?.textContent,
      gravity: window.__scratch?.gravity,
    })) }, null, 2),
  );
  console.log("chroma", JSON.stringify(chroma, null, 2));
  await browser.close();

  const colorful =
    chroma.cyanPct + chroma.magentaPct + chroma.goldPct > 0.02 ||
    chroma.cyan + chroma.magenta + chroma.gold > 80;
  if (!colorful) {
    console.warn("WARN: low spectral chroma in wordmark band");
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
