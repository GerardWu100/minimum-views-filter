"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {zipSync} = require("fflate");
const {PNG} = require("pngjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, "dist");
const VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")).version;
const ICON_SIZES = [16, 32, 48, 128];
const ARCHIVE_DATE = new Date("2000-01-01T00:00:00Z");
const SOURCE_FILES = ["filter-core.js", "settings.js", "content.js", "content.css", "popup.html", "popup.js", "popup.css"];
const MATCHES = [
  "https://x.com/*", "https://www.x.com/*",
  "https://twitter.com/*", "https://www.twitter.com/*",
  "https://youtube.com/*", "https://www.youtube.com/*",
];

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
    description: "Hide X posts and YouTube videos below your minimum view count, locally and without feedback or a permanent blacklist.",
    permissions: ["storage"],
    host_permissions: MATCHES,
    icons,
    action: {default_title: "Minimum Views Filter", default_popup: "popup.html", default_icon: icons},
    content_scripts: [{matches: MATCHES, js: ["filter-core.js", "settings.js", "content.js"], css: ["content.css"], run_at: "document_idle"}],
  };
  if (browser === "firefox") {
    manifest.browser_specific_settings = {gecko: {
      id: "minimum-views-filter@gerardwu100.local",
      strict_min_version: "142.0",
      data_collection_permissions: {required: ["none"]},
    }};
  } else {
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
