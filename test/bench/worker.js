// Runs one benchmark scene on one engine and reports per-step timings.
import { runScene } from "./build-world.js";

self.onmessage = async ({ data: { url, threads, scene, steps } }) => {
  try {
    const RAPIER = (await import(url)).default;
    await (threads ? RAPIER.init({ threads }) : RAPIER.init());
    const def = await (await fetch(`/test/bench/${scene}.json`)).json();
    const r = runScene(RAPIER, def, { steps });
    self.postMessage({ type: "done", r, threads: threads ? RAPIER.threadCount() : 1 });
  } catch (e) {
    self.postMessage({ type: "error", message: String(e?.stack ?? e) });
  }
};
