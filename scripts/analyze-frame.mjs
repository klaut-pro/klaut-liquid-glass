import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const file = process.argv[2] || "demo/frames/glyph-chromeSansP.png";
const buf = readFileSync(file);
const b64 = buf.toString("base64");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="data:image/png;base64,${b64}">`);
await page.waitForTimeout(200);

const info = await page.evaluate(() => {
  const img = document.getElementById("i");
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let bright = 0;
  let dark = 0;
  let mid = 0;
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < c.height; y += 3) {
    for (let x = 0; x < c.width; x += 3) {
      const i = (y * c.width + x) * 4;
      const r = d[i];
      const gv = d[i + 1];
      const bv = d[i + 2];
      const luma = 0.2126 * r + 0.7152 * gv + 0.0722 * bv;
      if (luma > 200) bright++;
      else if (luma < 40) dark++;
      else mid++;
      sum[0] += r;
      sum[1] += gv;
      sum[2] += bv;
      n++;
    }
  }
  const samples = [];
  for (const [fx, fy, lab] of [
    [0.35, 0.3, "bowl"],
    [0.32, 0.55, "stem"],
    [0.32, 0.78, "base"],
    [0.32, 0.9, "tip"],
    [0.05, 0.05, "corner"],
  ]) {
    const x = (c.width * fx) | 0;
    const y = (c.height * fy) | 0;
    const i = (y * c.width + x) * 4;
    samples.push({ lab, rgba: [d[i], d[i + 1], d[i + 2], d[i + 3]] });
  }
  return {
    w: c.width,
    h: c.height,
    bright,
    dark,
    mid,
    avg: sum.map((v) => (v / n) | 0),
    samples,
  };
});

console.log(file, buf.length, "bytes");
console.log(JSON.stringify(info, null, 2));
await browser.close();
