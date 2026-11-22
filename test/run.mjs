// Serves the repo with COOP/COEP and runs test/index.html.
//   node test/run.mjs [--serve] [--dims 3,2] [--threads 4]
// --serve only starts the server (open http://localhost:8787/test/ yourself).
// Otherwise it drives headless Chromium via Playwright (CI): `npx playwright install chromium`.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = Number(opt("--port", 8787));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".map": "application/json" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = resolve(root, "." + path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(port, r));
const url = `http://localhost:${port}/test/?dims=${opt("--dims", "3")}${args.includes("--threads") ? `&threads=${opt("--threads")}` : ""}`;
console.log(`serving ${root} at ${url}`);
if (args.includes("--serve")) await new Promise(() => {});

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log(`[page] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__result, null, { timeout: 10 * 60_000 });
const result = await page.evaluate(() => window.__result);
console.log(result.lines.join("\n"));
await browser.close();
server.close();
process.exit(result.passed ? 0 : 1);
