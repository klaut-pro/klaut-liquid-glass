import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const file = process.argv[2] || "demo/frames/glyph-scriptProP.png";
const buf = await readFile(file);
const b64 = buf.toString("base64");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage();
const result = await page.evaluate(async (dataUrl) => {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = dataUrl;
  });
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let voidInside = 0;
  let body = 0;
  let pink = 0;
  let silver = 0;
  for (let y = 40; y < c.height - 40; y++) {
    for (let x = 80; x < c.width - 80; x++) {
      const i = (y * c.width + x) * 4;
      const r = d[i];
      const gch = d[i + 1];
      const b = d[i + 2];
      const luma = 0.2126 * r + 0.7152 * gch + 0.0722 * b;
      if (r < 20 && gch < 20 && b < 25 && luma < 18) {
        let nearPink = false;
        for (const [dx, dy] of [
          [-3, 0],
          [3, 0],
          [0, -3],
          [0, 3],
          [-8, 0],
          [8, 0],
          [0, -8],
          [0, 8],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= c.width || ny >= c.height) continue;
          const j = (ny * c.width + nx) * 4;
          if (d[j] > 180 && d[j + 2] > 150 && d[j + 1] < 210) nearPink = true;
        }
        if (nearPink) voidInside++;
      } else if (r > 80 || b > 80) {
        body++;
        if (r > 200 && gch < 160 && b > 180) pink++;
        if (r > 210 && gch > 210 && b > 210) silver++;
      }
    }
  }
  return {
    voidInside,
    body,
    pink,
    silver,
    silverRatio: +(silver / Math.max(body, 1)).toFixed(3),
    pinkRatio: +(pink / Math.max(body, 1)).toFixed(3),
  };
}, `data:image/png;base64,${b64}`);
console.log(file, JSON.stringify(result));
await browser.close();
