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
const script = path.join(root, "scripts", "bake-scratch-mesh.py");

if (!existsSync(blender)) {
  console.error("Blender portable not found at", blender);
  process.exit(1);
}

// Forward CLI after `--` to the Blender Python script
const passthrough = process.argv.slice(2);
const args = ["--background", "--python", script, "--", ...passthrough];

const r = spawnSync(blender, args, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
process.exit(r.status ?? 1);
