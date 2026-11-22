const w = new Worker(new URL("./physics.worker.js", import.meta.url), { type: "module" });
w.onmessage = ({ data }) => { document.getElementById("out").textContent = JSON.stringify(data); window.__result = data; };
w.onerror = (e) => { window.__result = { ok: false, error: e.message || "worker error" }; };
