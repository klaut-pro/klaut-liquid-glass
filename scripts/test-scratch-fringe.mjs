import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../demo/scratch.html", import.meta.url), "utf8");

assert.match(html, /function installEdgeFringe/);
assert.match(html, /onBeforeCompile/);
assert.match(html, /uFringeAmt/);
assert.match(html, /#include <opaque_fragment>/);
assert.match(html, /id="fringe"/);
assert.match(html, /vec3 _cyan = vec3\(0\.2, 1\.35, 1\.4\)/);
assert.match(html, /vec3 _lime = vec3\(0\.55, 1\.4, 0\.35\)/);
assert.match(html, /vec3 _gold = vec3\(1\.35, 1\.1, 0\.35\)/);
assert.doesNotMatch(html, /vec3 _magenta|vec3\(1\.2,\s*0\.2,\s*1\.2\)/);

console.log("scratch edge fringe onBeforeCompile wiring is present");
