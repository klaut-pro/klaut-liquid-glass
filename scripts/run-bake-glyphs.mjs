#!/usr/bin/env node
/**
 * Find portable / PATH Blender, bake heightfields, then merge via bake-glyph-sdf.py.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const script = join(root, "scripts", "bake-glyph-blender.py");

function candidates() {
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return [
    process.env.BLENDER_EXE,
    join(local, "Programs", "blender-portable", "blender-4.2.16-windows-x64", "blender.exe"),
    join(local, "Programs", "blender-portable", "blender.exe"),
    "blender",
  ].filter(Boolean);
}

function findBlender() {
  for (const c of candidates()) {
    if (c === "blender") {
      const r = spawnSync(c, ["--version"], { encoding: "utf8" });
      if (r.status === 0) return c;
      continue;
    }
    if (existsSync(c)) return c;
  }
  return null;
}

const blender = findBlender();
if (!blender) {
  console.warn("[bake:glyphs] Blender not found — falling back to EDT-only SDF bake");
} else {
  console.log("[bake:glyphs] using", blender);
  const r = spawnSync(
    blender,
    ["--background", "--python", script, "--", "--all"],
    { cwd: root, encoding: "utf8", stdio: "inherit" },
  );
  if (r.status !== 0) {
    console.error("[bake:glyphs] Blender bake failed; continuing with EDT fallback");
  }
}

const py = spawnSync("python", [join(root, "scripts", "bake-glyph-sdf.py"), "--prefer-blender"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});
process.exit(py.status ?? 1);
