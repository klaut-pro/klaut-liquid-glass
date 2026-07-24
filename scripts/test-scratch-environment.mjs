import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../demo/scratch.html", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  source,
  /import\s+\{\s*RoomEnvironment\s*\}/,
  "the authored softbox environment must not import RoomEnvironment for its happy path",
);
assert.match(
  source,
  /function createSoftboxEnvironment\(\)/,
  "the scratch demo must author its PMREM environment from softbox geometry",
);
assert.match(
  source,
  /pmrem\.fromScene\(softboxStudio/,
  "the authored softbox scene must generate the active PMREM environment",
);
assert.match(
  source,
  /catch(?:\s*\([^)]*\))?\s*\{[\s\S]*?RoomEnvironment/,
  "RoomEnvironment must remain only as an explicit fallback",
);

console.log("scratch authored softbox environment wiring is present");
