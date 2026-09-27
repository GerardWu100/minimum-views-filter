# Minimum Views Filter

A small extension for **Chrome/Brave and Firefox** that hides X posts and
YouTube videos below a configurable view count. The default is **1,000**.

It only changes the page in your browser. It never clicks “Not interested,”
sends feedback, or stores a blacklist of posts or videos. If the site later
shows an item with enough views, it becomes eligible again.

## Install

Use the packaged ZIP for your browser, or build it from source with the commands
below. Extract the ZIP before loading it.

### Chrome / Brave

1. Open `chrome://extensions` or `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing
   `manifest.json` (from source: `dist/chrome-brave`).
4. Pin **Minimum Views Filter** if desired, then reload existing X/YouTube tabs.
5. Open the extension popup to adjust the minimum or turn filtering off per site.

Keep the unpacked directory in a permanent location. Chrome/Brave load its files
from that folder. Minimum Chromium version: 109.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` inside the extracted Firefox package
   (from source: `dist/firefox`).
4. Reload existing X/YouTube tabs. Grant site access if Firefox asks.

**This is a temporary development install and is removed when Firefox restarts.**
The package is unsigned. A permanent install in normal Firefox requires Mozilla
signing, including for a privately distributed add-on. Submit the Firefox ZIP
through the Mozilla developer hub's self-distribution flow, then install the
returned signed XPI. Do not disable signature verification. Minimum Firefox:
142. The extension has not been submitted to either store.

Official instructions: [Chrome unpacked extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked),
[Firefox temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/),
[Firefox signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Behavior

| Item | Default behavior |
| --- | --- |
| 0–999 views | Hidden |
| Exactly 1,000 or more | Kept |
| Count missing, unsupported, or ambiguous | Kept |
| Counter hidden by another extension's CSS | Read from underlying text/accessibility labels |
| Count changes from 800 to 1,500 on the page | Restored automatically |
| Same item appears later with enough views | Kept; there is no stored exclusion |

“Hide unknown view counts” is optional and off by default. Setting the minimum
to zero allows every known count. Each site can be disabled separately. Saving
settings updates open supported pages automatically.

X scope: **Home** (For You/Following) and **Lists**. Opened conversations,
profiles, search, notifications, and messages are not filtered.

YouTube scope: recognized desktop video cards on Home, search, subscriptions,
channel pages, and recommendations beside a video. Recognized Shorts cards can
be filtered when they expose counts. The active player, vertical Shorts player,
playlists, channels, and known ad containers are not filtering targets. Live
concurrent viewers are not interpreted as total views.

## Existing extensions

The filter uses its own `data-minimum-views-hidden` attribute. It does not rewrite
existing styles/classes, reveal counters, replace titles/thumbnails, or hook
keyboard, audio, player, and network APIs. Turning it off removes only its own
hiding marks; a card hidden by another extension stays hidden.

On 2026-09-27, X's analytics label and YouTube's metadata labels were confirmed
present in the user's Brave page with the existing extension setup active.
Synthetic coexistence tests also cover CSS-hidden counters, removed metadata,
edited titles, and externally hidden cards. This is **not a guarantee across all
settings** of Control Panel for Twitter, Improve YouTube, DeArrow, Enhancer,
PocketTube, Stylus, uBlock Origin, or arbitrary Violentmonkey scripts. PocketTube
Deck/custom card layouts may fall outside recognized selectors.

See [compatibility evidence and references](docs/compatibility.md).

## Privacy and limitations

- Runtime requests no network resources, records no post/video IDs, and has no
  analytics or background service worker. Four settings are stored locally.
- Only X/Twitter and desktop YouTube domains are permitted, plus local extension
  storage. It does not access other extensions' settings or private storage.
- A local filter cannot stop a site from logging a served card or learning from
  your other activity. “No feedback clicks” does not mean “no algorithm signals.”
- Counts come from the current page, sometimes rounded. This extension does not
  fetch fresh counts. A stale page may need a reload to obtain newer counts.
- English and French formats are supported. Unknown languages/formats remain
  visible by default.
- A brief flash is possible before the content script or metadata loads.
- Site markup changes, custom CSS priority, or removed/replaced metadata can
  reduce coverage. See the guide for how to investigate safely.

## Develop

Requires Node.js 22 or newer and npm. All dependencies are development-only.

```sh
npm ci
npm test
npm run build
npm run lint:firefox
```

`npm run check` runs all three checks. Builds produce unpacked directories and
ZIPs in `dist/`. No build output or dependencies are committed.

For a manual Brave/Chrome fixture check, serve the project locally and open
`tests/browser-fixture.html`. It runs the production parser and controller with
synthetic cards and a test-only adapter/storage shim, without installing the
extension. See [GUIDE_ROOT.md](GUIDE_ROOT.md) for architecture and verification.
