# Minimum Views Filter

**Stop training the algorithm. Stop being its guinea pig.**

X and YouTube try out new, unproven posts on a sample of viewers to see how they
perform, and your feed fills with things almost nobody watched. The usual fix is
clicking “Not interested” on each one, which gives the platform free labels
about what is good. This extension does neither: it quietly hides anything
below a view count you choose, so you only see posts that have already earned
an audience.

- **One rule: views.** Below your minimum (default 1,000) is hidden; at or above
  is shown, however new the post. Nothing else is judged.
- **No feedback, ever.** It never clicks, likes, dismisses, mutes, or reports
  anything, and makes no network requests.
- **Your feeds only.** X Home (For You and Following), YouTube Home, and the
  recommendations beside a video. Search, profiles, and channels stay untouched.
- **Separate X and YouTube minimums**, plus creator whitelists you can add to by
  right-clicking a post or video.
- **Nothing is blacklisted.** If an item later shows enough views, it comes back.
- **Chrome, Brave, and Firefox.** Light on CPU: only changed cards are rechecked.

Hiding a post in your browser cannot stop the site from logging that it showed
it to you. What it does guarantee is that you never click a feedback button.

## Install

Download version 1.5.0 from the [GitHub release](https://github.com/GerardWu100/minimum-views-filter/releases/tag/v1.5.0):

- [Chrome / Brave ZIP](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.5.0/minimum-views-filter-chrome-brave-1.5.0.zip)
- [Firefox ZIP — unsigned](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.5.0/minimum-views-filter-firefox-1.5.0.zip)

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

### Updating an unpacked Chrome / Brave install

1. Replace the files in the existing extension folder with the new browser ZIP's contents.
2. Open `chrome://extensions` or `brave://extensions` and click **Reload** on
   **Minimum Views Filter**. Check that the displayed version matches the download.
3. Reload X and YouTube tabs, then reopen the popup and save your settings.

**Upgrading from 1.4.0 or earlier resets your settings once.** Version 1.5.0
stores settings in sync storage and gives the Chromium build a fixed extension ID
(`lbjagemindgbhajfhagehgodegndnnhi`), so the old saved values are not carried over.
Before updating, open the popup and write down both minimums and copy both
whitelists; re-enter them and click **Save** afterwards. If Chrome/Brave shows the
old and new entries side by side, remove the old one.

**Reloading only the website is insufficient after replacing extension files.**
Chromium can load the new popup while still injecting cached content scripts.
The popup and page filter can then disagree about the settings they understand.
[Chrome's reload requirements](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#when_to_reload_the_extension)
require both an extension reload and a host-page reload for content-script changes.

If X still behaves as though the minimum is 1,000 after you save 10,000, perform
both reloads above before investigating count parsing. Check that X Home is
selected and the post author is not whitelisted.

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

**Right-click** a post or video on X or YouTube and choose **Always show this
creator**. The toolbar icon briefly shows ✓ (added or already listed), ? (no creator
found where you clicked) or ! (whitelist too long to sync, or storage failed).
Inside a card this is always the card's author, never a mentioned or quoted
account. Outside cards, right-click a profile or channel link, such as the
channel name below a YouTube video. It works on every X/YouTube page, not only
filtered ones. Open X/YouTube tabs from before installation need a reload first.

You can also edit the lists in the popup: open **X account whitelist** or
**YouTube channel whitelist**, enter one creator per line or separate entries
with commas, then click **Save**.

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

Each whitelist must fit one browser sync item (8 KB): at least 450 X handles or
230 YouTube channel IDs. The popup and right-click menu refuse additions beyond that.

Handles are case-insensitive; YouTube channel IDs retain their exact case.
[YouTube's handle documentation](https://support.google.com/youtube/answer/11585688?hl=en)
distinguishes unique handles from display names and documents Unicode handles.

## Sync and copying settings

Settings are saved in the browser's extension **sync storage**:

| Browser | What happens |
| --- | --- |
| Chrome | Syncs between computers signed in to the same Google account with extension sync on |
| Firefox | Syncs through a Firefox account once the add-on is signed and installed on each computer |
| Brave | Saved on this computer only; Brave Sync does not sync extension data |

To move settings anywhere, including between Brave and Firefox, open **Copy
settings to another browser** in the popup and click **Copy**. In the other
browser, paste the text into the same box, click **Load pasted**, check the
values, and click **Save**.

## Performance

Changed cards are reconsidered individually. Sidebar/player updates do not rescan
the feed, and hidden tabs pause observation and URL checks until you return.
Disabled sites and excluded pages do not observe DOM changes. The filter keeps
no long-lived collection of hidden page elements; pending work is bounded.

In a synthetic 200-card feed, 20 single-card count changes required **20 count
reads instead of 4,000**. Unrelated mutations required **zero instead of 4,000**.
Both X and YouTube produced the same results. These measure extension work in
jsdom, not total browser CPU or RAM. Hidden cards remain in the site's DOM; the
extension does not control YouTube/X's own memory use or media loading.

See [the measured workloads and reproduction command](docs/performance.md).

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

- The extension makes no network requests, records no post/video IDs, and has
  no analytics. Its small background script only handles the right-click menu.
- Thresholds, whitelists, and switches are in browser sync storage. **With Chrome
  or Firefox sync on, your browser's vendor stores them in your account**,
  including which creators you whitelisted. Brave keeps them on this computer.
- Permissions: X/Twitter and desktop YouTube pages, storage, and the right-click
  menu. It does not access other extensions' settings or private storage.
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
