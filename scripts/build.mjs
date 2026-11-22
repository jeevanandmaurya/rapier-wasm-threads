#!/usr/bin/env node
// Builds multi-threaded Rapier JS packages from an unmodified upstream checkout.
//
//   node scripts/build.mjs [--dim 3] [--skip-fetch] [--wasm-opt]
//
// Nothing in upstream is patched. We run upstream's own generator for the `simd` variant and then
// apply a few *additive* edits to the generated crate (enable `parallel`, add wasm-bindgen-rayon,
// export init_thread_pool). The TypeScript API is upstream's, with `raw.ts`/`init.ts` swapped the
// same way upstream builds its `-compat` packages. Every edit asserts that its anchor exists, so an
// upstream change that breaks an assumption fails the build loudly instead of shipping bad output.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = JSON.parse(readFileSync(join(root, "upstream.json"), "utf8"));
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dims = opt("--dim", null) ? [Number(opt("--dim"))] : config.dims;
const UP = join(root, ".upstream");
const BINDINGS = join(UP, "bindings", "typescript");
const OUT = join(root, "dist");
const nightly = process.env.RAPIER_THREADS_TOOLCHAIN || config.nightly;

const log = (m) => console.log(`\x1b[36m[rapier-threads]\x1b[0m ${m}`);
// `npx` is a .cmd shim on Windows and needs a shell; everything else runs without one so paths
// with spaces survive.
const needsShell = (cmd) => process.platform === "win32" && cmd === "npx";
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
function run(cmd, argv, opts = {}) {
  log(`$ ${cmd} ${argv.join(" ")}`);
  const shell = needsShell(cmd);
  execFileSync(cmd, shell ? argv.map(quote) : argv, { stdio: "inherit", shell, ...opts });
}
function must(cond, msg) {
  if (!cond) throw new Error(`upstream layout changed: ${msg}`);
}
function edit(file, fn) {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  must(after !== before, `edit had no effect on ${relative(root, file)}`);
  writeFileSync(file, after);
}

// ---------- 1. upstream checkout at the pinned commit ----------
function fetchUpstream() {
  if (existsSync(join(UP, ".git"))) {
    const head = execFileSync("git", ["-C", UP, "rev-parse", "HEAD"]).toString().trim();
    if (head === upstream.commit) return log(`upstream already at ${head.slice(0, 10)}`);
  } else {
    mkdirSync(UP, { recursive: true });
    run("git", ["-C", UP, "init", "-q"]);
    run("git", ["-C", UP, "remote", "add", "origin", upstream.repo]);
  }
  run("git", ["-C", UP, "fetch", "-q", "--depth", "1", "origin", upstream.commit]);
  run("git", ["-C", UP, "checkout", "-q", "--force", "FETCH_HEAD"]);
  run("git", ["-C", UP, "clean", "-qfdx", "-e", "target"]);
}

// ---------- 2. generated crate -> threads crate ----------
// "native" runs upstream's prepare_builds generator. "nunjucks" renders the same templates with the
// same context in Node. It's used on Windows, where the generator's windows-sys dependency needs a
// 64-bit MinGW dlltool that many machines lack. CI runs --check-parity to prove they match.
const generator = opt("--generator", process.platform === "win32" ? "nunjucks" : "native");

function clearGenerated() {
  // The workspace globs `builds/*`; a leftover or partial generated crate would stop cargo loading.
  for (const d of readdirSync(join(BINDINGS, "builds")))
    if (d !== "prepare_builds") rmSync(join(BINDINGS, "builds", d), { recursive: true, force: true });
}
function snapshot(dir) {
  return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}
