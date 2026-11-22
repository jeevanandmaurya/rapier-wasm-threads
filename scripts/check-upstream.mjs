#!/usr/bin/env node
// Checks npm for a newer official Rapier release and, if found, points upstream.json at the exact
// git commit it was published from (npm's `gitHead`). Also bumps the official packages used by the
// comparison tests to the same version.
//
//   node scripts/check-upstream.mjs            -> updates files, prints result
//   node scripts/check-upstream.mjs --dry-run  -> only prints
// In GitHub Actions it writes `changed`, `version` and `previous` to $GITHUB_OUTPUT.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");
const npm = (...a) => execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", a, { shell: process.platform === "win32" }).toString().trim();
const upFile = join(root, "upstream.json");
const up = JSON.parse(readFileSync(upFile, "utf8"));
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));

const cmp = (a, b) => {
  const pa = a.split(/[.-]/).map((x) => (isNaN(+x) ? x : +x)), pb = b.split(/[.-]/).map((x) => (isNaN(+x) ? x : +x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    if (pa[i] === undefined) return 1; // 1.0.0 > 1.0.0-rc
    if (pb[i] === undefined) return -1;
    return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
};

const latest = npm("view", up.npmPackage, "version");
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
out("previous", up.version);
if (cmp(latest, up.version) <= 0) {
  console.log(`up to date: ${up.npmPackage}@${up.version}`);
  out("changed", "false");
  out("version", up.version);
  process.exit(0);
}
const gitHead = npm("view", `${up.npmPackage}@${latest}`, "gitHead");
if (!/^[0-9a-f]{40}$/.test(gitHead)) throw new Error(`no gitHead for ${up.npmPackage}@${latest}: "${gitHead}"`);
// Every dimension we build must have an official release at this version (used by the tests).
for (const dim of config.dims) npm("view", `@dimforge/rapier${dim}d-simd-compat@${latest}`, "version");
console.log(`new upstream release: ${up.version} -> ${latest} (commit ${gitHead})`);
out("changed", "true");
out("version", latest);
if (dry) process.exit(0);

writeFileSync(upFile, JSON.stringify({ ...up, version: latest, commit: gitHead }, null, 2) + "\n");
const pkgFile = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
for (const dim of config.dims) pkg.devDependencies[`@dimforge/rapier${dim}d-simd-compat`] = latest;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
console.log("updated upstream.json and package.json; run `npm install` to refresh the lockfile");
