# Minimum Views Filter

A small extension for **Chrome/Brave and Firefox** that hides X posts and
YouTube videos below separate configurable view counts. Both default to **1,000**.
Each site also has a creator whitelist.

It only changes the page in your browser. It never clicks “Not interested,”
sends feedback, or stores a blacklist of posts or videos. If the site later
shows an item with enough views, it becomes eligible again.

## Install

Download version 1.0.2 from the [GitHub release](https://github.com/GerardWu100/minimum-views-filter/releases/tag/v1.0.2):

- [Chrome / Brave ZIP](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.0.2/minimum-views-filter-chrome-brave-1.0.2.zip)
- [Firefox ZIP — unsigned](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.0.2/minimum-views-filter-firefox-1.0.2.zip)

The repository and downloads are private; sign in with an account that has access.
Extract your browser ZIP before loading it, or build it from source below.

### Chrome / Brave

1. Open `chrome://extensions` or `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing
   `manifest.json` (from source: `dist/chrome-brave`).
4. Pin **Minimum Views Filter** if desired, then reload existing X/YouTube tabs.
5. Open the popup to set each site's minimum, edit its whitelist, or disable filtering.

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
| Whitelisted creator | Kept by this extension, even with low/unknown views |
| 0–999 views from other creators | Hidden |
| Exactly 1,000 or more | Kept |
| Count missing, unsupported, or ambiguous | Kept |
| Counter hidden by another extension's CSS | Read from underlying text/accessibility labels |
| Count changes from 800 to 1,500 on the page | Restored automatically |
| Same item appears later with enough views | Kept; there is no stored exclusion |

“Hide unknown view counts” is optional and off by default. Setting the minimum
to zero allows every known count on that site. For example, set **X to 10,000**
and **YouTube to 1,000**. Each site can be disabled separately. Saving settings
updates open supported pages automatically.

X scope: **Home only** (For You/Following). Search, profiles, Lists, opened
conversations, notifications, messages, and all other pages stay unfiltered.

YouTube scope: **Home and recommendations beside or below a video you are
watching**. Search, subscriptions, channel pages, history, playlists, the vertical
Shorts player, and all other pages stay unfiltered. The active video player is
never a filtering target. Recognized Shorts cards on Home/watch pages can be
filtered when they expose counts; known ad containers are excluded. Live
concurrent viewers are not interpreted as total views.

When you navigate away from Home or a YouTube watch page, this extension removes
its hiding marks from retained cards. Other extensions' hiding rules remain intact.

## Creator whitelists

Open **X account whitelist** or **YouTube channel whitelist** in the popup.
Enter one creator per line, or separate entries with commas, then click **Save**.

- X accepts `@NASA`, `NASA`, or `https://x.com/NASA`.
- YouTube accepts `@NASA`, `https://www.youtube.com/@NASA`, or a
  `https://www.youtube.com/channel/UC...` URL. Channel-page section links such
  as `/@NASA/videos` can also be pasted as full URLs.
- Matching creators bypass this extension's low-view and unknown-count rules.
  On X this means the post's author, not a quoted author or the account reposting it.
- Use the channel link attached to the video card. Handles and channel IDs are
  matched as distinct identifiers; both can be listed, but the extension never
  contacts YouTube to find the relationship between them. Display names and
  legacy `/c/` or `/user/` URLs are not matched.
- If creator metadata is missing or unrecognized, the ordinary view-count rule
  applies. A whitelist never overrides another extension's hiding rules.

Handles are case-insensitive; YouTube channel IDs retain their exact case.
[YouTube's handle documentation](https://support.google.com/youtube/answer/11585688?hl=en)
distinguishes unique handles from display names and documents Unicode handles.

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
  analytics or background service worker. Thresholds, whitelists, and switches are stored locally.
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
