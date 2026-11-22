// Checks the package's Vite plugin in dev and production builds with headless Chromium.
// Expects the built package to be installed in node_modules (see the CI action).
import { createServer, build, preview } from "vite";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)));
const app = join(here, "vite-app");
// Generate the fixture with the real package name from config.json.
const { npmScope, packageSuffix } = JSON.parse(readFileSync(join(here, "..", "config.json"), "utf8"));
const pkg = `${npmScope}/rapier3d-${packageSuffix}`;
for (const f of ["vite.config", "physics.worker"])
  writeFileSync(join(app, `${f}.js`), readFileSync(join(app, `${f}.template.js`), "utf8").replaceAll("__PKG__", pkg));
const browser = await chromium.launch();
async function check(label, url) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`[${label} page error] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => window.__result, null, { timeout: 120_000 });
  const r = await page.evaluate(() => window.__result);
  await page.close();
  console.log(`${r.ok ? "PASS" : "FAIL"}  vite ${label}: ${JSON.stringify(r)}`);
  return r.ok && r.threads > 1;
}

const dev = await createServer({ configFile: join(app, "vite.config.js"), server: { port: 5199 } });
await dev.listen();
const okDev = await check("dev", "http://localhost:5199/");
await dev.close();

await build({ configFile: join(app, "vite.config.js"), logLevel: "warn" });
const prev = await preview({ configFile: join(app, "vite.config.js"), preview: { port: 5198 } });
const okBuild = await check("build", "http://localhost:5198/");
prev.httpServer.close();

await browser.close();
process.exit(okDev && okBuild ? 0 : 1);
