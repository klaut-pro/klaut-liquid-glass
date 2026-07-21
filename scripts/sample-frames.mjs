import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["glyph-chromeSansP.png", "glyph-scriptProP.png"];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage();

for (const name of files) {
  const buf = await readFile(join(root, "demo", "frames", name));
  const b64 = buf.toString("base64");
  const stats = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const sample = (x, y) => {
      const d = g.getImageData(x | 0, y | 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const w = img.width;
    const h = img.height;
    let bright = 0;
    let dark = 0;
    let sum = [0, 0, 0];
    let n = 0;
    const all = g.getImageData(0, 0, w, h).data;
    for (let i = 0; i < all.length; i += 16) {
      const a = all[i + 3];
      if (a < 8) continue;
      n++;
      sum[0] += all[i];
      sum[1] += all[i + 1];
      sum[2] += all[i + 2];
      const luma = 0.2126 * all[i] + 0.7152 * all[i + 1] + 0.0722 * all[i + 2];
      if (luma > 180) bright++;
      if (luma < 40) dark++;
    }
    return {
      w,
      h,
      corner: sample(4, 4),
      mid: sample(w / 2, h / 2),
      upper: sample(w * 0.45, h * 0.32),
      stem: sample(w * 0.38, h * 0.55),
      drip: sample(w * 0.38, h * 0.82),
      opaqueN: n,
      avg: n ? sum.map((v) => Math.round(v / n)) : null,
      brightPct: n ? +(bright / n).toFixed(3) : 0,
      darkPct: n ? +(dark / n).toFixed(3) : 0,
    };
  }, b64);
  console.log(name, JSON.stringify(stats));
}

await browser.close();
