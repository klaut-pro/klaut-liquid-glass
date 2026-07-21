/**
 * Capture glyph QA with SwiftShader-capable Chromium.
 */
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "demo", "frames");
const refsDir = join(root, "demo", "qa-refs");
const conceptDir = join(root, "..", "klaut.pro", "concept_art");
const base = process.argv[2] || "http://localhost:52780";

async function ensureRefs() {
  await mkdir(refsDir, { recursive: true });
  for (const name of ["1c6PD.jpg", "ENj9B.jpg", "Z53Ve.jpg"]) {
    try {
      await copyFile(join(conceptDir, name), join(refsDir, name));
    } catch {
      /* optional */
    }
  }
}

async function main() {
  await ensureRefs();
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("WebGL") || m.text().includes("Shader")) {
      console.log("CONSOLE", m.type(), m.text().slice(0, 240));
    }
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(`${base}/demo/qa.html`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(
    () => typeof window.__lgGlyphCapture === "function",
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  const probe = await page.evaluate(() => {
    const c = document.querySelector("#stage-chromeSansP canvas");
    if (!c) return { err: "no canvas" };
    const off = document.createElement("canvas");
    off.width = c.width;
    off.height = c.height;
    const g = off.getContext("2d");
    g.drawImage(c, 0, 0);
    const mid = g.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
    let nonZero = 0;
    const all = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < all.length; i += 4) if (all[i] > 8) nonZero++;
    return {
      w: c.width,
      h: c.height,
      mid: Array.from(mid),
      nonZero,
      total: c.width * c.height,
    };
  });
  console.log("probe", JSON.stringify(probe));

  const frames = await page.evaluate(async () => {
    if (typeof window.__lgGlyphCapture === "function") {
      return await window.__lgGlyphCapture();
    }
    return {};
  });

  for (const [id, dataUrl] of Object.entries(frames)) {
    if (!dataUrl || typeof dataUrl !== "string") continue;
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await writeFile(join(outDir, `glyph-${id}.png`), Buffer.from(b64, "base64"));
  }

  await page.screenshot({ path: join(outDir, "glyph-qa-full.png"), fullPage: true });
  await writeFile(
    join(outDir, "glyph-qa-meta.json"),
    JSON.stringify(
      {
        targets: ["chromeSansP", "scriptProP"],
        refs: ["1c6PD.jpg", "ENj9B.jpg"],
        probe,
        captured: Object.keys(frames),
        url: `${base}/demo/qa.html`,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  await browser.close();
  console.log("Wrote frames to", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
