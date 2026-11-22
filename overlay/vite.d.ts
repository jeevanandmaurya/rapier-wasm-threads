/** Vite plugin for the rapier threads build. Add it to both `plugins` and `worker.plugins`. */
export default function rapierThreads(options?: {
    /** Also send COOP/COEP headers from Vite's dev and preview servers (default true). */
    headers?: boolean;
}): any;
