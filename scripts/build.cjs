"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {zipSync} = require("fflate");
const {PNG} = require("pngjs");
const {SITE_PAGE_PATTERNS} = require("../src/settings.js");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, "dist");
const VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")).version;
const ICON_SIZES = [16, 32, 48, 128];
const ARCHIVE_DATE = new Date("2000-01-01T00:00:00Z");
const SOURCE_FILES = ["filter-core.js", "settings.js", "content.js", "content.css", "popup.html", "popup.js", "popup.css", "background.js", "history-store.js", "history.html", "history.js", "history.css"];
// Public half of an RSA key; Chromium derives the extension ID from it, so every
// unpacked copy is ID lbjagemindgbhajfhagehgodegndnnhi wherever its folder lives. Sync storage
// is keyed by that ID. The private half was discarded: unpacked loading and
// sync need only the public key, and no .crx is signed.
const CHROMIUM_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoM6y+506zg69PYJY+kXjk2b3yzlB1C7ujV4mAxDn/BlTJ27e7oXDnrf1RFVJA2oGVNVklk2sWpH8fI75PEpoANBNRlmHWE+baHuadmK+LUmcorfWU9VnJdaGedJ9GNEJPkmwkAOl0FGL23vlNPo39sdalu7DF2NEg3W+yPk9MczyLPP3fQ//KW/013ge5eyY+yf+cqniYgPYyW/Uo9wIdCOoaAYX/e6q4PXx3LpaHG2xIyGLeCa6NAZSZcfTYw4DmmLBbVGt13CRuXxm1AXxhpXqrzqz8xqPgCf/4ksxzli/3yAkPqnumK2b2iB0dTYRTTOQSOMQ8lNb+FI2a5BLCQIDAQAB";

/** Generate the extension's three-bar filter icon at an exact raster size. */
function iconPng(size) {
  const png = new PNG({width: size, height: size});
  const blue = [20, 109, 206, 255];
  const white = [255, 255, 255, 255];
  const bars = [
    {left: .18, right: .82, top: .23, bottom: .34},
    {left: .30, right: .70, top: .45, bottom: .56},
    {left: .42, right: .58, top: .67, bottom: .78},
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBar = bars.some(bar => x / size >= bar.left && x / size < bar.right && y / size >= bar.top && y / size < bar.bottom);
      png.data.set(inBar ? white : blue, (y * size + x) * 4);
    }
  }
  return PNG.sync.write(png);
}

/** Build an unpacked extension and an unsigned ZIP with identical contents. */
function build(browser) {
  const icons = Object.fromEntries(ICON_SIZES.map(size => [size, `icons/filter-${size}.png`]));
  const manifest = {
    manifest_version: 3,
    name: "Minimum Views Filter",
    version: VERSION,
    description: "Filter low views and low X likes/views. Keep high-engagement X posts. Includes local X/YouTube filtering statistics and history.",
    permissions: ["storage", "contextMenus"],
    host_permissions: [...SITE_PAGE_PATTERNS],
    icons,
    action: {default_title: "Minimum Views Filter", default_popup: "popup.html", default_icon: icons},
    content_scripts: [{matches: [...SITE_PAGE_PATTERNS], js: ["settings.js", "filter-core.js", "content.js"], css: ["content.css"], run_at: "document_idle"}],
  };
  if (browser === "firefox") {
    manifest.background = {scripts: ["settings.js", "history-store.js", "background.js"]};
    manifest.browser_specific_settings = {gecko: {
      id: "minimum-views-filter@gerardwu100.local",
      strict_min_version: "142.0",
      data_collection_permissions: {required: ["none"]},
    }};
  } else {
    manifest.background = {service_worker: "background.js"};
    manifest.key = CHROMIUM_PUBLIC_KEY;
    manifest.minimum_chrome_version = "109";
  }
  const files = {"manifest.json": Buffer.from(JSON.stringify(manifest, null, 2) + "\n")};
  for (const name of SOURCE_FILES) files[name] = fs.readFileSync(path.join(PROJECT_ROOT, "src", name));
  for (const size of ICON_SIZES) files[`icons/filter-${size}.png`] = iconPng(size);
  const directory = path.join(OUTPUT_DIRECTORY, browser);
  fs.mkdirSync(directory, {recursive: true});
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), {recursive: true});
    fs.writeFileSync(path.join(directory, name), bytes);
  }
  const archive = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, {mtime: ARCHIVE_DATE}]]));
  fs.writeFileSync(path.join(OUTPUT_DIRECTORY, `minimum-views-filter-${browser}-${VERSION}.zip`), zipSync(archive));
  console.log(`Built ${browser}: ${Object.keys(files).length} files, version ${VERSION}`);
}

fs.mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
for (const browser of ["chrome-brave", "firefox"]) build(browser);