function generate(dim, how) {
  if (how === "native") {
    run("cargo", [`+${nightly}`, "run", "-q", "-p", "prepare_builds", "--", "-d", `dim${dim}`, "-f", "simd"], { cwd: BINDINGS });
    return;
  }
  // Mirrors BuildValues::new + process_templates in builds/prepare_builds/src/main.rs for `-f simd`.
  const gen = join(BINDINGS, "builds", "prepare_builds");
  const mainRs = readFileSync(join(gen, "src", "main.rs"), "utf8");
  must(mainRs.includes(`FeatureSet::Simd => format!("rapier{dim}d-simd")`), "simd package name rule");
  must(mainRs.includes(`FeatureSet::Simd => "RUSTFLAGS='-C target-feature=+simd128'"`), "simd rust flags rule");
  must(mainRs.includes(`FeatureSet::Simd => vec!["--enable-simd".to_string()]`), "simd wasm-opt flags rule");
  must(/FeatureSet::Simd => vec!\[\],/.test(mainRs), "simd feature set rule");
  const ctx = {
    dimension: String(dim),
    additional_features: [],
    additional_rust_flags: "RUSTFLAGS='-C target-feature=+simd128'",
    additional_wasm_opt_flags: ["--enable-simd"],
    js_package_name: `rapier${dim}d-simd`,
  };
  const target = join(BINDINGS, "builds", ctx.js_package_name);
  mkdirSync(target, { recursive: true });
  const env = new nunjucks.Environment(null, { autoescape: false, throwOnUndefined: true });
  for (const f of readdirSync(join(gen, "templates"))) {
    const p = join(gen, "templates", f);
    if (!statSync(p).isFile()) continue;
    if (f.endsWith(".tera")) writeFileSync(join(target, f.slice(0, -5)), env.renderString(readFileSync(p, "utf8"), ctx));
    else cpSync(p, join(target, f));
  }
}
function prepareCrate(dim) {
  const simdDir = join(BINDINGS, "builds", `rapier${dim}d-simd`);
  const thrDir = join(BINDINGS, "builds", `rapier${dim}d-threads`);
  clearGenerated();
  generate(dim, generator);
  must(existsSync(join(simdDir, "Cargo.toml")), `generator did not produce ${relative(root, simdDir)}`);
  if (flag("--check-parity")) {
    // Render with the other engine too and require identical output (run in Linux CI).
    const a = snapshot(simdDir);
    clearGenerated();
    generate(dim, generator === "native" ? "nunjucks" : "native");
    const b = snapshot(simdDir);
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)]))
      must(a[f] === b[f], `generator parity: ${f} differs between upstream's generator and nunjucks rendering`);
    log("generator parity OK (upstream generator == nunjucks)");
  }
  rmSync(thrDir, { recursive: true, force: true });
  cpSync(simdDir, thrDir, { recursive: true });
  rmSync(simdDir, { recursive: true, force: true }); // avoid two workspace members with one lib name
  cpSync(join(BINDINGS, "src"), join(thrDir, "src"), { recursive: true });

  edit(join(thrDir, "Cargo.toml"), (t) => {
    must(/^name = "dimforge_rapier\dd-simd"/m.test(t), "package name line");
    must(t.includes('path = "../../src/lib.rs"'), "lib path");
    const featRe = new RegExp(`(rapier${dim}d = \\{ version = "[^"]+", features = \\[)`);
    must(featRe.test(t), `rapier${dim}d features list`);
    must(/^\[dependencies\]$/m.test(t), "[dependencies] section");
    return t
      .replace(/^name = "dimforge_rapier(\d)d-simd"/m, 'name = "rapier$1d_threads"')
      .replace('path = "../../src/lib.rs"', 'path = "src/lib.rs"')
      // `unsync-callbacks`: JS hooks/event handlers aren't Send/Sync. With it, worker threads get a
      // no-op hook, and pairs with user hooks run on the calling thread only (Rapier's own design).
      .replace(featRe, `$1\n    "parallel",\n    "unsync-callbacks",`)
      .replace(/^\[dependencies\]$/m, '[dependencies]\nwasm-bindgen-rayon = { version = "1.3", features = ["no-bundler"] }');
  });
  edit(join(thrDir, "src", "lib.rs"), (t) => `${t}\n// rapier-threads: expose wasm-bindgen-rayon's pool initializer as \`initThreadPool\`.\npub use wasm_bindgen_rayon::init_thread_pool;\n`);
  return thrDir;
}

