# Minimum Views Filter

**Stop being the algorithm's test audience.**

X and YouTube show new posts to a small group of people first to see how they
do, and your feed fills up with posts that have a few dozen views. Clicking
"Not interested" on each one just gives the platform more feedback to work with.

This extension hides posts and videos below a view count you pick (1,000 by
default). On X, it also filters low likes-to-views ratios and keeps posts with
high likes-to-views or saves-to-views ratios, even below your view minimum.
It never clicks anything or requests platform data. Hidden items become eligible
again when their displayed counts meet your rules.

The popup shows how many X posts and YouTube videos were hidden and why (low
views, low likes/views, or unknown views), and how many X posts high engagement
kept visible. **Filtered items and history** opens recent links you can filter
by site and reason. This history stays in your browser.

It filters X Home (For You and Following), YouTube Home, and the
recommendations next to a video you're watching. Search, profiles, channels,
and every other page are left alone. X and YouTube each have their own minimum
and their own creator whitelist, and you can right-click a post to always show
that creator. Works in Chrome, Brave, and Firefox.

One limit: hiding a post in your browser doesn't stop the site from logging
that it showed it to you.

## Install

Download version 1.8.1 from the [GitHub release](https://github.com/GerardWu100/minimum-views-filter/releases/tag/v1.8.1):

- [Chrome / Brave ZIP](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.8.1/minimum-views-filter-chrome-brave-1.8.1.zip)
- [Firefox XPI — Mozilla signed](https://github.com/GerardWu100/minimum-views-filter/releases/download/v1.8.1/minimum-views-filter-firefox-1.8.1.xpi)

Extract the Chrome / Brave ZIP before loading it. Keep the Firefox XPI intact.

### Chrome / Brave

1. Open `chrome://extensions` or `brave://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing
   `manifest.json` (from source: `dist/chrome-brave`).
4. Pin **Minimum Views Filter** if desired, then reload existing X/YouTube tabs.
5. Open the popup to set each site's minimum, edit its whitelist, or disable filtering.

Keep the unpacked directory in a permanent location. Chrome/Brave load its files
from that folder. Minimum Chromium version: 109.

The Git repository includes the unpacked extension in `dist/chrome-brave/`.
If you load that folder directly, `git pull` updates its files; then reload the
extension and X/YouTube tabs using the steps below.

### Updating an unpacked Chrome / Brave install

1. Replace the files in the existing extension folder with the new browser ZIP's contents.
2. Open `chrome://extensions` or `brave://extensions` and click **Reload** on
   **Minimum Views Filter**. Check that the displayed version matches the download.
3. Reload X and YouTube tabs, then reopen the popup and save your settings.

**Upgrading from 1.4.0 or earlier resets your settings once.** Version 1.5.0 and later
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

1. Download the signed Firefox XPI above; do not extract it.
2. Open `about:addons`.
3. Click the gear menu, choose **Install Add-on From File**, and select the XPI.
4. Confirm **Add**, then reload existing X/YouTube tabs. Grant site access if asked.
5. Open the popup to set each site's minimum, edit its whitelist, or disable filtering.

**This is a permanent installation that survives Firefox restarts.** Minimum
Firefox: 142. The release XPI is signed by Mozilla for self-distribution.
It has no public Mozilla Add-ons listing.

Updates are manual: download a newer signed XPI from the GitHub release and
install it with the same steps. The extension keeps the same ID, so Firefox
updates the existing installation and retains its settings. The package has no
automatic update URL. Do not disable signature verification.

If you previously loaded a temporary copy, first use **Copy settings to another
browser** in its popup to keep your preferences. Remove the temporary entry in
`about:debugging`, install the signed XPI, then use **Load pasted** and **Save**
to restore them. A temporary copy can mask the permanent installation until it
is removed.

If Firefox shows **Permission needed**, open `about:addons`, select **Minimum
Views Filter → Permissions and data**, and enable its X/Twitter and YouTube site
permissions. Then reload the feeds. Without site access, the popup can save
settings but the extension cannot filter the page.

Official instructions: [Chrome unpacked extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked),
[Firefox temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/),
[Firefox signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

## Behavior

| Item | Default behavior |
| --- | --- |
| Whitelisted creator | Kept by this extension, even with low/unknown views |
| X likes/views below 0.5% | Hidden unless whitelisted or rescued by a high ratio |
| X likes/views at least 2% OR saves/views at least 0.5% | Kept, even below the view minimum or low-like threshold |
| 0–999 views, without an X ratio exception | Hidden |
| Exactly 1,000 or more | Kept unless the X low-like rule applies |
| Count missing, unsupported, or ambiguous | Kept |
| Counter hidden by another extension's CSS | Read from underlying text/accessibility labels |
| Count changes from 800 to 1,500 on the page | Restored if the X ratio rules also allow it |
| Same item appears later with qualifying counts | Kept; history never acts as an exclusion |

“Hide unknown view counts” is optional and off by default. Setting the view minimum
to zero disables the view floor; X ratio rules still apply. For example, set **X to 10,000**
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

## X engagement rules

The popup has three independent switches and percentage thresholds. All three
are on by default, including after an update:

| Setting | Default | Example |
| --- | --- | --- |
| Minimum likes as % of views | 0.5% | 49 likes / 10,000 views is hidden; 50 meets the minimum |
| Keep when likes reach this % of views | 2% | 10 likes / 500 views keeps the post |
| Keep when saves reach this % of views | 0.5% | 2 bookmarks / 400 views keeps the post, even with zero likes |

The creator whitelist wins first. Then either high-engagement exception wins.
Otherwise, the low-like rule or view minimum can hide the post. Equal-to-threshold
ratios qualify. If both hiding rules fail, history reports the low-like reason.
YouTube uses only its view-count rules.

With unknown or zero views, ratios are undefined and the view-count policy
applies. Unknown likes skip the low-like rule; unknown saves cannot rescue a post.
The extension reads only the post's own counts already in page text/accessibility
labels, even when CSS hides them. It ignores quoted-post metrics and prefers
exact accessibility counts to rounded ones. Saves means X bookmarks. The feature
cannot use a bookmark count that X does not expose in the current card; it never
opens posts to retrieve one. See [X's bookmark-count explanation](https://help.x.com/en/using-x/bookmark-counts).

These are editable screening defaults, not evidence of quality. Ratios from very
small view counts can swing sharply; this version has no minimum sample-size rule.

## Filtered items and statistics

The popup's **Hidden since reset** card shows each site's hide events split by
reason, as a stacked bar with counts and shares:

| Reason | Meaning |
|---|---|
| Low views | Views below that site's minimum |
| Low likes/views | X likes are below the minimum likes-to-views percentage |
| Unknown views | No readable view count, with **Hide unknown view counts** on |

The card also shows **X kept by high engagement**: posts below your view minimum
or minimum likes/views that stayed visible because their likes/views reached
the keep percentage (**High likes/views**) or their bookmarks/views did (**High
bookmarks/views**). When both qualify, the post counts under likes. Posts that
pass your rules anyway, and whitelisted creators, are not counted.

Click **Filtered items and history** in the popup. It opens a page with the same
breakdowns and the latest **500 identifiable items** across both sites. Chips
above the list filter it by site and reason. The **Kept by high engagement** tab
lists the latest 500 kept X posts separately, each labeled with the rule that
would have hidden it (for example, "kept despite low views").
Entries show a link, post snippet or video title, the reason, counts/ratios at the
time of hiding, and the last filtering time. Repeated URLs share one recent entry.
**Reset history** clears all totals, reason counts, kept counts, and entries; current hidden cards are not
counted again merely because history was reset.

Totals count hide events since reset, not lifetime unique IDs and not the number
currently hidden. Repeated appearances, reloads, and disabling/re-enabling filters
can count again. Routine rescans of a continuously hidden item do not. Cards with
no usable link count toward totals but cannot appear in the linked list; if a link
arrives while the same card remains hidden, the entry is filled in without another
hide event. Recycled cards lacking stable links cannot always be distinguished.
The list is a snapshot, not a live feed of updated counts; opening a link is a
normal navigation you initiate.

The history page pauses refreshes while its tab is hidden and catches up when
you return. Reset also cancels older pending snapshots, so a delayed refresh
cannot bring cleared entries back.

History is stored only in extension **local storage**, never browser sync, settings
exports, a server, or the repository. Clearing it does not change filtering. Past
entries are never consulted to decide whether an item should be shown.

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
- Matching creators bypass this extension's view-count, unknown-count, and X engagement rules.
  On X this means the post's author, not a quoted author or the account reposting it.
- Use the channel link attached to the video card. Handles and channel IDs are
  matched as distinct identifiers; both can be listed, but the extension never
  contacts YouTube to find the relationship between them. Display names and
  legacy `/c/` or `/user/` URLs are not matched.
- If creator metadata is missing or unrecognized, the ordinary filtering rules
  apply. A whitelist never overrides another extension's hiding rules.

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
Creator metadata is checked only when a card would otherwise be hidden. Nested
YouTube author containers share one link scan; X author checks stop as soon as
conflicting identities rule out an exemption. Creator links are read fresh each time.
X engagement counters share one subtree query. If the low-like rule is disabled
or set to zero, cards already meeting the view minimum skip engagement parsing.
Local history also avoids reparsing links already in canonical form.

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

- The extension makes no platform requests and sends no analytics. Its background
  script handles the right-click menu and bounded local filtering history.
- Local history records item links (including IDs), short snippets/titles, counts,
  reasons, and timestamps. It is never uploaded or synced and can be reset.
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
ZIPs in `dist/`. The unpacked `dist/chrome-brave/` and `dist/firefox/` directories
are committed alongside source changes. Rebuild before committing; do not edit
generated files directly. ZIPs, XPIs, signing state, and dependencies stay ignored.

For a temporary Firefox development install, open
`about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select
`dist/firefox/manifest.json` after building. This unsigned source build is removed
when Firefox restarts; use the signed release XPI for normal installation.

For a manual Chrome, Brave, or Firefox fixture check, serve the project locally and open
`tests/browser-fixture.html`. It runs the production parser and controller with
synthetic cards and a test-only adapter/storage shim, without installing the
extension. See [GUIDE_ROOT.md](GUIDE_ROOT.md) for architecture and verification.
