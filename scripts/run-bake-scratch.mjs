import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blender = path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"),
  "Programs",
  "blender-portable",
  "blender-4.2.16-windows-x64",
  "blender.exe",
);

// Default: concept-faithful honey/chrome bake (no Blender MCP in Cursor).
// Pass --legacy to use the older GravityMeltSim-tuned soft-boolean path.
const passthrough = process.argv.slice(2);
const legacy = passthrough.includes("--legacy");
const filtered = passthrough.filter((a) => a !== "--legacy");
const script = path.join(
  root,
  "scripts",
  legacy ? "bake-scratch-mesh.py" : "bake-concept-wordmark.py",
);

if (!existsSync(blender)) {
  console.error("Blender portable not found at", blender);
  process.exit(1);
}
if (!existsSync(script)) {
  console.error("Bake script not found at", script);
  process.exit(1);
}

console.log(
  legacy
    ? "bake:scratch legacy (bake-scratch-mesh.py)"
    : "bake:scratch concept (bake-concept-wordmark.py) — Blender MCP: no",
);

const args = ["--background", "--python", script, "--", ...filtered];
const r = spawnSync(blender, args, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
process.exit(r.status ?? 1);
