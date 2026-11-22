// rapier-threads overlay: replaces upstream's init so it also starts the rayon thread pool.
import wasmInit, {initThreadPool} from "./rapier_wasm__DIM__d";

export interface InitOptions {
    /**
     * Number of worker threads Rapier may use. Default: half of
     * `navigator.hardwareConcurrency` (≈ physical cores), at least 1.
     */
    threads?: number;
    /** Optional override for where to load the `.wasm` from (URL, Response, bytes or module). */
    module_or_path?: any;
    /**
     * `world.step()` blocks while it waits for its worker threads, which browsers forbid on the
     * main thread. `init()` therefore refuses to run there unless you set this, for example to
     * use only queries or to build worlds that a worker will step.
     */
    allowMainThread?: boolean;
}

let initPromise: Promise<void> | null = null;
let poolSize = 0;

/**
 * Initializes RAPIER and its thread pool. Must be awaited before using the library.
 *
 * Requirements:
 * - a cross-origin-isolated page (`Cross-Origin-Opener-Policy: same-origin` and
 *   `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`), which enables SharedArrayBuffer;
 * - calling it (and `world.step()`) from a Web Worker.
 *
 * If either is missing, use the official single-threaded `@dimforge/rapier__DIM__d-simd-compat`
 * instead: it has the same API.
 */
export function init(options: InitOptions = {}): Promise<void> {
    if (initPromise) return initPromise;
    const g = globalThis as any;
    if (typeof g.SharedArrayBuffer === "undefined" || g.crossOriginIsolated === false) {
        return Promise.reject(
            new Error(
                "rapier threads build needs a cross-origin isolated page (COOP: same-origin + " +
                    "COEP: require-corp/credentialless) so SharedArrayBuffer is available. " +
                    "Fall back to @dimforge/rapier__DIM__d-simd-compat otherwise.",
            ),
        );
    }
    const onMainThread = typeof g.document !== "undefined" && typeof g.WorkerGlobalScope === "undefined";
    if (onMainThread && !options.allowMainThread) {
        return Promise.reject(
            new Error(
                "rapier threads build must run in a Web Worker: world.step() waits on its thread pool " +
                    "and browsers forbid blocking the main thread. Pass {allowMainThread: true} to override.",
            ),
        );
    }
    const hc = (g.navigator && g.navigator.hardwareConcurrency) || 4;
    const threads = Math.max(1, Math.floor(options.threads ?? hc / 2));
    initPromise = (async () => {
        await wasmInit(options.module_or_path ? {module_or_path: options.module_or_path} : undefined);
        await initThreadPool(threads);
        poolSize = threads;
    })();
    return initPromise;
}

/** Number of worker threads in the pool (0 before `init()` resolves). */
export function threadCount(): number {
    return poolSize;
}
