import { copyFile, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { force: true, recursive: true });

await build({
  entryPoints: ["src/domain/guidance-contract.ts"],
  outfile: "dist/domain/guidance-contract.mjs",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true
});

await build({
  entryPoints: ["src/backend/server.ts"],
  outfile: "dist/backend/server.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: true
});

await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("src/extension/sidepanel/sidepanel.html", "dist/sidepanel.html"),
  copyFile("src/extension/sidepanel/sidepanel.css", "dist/sidepanel.css")
]);

await build({
  entryPoints: ["src/extension/service-worker/main.ts"],
  outfile: "dist/background.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true
});

await build({
  entryPoints: ["src/extension/sidepanel/main.ts"],
  outfile: "dist/sidepanel.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true
});
