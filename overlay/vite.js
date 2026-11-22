// Vite plugin for the rapier threads build.
//
//   import rapierThreads from "<this package>/vite";
//   export default { plugins: [rapierThreads()], worker: { format: "es", plugins: () => [rapierThreads()] } };
//
// Why it's needed: wasm-bindgen-rayon starts each thread by fetching its own helper script and
// running it from a blob: URL, and each thread then re-imports the package's wasm-bindgen module.
// - dev: Vite rewrites served JS (e.g. adds `import "/@vite/client"`), which a blob can't resolve.
//   This plugin serves the package's files byte-for-byte.
// - build: bundling would merge those modules into a chunk the threads can't re-import. This
//   plugin keeps the package external and copies its files into the output instead.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(fileURLToPath(import.meta.url));
const pkgName = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).name;
const shortName = pkgName.split("/").pop();
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".map": "application/json", ".ts": "text/plain" };
const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

/**
 * @param {{ headers?: boolean }} [options] headers: also send COOP/COEP from the dev and preview
 *   servers (default true). Production hosting must send them too.
 */
export default function rapierThreads({ headers = true } = {}) {
  let base = "/";
  let assetsDir = "assets";
  let isBuild = false;
  return {
    name: "rapier-threads",
    enforce: "pre",
    config(_, env) {
      isBuild = env.command === "build";
      return {
        optimizeDeps: { exclude: [pkgName] },
        ...(headers ? { server: { headers: ISOLATION }, preview: { headers: ISOLATION } } : {}),
      };
    },
    configResolved(cfg) {
      base = cfg.base || "/";
      assetsDir = cfg.build.assetsDir || "assets";
      if (isBuild && !base.startsWith("/") && !/^https?:/.test(base))
        cfg.logger.warn(`[rapier-threads] base "${base}" is relative; the threads package is loaded from ${base}${assetsDir}/${shortName}/, which must resolve from your worker's URL.`);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url || "").split("?")[0]);
        const marker = `/${pkgName}/`;
        let file;
        if (path.startsWith("/@fs/")) {
          // Symlinked installs (npm link, workspaces, pnpm) are served by real path.
          file = resolve(path.slice("/@fs/".length).replace(/^\/?([A-Za-z]:)/, "$1").replace(/^(?![A-Za-z]:)/, "/"));
        } else {
          const i = path.indexOf(marker);
          if (i < 0) return next();
          file = join(pkgDir, path.slice(i + marker.length));
        }
        if (!file.startsWith(pkgDir + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        if (headers) for (const [k, v] of Object.entries(ISOLATION)) res.setHeader(k, v);
        res.end(readFileSync(file));
      });
    },
    resolveId(id) {
      if (!isBuild) return null;
      if (id !== pkgName && !id.startsWith(pkgName + "/")) return null;
      if (id === `${pkgName}/vite`) return null;
      const sub = id === pkgName ? "rapier.js" : id.slice(pkgName.length + 1);
      return { id: `${base}${assetsDir}/${shortName}/${sub}`, external: true };
    },
    generateBundle() {
      if (!isBuild) return;
      for (const f of readdirSync(pkgDir, { recursive: true }).map(String)) {
        const p = join(pkgDir, f);
        if (!statSync(p).isFile() || /^vite\.(js|d\.ts)$/.test(f) || f.endsWith(".ts") || f.endsWith(".map")) continue;
        this.emitFile({ type: "asset", fileName: `${assetsDir}/${shortName}/${relative(pkgDir, p).split(sep).join("/")}`, source: readFileSync(p) });
      }
    },
  };
}
