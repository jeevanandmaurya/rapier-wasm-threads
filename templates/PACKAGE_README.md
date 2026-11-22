# {{name}}

**Unofficial** multi-threaded build of the [Rapier](https://rapier.rs) {{dim}}D physics engine for the web:
WebAssembly threads + SIMD. Not affiliated with or endorsed by Dimforge.

- Same API as [`@dimforge/rapier{{dim}}d-simd-compat`](https://www.npmjs.com/package/@dimforge/rapier{{dim}}d-simd-compat) (same version: **{{version}}**).
- Built from upstream commit [`{{commit}}`](https://github.com/dimforge/rapier/commit/{{commit}}) with Rapier's own
  `parallel` feature. The physics code is unmodified; see [the build repo]({{repository}}) for exactly what changes.
- Typically 2–4× faster `world.step()` than the single-threaded SIMD package on scenes with thousands of bodies.

## Requirements

1. **Cross-origin isolation.** Serve your page with:
   ```
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: require-corp   (or: credentialless)
   ```
   Without these headers, `SharedArrayBuffer` is unavailable and `init()` rejects.
2. **Run Rapier in a Web Worker.** `world.step()` waits for its thread pool, and browsers don't allow blocking the main thread.

## Usage

```js
// physics.worker.js  (new Worker(new URL("./physics.worker.js", import.meta.url), { type: "module" }))
import RAPIER from "{{name}}";

await RAPIER.init({ threads: 4 }); // default: navigator.hardwareConcurrency / 2
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
// ...the usual Rapier API...
world.step();
```

Fall back to the official single-threaded package when the page isn't isolated:

```js
const RAPIER = crossOriginIsolated
  ? (await import("{{name}}")).default
  : (await import("@dimforge/rapier{{dim}}d-simd-compat")).default;
await RAPIER.init();
```

### Vite

Exclude the package from dependency pre-bundling, and send the headers from the dev server:

```js
export default {
  optimizeDeps: { exclude: ["{{name}}"] },
  server: { headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" } },
};
```

## License

Apache-2.0, same as Rapier. See `LICENSE` and `NOTICE`.
