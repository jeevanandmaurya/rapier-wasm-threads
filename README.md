# rapier-wasm-threads

[![CI](https://github.com/jeevanandmaurya/rapier-wasm-threads/actions/workflows/ci.yml/badge.svg)](https://github.com/jeevanandmaurya/rapier-wasm-threads/actions/workflows/ci.yml)

Packages: `@jeevanandmaurya/rapier3d-threads`, `@jeevanandmaurya/rapier2d-threads` (not published yet).

**Unofficial** multi-threaded WebAssembly builds of the [Rapier](https://rapier.rs) physics engine
(2D and 3D), with the same JavaScript API as `@dimforge/rapier{2,3}d-simd-compat`.
Not affiliated with or endorsed by Dimforge.

Rapier already ships a multi-threaded solver (its `parallel` feature, built on rayon). The official
JS packages are just compiled without it. This repo compiles the **unmodified upstream source**
with that feature turned on, WebAssembly threads, and SIMD, then tests it against the official
package and publishes it.

| | official `-simd-compat` | this build |
|---|---|---|
| Rapier physics code | upstream | upstream, unmodified |
| Threads | 1 | rayon pool on Web Workers |
| Typical `world.step()` (2.5k bodies, events + JS hooks) | 10.2 ms | 4.8 ms (6 threads) |
| Needs COOP/COEP + Web Worker | no | **yes** |

## How it stays in sync with upstream

Nothing in upstream is patched, so new releases don't cause merge conflicts.

1. `upstream.json` pins an official release (`version`) and the exact git commit npm says it was
   published from (`gitHead`).
2. `scripts/build.mjs` checks out that commit and runs **upstream's own generator** for the
   `simd` variant. It then makes additive edits to the *generated* crate:
   - turns on the `parallel` and `unsync-callbacks` features of `rapier{2,3}d`. With
     `unsync-callbacks`, JS hooks and event handlers only ever run on the calling thread;
   - adds `wasm-bindgen-rayon` and exports `initThreadPool`;
   - builds with `+atomics,+bulk-memory,+mutable-globals,+simd128` and `-Z build-std` on a
     pinned nightly.

   For the TypeScript API, it swaps upstream's `raw.ts`/`init.ts` for [`overlay/ts`](overlay/ts),
   the same way upstream builds its `-compat` packages. Every edit asserts that its anchor exists,
   so when upstream changes something we depend on, the build stops with
   `upstream layout changed: …` instead of shipping a broken package.
3. **`sync-upstream.yml`** runs daily. When npm has a newer official release, it repins
   `upstream.json`, builds, and runs the browser tests (full API compared against the official
   package of the same version, plus Vite dev and build). If they pass, it commits, tags
   `v<version>` and publishes to npm. If anything fails, nothing is published and an issue is
   opened.

So a new upstream release normally ships with no manual work. You only step in when that issue
appears, usually because an upstream change broke one of the assumptions in `scripts/build.mjs`.

## Building locally

Requirements: Node 22+, `rustup`, the pinned nightly from `config.json` with `rust-src` and the
`wasm32-unknown-unknown` target, and `wasm-bindgen` CLI matching `config.json`.

```bash
rustup toolchain install nightly-2026-11-21 --profile minimal -c rust-src -t wasm32-unknown-unknown
npm ci
npm run build          # both dims; or: npm run build:3d
node test/run.mjs --serve   # then open http://localhost:8787/test/?dims=3,2
```

On Windows, pass the GNU nightly (`RAPIER_THREADS_TOOLCHAIN=nightly-x86_64-pc-windows-gnu`). The
build renders upstream's templates with Nunjucks there, because upstream's generator binary needs
a 64-bit MinGW `dlltool`. Linux CI runs both renderers and requires identical output
(`--check-parity`).

## Publishing setup (one time)

1. Check `npmScope` in [`config.json`](config.json) matches your npm username or org.
2. On npmjs.com, add this repo as a **trusted publisher** for each package (workflow
   `sync-upstream.yml` and `release.yml`), or add an `NPM_TOKEN` repository secret.
3. Run the **Release (manual)** workflow once to publish the current version. From then on,
   `sync-upstream.yml` publishes new upstream releases on its own.

## Repo layout

```
upstream.json          pinned official release + commit (auto-updated)
config.json            npm scope, dims, pinned nightly + wasm-bindgen
scripts/build.mjs      checkout -> upstream generator -> additive edits -> wasm -> TS -> dist/
scripts/check-upstream.mjs, scripts/publish.mjs
overlay/ts/            raw.ts + init.ts replacing upstream's (init also starts the thread pool)
overlay/vite.js        Vite plugin shipped in the package
test/                  browser conformance test + Vite dev/build test
.github/workflows/     ci.yml, sync-upstream.yml, release.yml
```

## License

Apache-2.0, same as Rapier. See [LICENSE](LICENSE) and [NOTICE](NOTICE), which lists exactly what is
changed relative to upstream.
