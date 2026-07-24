/**
 * Front + side screenshots proving honey drips hang below letter baselines
 * (underside → neck → teardrop), not stuck on the front face.
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
  // Let first frames settle after mesh bind / framing
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
      // Pure +X profile: hang must read under the block (lower Y), not along depth Z
      cam.position.set(12.5, 1.35, 0.0);
      target.y = 1.2;
    } else if (v === "threeQuarter") {
      cam.position.set(6.5, 1.6, 7.5);
      target.y = 1.0;
    }
    controls.target.copy(target);
    cam.lookAt(target);
    controls.update();
    return {
      view: v,
      cam: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target: { x: target.x, y: target.y, z: target.z },
      mesh: window.__scratch?.mesh ?? null,
      verts: window.__scratch?.roundness?.vertexCount ?? null,
      ready: window.__scratch?.ready,
    };
  }, view);
}

async function snap(page, outPng) {
  // Force a few rAF paints after camera move
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
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  await writeFile(outPng, Buffer.from(b64, "base64"));
  return outPng;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleLogs = [];
  page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => consoleLogs.push({ type: "pageerror", text: String(err) }));

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.log("goto", resp?.status(), url);
  await waitReady(page);

  const views = [
    ["front", "scratch-drip-bottom-front.png"],
    ["side", "scratch-drip-bottom-side.png"],
    ["threeQuarter", "scratch-drip-bottom-3q.png"],
  ];
  const shots = [];
  for (const [view, name] of views) {
    const meta = await setView(page, view);
    const path = join(outDir, name);
    await snap(page, path);
    shots.push({ ...meta, path: `demo/frames/${name}` });
    console.log("wrote", path, meta.cam);
  }

  const probe = await page.evaluate(() => ({
    mesh: window.__scratch?.mesh,
    ready: window.__scratch?.ready,
    stage: document.getElementById("stageBadge")?.textContent ?? null,
    gravity: window.__scratch?.gravity,
    softBooleanBake: window.__scratch?.roundness?.softBooleanBake,
    conceptBake: window.__scratch?.roundness?.conceptBake,
  }));

  const outJson = join(outDir, "scratch-drip-bottom-proof.json");
  await writeFile(
    outJson,
    JSON.stringify(
      {
        url,
        probe,
        shots,
        consoleErrors: consoleLogs.filter((l) => l.type === "error" || l.type === "pageerror"),
      },
      null,
      2,
    ),
  );
  console.log("meta", JSON.stringify({ probe, shots: shots.map((s) => s.path) }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
