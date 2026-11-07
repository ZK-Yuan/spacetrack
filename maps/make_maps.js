/* Exports the homepage god-view maps drawn by maps.js to ../thumbs/map_<scene>_zh.jpg and map_<scene>_en.jpg (light theme).
   Run: NODE_PATH=/tmp/pptr/node_modules node make_maps.js   (CHROME_PATH as for bench/runner.js) */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME_PATH || "/tmp/pptr/chrome-headless-shell-linux64/chrome-headless-shell";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const page = await browser.newPage();
  const errors = [];
  const fail = (msg) => { errors.push(msg); console.error(msg); };
  page.on("pageerror", (e) => fail(e.stack || e.message));
  page.on("console", (m) => { if (m.type() === "error") fail(m.text()); });
  await page.goto("file://" + path.join(__dirname, "maps.html"), { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => (window.SAMaps && window.SAMaps.ready) || window.__mapsFailed, { timeout: 60000 });
  if (errors.length) { await browser.close(); process.exit(1); }
  const variants = await page.evaluate(() => window.MAP_VARIANTS);
  for (const name of await page.evaluate(() => Object.keys(window.SAMaps.draw))) {
    for (const o of variants) {
      const url = await page.evaluate((n, opts) => window.SAMaps.jpeg(n, 0.9, opts), name, o);
      const out = path.join(__dirname, "..", "thumbs", `map_${name}${o.suffix}.jpg`);
      fs.writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
      console.log("wrote %s (%d KB)", out, Math.round(fs.statSync(out).size / 1024));
    }
  }
  await browser.close();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
})();
