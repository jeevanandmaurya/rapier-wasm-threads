#!/usr/bin/env node
// Publishes every built package in dist/ that isn't on npm yet. Safe to re-run.
// Auth: npm trusted publishing (OIDC, recommended) or NODE_AUTH_TOKEN.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
if (config.npmScope.includes("CHANGE_ME")) throw new Error("set npmScope in config.json before publishing");
const npm = (args, opts = {}) => execFileSync("npm", args, { stdio: "pipe", ...opts }).toString().trim();

for (const d of readdirSync(join(root, "dist"))) {
  const dir = join(root, "dist", d);
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  let exists = false;
  try { exists = npm(["view", `${name}@${version}`, "version"]) === version; } catch {}
  if (exists) { console.log(`skip ${name}@${version} (already published)`); continue; }
  console.log(`publishing ${name}@${version}`);
  execFileSync("npm", ["publish", "--access", "public", "--provenance"], { cwd: dir, stdio: "inherit" });
}
