import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../demo/scratch.html", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /new THREE\.MeshPhysicalMaterial\(\{[\s\S]*?iridescence:\s*0\.28/,
  "matGlass must enable sparse Three iridescence",
);
assert.match(
  source,
  /iridescenceThicknessRange:\s*\[\s*180\s*,\s*420\s*\]/,
  "matGlass iridescence thickness must stay in a sparse oil band",
);
assert.match(
  source,
  /metalness:\s*0\.04/,
  "matGlass must carry tiny metalness for chrome bite",
);
assert.match(
  source,
  /clearcoat:\s*1/,
  "matGlass must keep strong clearcoat",
);
assert.match(
  source,
  /toneMappingExposure\s*=\s*1\.08/,
  "exposure must be retuned for dark plate #07090e",
);
assert.match(
  source,
  /environmentIntensity\s*=\s*1\.35/,
  "env intensity must stay below cream-wash levels with softbox PMREM",
);
assert.match(
  source,
  /ch === "o"[\s\S]*?m\.ior\s*=\s*1\.12/,
  "closed-o carve-out must keep lower IOR",
);
assert.match(
  source,
  /stage >= 3 && ch === "o"/,
  "o carve-out must still gate on stage >= 3",
);
assert.match(
  source,
  /onBeforeCompile/,
  "Task 4 fringe onBeforeCompile must be present after glance FAIL",
);
assert.match(
  source,
  /function createSoftboxEnvironment\(\)/,
  "Task 1 softbox environment wiring must remain",
);
assert.doesNotMatch(
  source,
  /import\s+\{\s*RoomEnvironment\s*\}/,
  "RoomEnvironment must not return as the happy-path import",
);

console.log("scratch MeshPhysical + iridescence retune wiring is present");
