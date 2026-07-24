/**
 * Glance-gate capture for scratch look polish.
 * Uses system Chrome (bundled Chromium ICU is broken on this machine).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "demo", "frames");
const url = process.argv[2] || "http://localhost:52780/demo/scratch.html";
const outPng = join(outDir, "scratch-look-after.png");
const outJson = join(outDir, "scratch-look-after.json");

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleLogs = [];
  const failed = [];

  page.on("console", (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("pageerror", (err) => {
    consoleLogs.push({ type: "pageerror", text: String(err) });
  });
  page.on("requestfailed", (req) => {
    failed.push({ url: req.url(), error: req.failure()?.errorText });
  });

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.log("goto", resp?.status());

  // Wait for wordmark meshes / melt apply
  await page.waitForTimeout(5000);

  const probe = await page.evaluate(() => {
    const canvas = document.getElementById("c");
    const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
    const roomLoaded = performance
      .getEntriesByType("resource")
      .some((r) => String(r.name).includes("RoomEnvironment"));
    const softboxWarn = [...document.querySelectorAll("*")].length; // keep probe light
    return {
      canvasW: canvas?.width,
      canvasH: canvas?.height,
      dataUrlLen: dataUrl?.length ?? 0,
      dataUrl,
      roomLoaded,
      stage: document.getElementById("stageBadge")?.textContent ?? null,
      bg: getComputedStyle(document.body).backgroundColor,
      sceneHint: softboxWarn,
    };
  });

  if (probe.dataUrl) {
    const b64 = probe.dataUrl.replace(/^data:image\/png;base64,/, "");
    await writeFile(outPng, Buffer.from(b64, "base64"));
    console.log("wrote", outPng);
  } else {
    console.error("no canvas dataUrl");
  }

  const { dataUrl: _drop, ...meta } = probe;
  await writeFile(
    outJson,
    JSON.stringify(
      {
        url,
        meta,
        consoleErrors: consoleLogs.filter((l) => l.type === "error" || l.type === "pageerror"),
        consoleWarns: consoleLogs.filter((l) => l.type === "warning" || (l.type === "warn")),
        failed,
        softboxFallbackWarn: consoleLogs.some((l) =>
          String(l.text).includes("RoomEnvironment fallback"),
        ),
      },
      null,
      2,
    ),
  );
  console.log("meta", JSON.stringify({ ...meta, dataUrl: undefined }));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