// ---------- 3. compile to wasm with threads ----------
function wasmBindgenVersion() {
  const v = execFileSync("wasm-bindgen", ["--version"]).toString().trim().split(" ")[1];
  return v;
}
function buildWasm(dim, crateDir) {
  // Lock first so we can check the wasm-bindgen crate version against the CLI.
  run("cargo", [`+${nightly}`, "generate-lockfile"], { cwd: BINDINGS });
  const lock = readFileSync(join(BINDINGS, "Cargo.lock"), "utf8");
  const crateV = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1];
  const cliV = wasmBindgenVersion();
  if (crateV !== cliV) {
    log(`pinning wasm-bindgen crate ${crateV} -> ${cliV} to match the CLI`);
    run("cargo", [`+${nightly}`, "update", "-p", "wasm-bindgen", "--precise", cliV], { cwd: BINDINGS });
  }
  const rustflags = [
    "-C target-feature=+atomics,+bulk-memory,+mutable-globals,+simd128,+nontrapping-fptoint",
    "-C link-arg=--shared-memory",
    "-C link-arg=--max-memory=4294967296",
    "-C link-arg=--import-memory",
    "-C link-arg=--export=__wasm_init_tls",
    "-C link-arg=--export=__tls_size",
    "-C link-arg=--export=__tls_align",
    "-C link-arg=--export=__tls_base",
  ].join(" ");
  run(
    "cargo",
    [`+${nightly}`, "build", "--release", "--target", "wasm32-unknown-unknown", "-p", `rapier${dim}d_threads`,
      "-Z", "build-std=panic_abort,std", "--target-dir", join(BINDINGS, "target", "threads")],
    // Upstream's release profile has `strip = true`, which drops the `target_features` section that
    // wasm-bindgen reads to detect threads. Strip only debuginfo for this build.
    { cwd: BINDINGS, env: { ...process.env, RUSTFLAGS: rustflags, CARGO_PROFILE_RELEASE_STRIP: "debuginfo" } },
  );
  const wasm = join(BINDINGS, "target", "threads", "wasm32-unknown-unknown", "release", `rapier_wasm${dim}d.wasm`);
  must(existsSync(wasm), `missing ${wasm}`);
  const pkg = join(OUT, `rapier${dim}d-${config.packageSuffix}`);
  rmSync(pkg, { recursive: true, force: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", pkg, wasm]);
  if (flag("--wasm-opt")) {
    const out = join(pkg, `rapier_wasm${dim}d_bg.wasm`);
    run("npx", ["--yes", "wasm-opt", "-O3", "--enable-threads", "--enable-simd", "--enable-bulk-memory",
      "--enable-mutable-globals", "--enable-nontrapping-float-to-int", "--enable-sign-ext", out, "-o", out]);
  }
  return pkg;
}

// ---------- 4. TypeScript API (upstream src.ts + our raw/init overlay) ----------
function stripDimBlocks(dir, dim) {
  const other = dim === 3 ? "DIM2" : "DIM3";
  const re = new RegExp(`^.*#if ${other}[\\s\\S]*?^.*#endif.*$\\n?`, "gm");
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f);
    if (statSync(p).isFile() && p.endsWith(".ts")) writeFileSync(p, readFileSync(p, "utf8").replace(re, ""));
  }
}
// Rewrite extensionless relative imports so the output also works as plain browser ESM.
function addJsExtensions(dir) {
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f);
    if (!statSync(p).isFile() || !/\.(js|d\.ts)$/.test(p)) continue;
    const src = readFileSync(p, "utf8");
    const fixed = src.replace(/((?:from|import)\s*["'])(\.{1,2}\/[^"']+?)(["'])/g, (m, a, spec, c) => {
      if (/\.(js|mjs|json|wasm)$/.test(spec)) return m;
      const abs = resolve(dirname(p), spec);
      if (existsSync(abs) && statSync(abs).isDirectory()) return `${a}${spec}/index.js${c}`;
      return `${a}${spec}.js${c}`;
    });
    if (fixed !== src) writeFileSync(p, fixed);
  }
}
function buildTs(dim, pkg, crateDir) {
  const src = join(pkg, "src");
  cpSync(join(BINDINGS, "src.ts"), src, { recursive: true });
  for (const f of ["raw.ts", "init.ts"]) {
    must(existsSync(join(src, f)), `src.ts/${f}`);
    writeFileSync(join(src, f), readFileSync(join(root, "overlay", "ts", f), "utf8").replaceAll("__DIM__", String(dim)));
  }
  stripDimBlocks(src, dim);
  const tsconfig = JSON.parse(readFileSync(join(crateDir, "tsconfig.json"), "utf8"));
  tsconfig.compilerOptions.outDir = ".";
  tsconfig.compilerOptions.rootDirs = [".", "./src"];
  tsconfig.compilerOptions.lib = [...new Set([...(tsconfig.compilerOptions.lib || []), "es2017"])];
  tsconfig.compilerOptions.skipLibCheck = true;
  tsconfig.files = ["./src/rapier.ts"];
  writeFileSync(join(pkg, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  run("npx", ["tsc", "-p", join(pkg, "tsconfig.json")], { cwd: root });
  rmSync(join(pkg, "tsconfig.json"));
  addJsExtensions(pkg);
  const snip = join(pkg, "snippets");
  must(existsSync(snip) && readdirSync(snip, { recursive: true }).some((f) => String(f).endsWith("workerHelpers.no-bundler.js")),
    "wasm-bindgen-rayon worker helper missing (is the parallel build linked?)");
  // Vite plugin: serves the package unmodified in dev, and copies it as static files in builds.
  cpSync(join(root, "overlay", "vite.js"), join(pkg, "vite.js"));
  cpSync(join(root, "overlay", "vite.d.ts"), join(pkg, "vite.d.ts"));
}

// ---------- 5. package.json / README / LICENSE ----------
function writePackage(dim, pkg) {
  const name = `${config.npmScope}/rapier${dim}d-${config.packageSuffix}`;
  const files = readdirSync(pkg).filter((f) => f !== "package.json" && f !== ".gitignore");
  rmSync(join(pkg, ".gitignore"), { force: true });
  const pj = {
    name,
    version: upstream.version,
    description: `Unofficial multi-threaded (WASM threads + SIMD) build of the Rapier ${dim}D physics engine. Same API as @dimforge/rapier${dim}d-simd-compat.`,
    license: "Apache-2.0",
    type: "module",
    main: "rapier.js",
    module: "rapier.js",
    types: "rapier.d.ts",
    exports: { ".": { types: "./rapier.d.ts", default: "./rapier.js" }, "./vite": { types: "./vite.d.ts", default: "./vite.js" }, "./*": "./*" },
    files: [...files, "LICENSE", "NOTICE", "README.md"],
    sideEffects: ["./snippets/**", "./rapier_wasm*.js"],
    keywords: ["physics", "rapier", "wasm", "threads", "multithreaded", "simd", "games", "rigid-body"],
    repository: { type: "git", url: `git+${config.repository}.git` },
    rapierThreads: { upstreamVersion: upstream.version, upstreamCommit: upstream.commit, upstreamRepo: upstream.repo },
  };
  writeFileSync(join(pkg, "package.json"), JSON.stringify(pj, null, 2) + "\n");
  cpSync(join(root, "LICENSE"), join(pkg, "LICENSE"));
  cpSync(join(root, "NOTICE"), join(pkg, "NOTICE"));
  writeFileSync(join(pkg, "README.md"), readFileSync(join(root, "templates", "PACKAGE_README.md"), "utf8")
    .replaceAll("{{name}}", name).replaceAll("{{dim}}", String(dim)).replaceAll("{{version}}", upstream.version)
    .replaceAll("{{commit}}", upstream.commit).replaceAll("{{repository}}", config.repository));
  log(`built ${name}@${upstream.version} -> ${relative(root, pkg)}`);
}

if (!flag("--skip-fetch")) fetchUpstream();
mkdirSync(OUT, { recursive: true });
for (const dim of dims) {
  const crate = prepareCrate(dim);
  const pkg = buildWasm(dim, crate);
  buildTs(dim, pkg, crate);
  writePackage(dim, pkg);
}
