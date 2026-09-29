# Minimum Views Filter developer guide

Read `AGENTS.md` for the user's requirements and `README.md` for supported
surfaces, installation, and privacy limits.

## Runtime flow

`isSupportedPage` allows only X `/home` and YouTube `/` or `/watch`. URL query
parameters do not affect this pathname check. Other routes are unfiltered even
when the unknown-count option is enabled. Watch-page card selectors target
recommendations beside/below the active player; the player is not a card.
Content scripts still match the whole site so navigation from an excluded page
to Home works without reloading. Each reconciliation checks the current route
and removes obsolete hiding marks when navigating to an excluded page.

The Manifest V3 content script loads `settings.js`, `filter-core.js`, and
`content.js`, plus the scoped hide and highlight CSS rules. `background.js` (a Chrome service
worker, or a Firefox background script after `settings.js` and `history-store.js`)
owns the right-click menu and serializes local history reads/writes/resets. There
is no page-world injection, network request, or dependency in the installed package.

`settings.js` is the shared source of settings rules and constants: defaults,
`STORAGE_AREA` (`sync`), the 8,192-byte per-item sync quota check, site URL
patterns (also used by the build for manifest matches), the menu message type,
and the copy/paste transfer format.

`filter-core.js` exposes `MinimumViewsCore` to the isolated extension world and
CommonJS tests. `getCards` selects outer independent cards. Generic YouTube
wrappers must link to a video; playlists/channels/playables and known ad wrappers
are excluded. X quote subtrees never supply the outer post's count.
`getViewCount` reads bounded metadata across count and accessibility sources,
preferring exact accessible count labels over rounded ones. Contradictory exact
labels fail open. `getXEngagement` reads only own like/bookmark buttons and group
labels in one subtree query with reusable parsing patterns, excluding quote,
body, and social-context subtrees.
English/French parsing returns `null` for unknown or contradictory data.
Abbreviated counts are rounded to whole views (4.1M is 4,100,000, not a float
just below it). French accepts `M de vues` and `Md` (milliard) forms.
`getCreatorIdentifiers` reads the own X User-Name/status link or bounded YouTube
channel/byline metadata. The settings normalizer canonicalizes X handles without
@, YouTube handles with @ (NFC/lowercase), and case-sensitive `channel/ID` values.
Unknown creators return an empty array; quoted authors, mentions, repost context,
and arbitrary title/body links cannot establish an exemption.
X author extraction tracks one identifier and returns unknown on a second
distinct valid identifier, including conflicts between profile and status links.
YouTube processes creator containers in DOM order and skips nested containers
whose links were already scanned by an outer source. Anchor sources contribute
only themselves; they do not suppress nested sources. All tracking is local to
the call, so no creator decision or DOM reference is cached between passes.

`content.js` selects `xMinimumViews`/`xWhitelist` or the YouTube counterparts
by host, merging any settings changes that arrive during startup. The whitelist
Set is rebuilt only when relevant settings change. Each card's count is read
first; creator metadata is parsed only for cards that would otherwise be hidden,
because the whitelist can only cancel a hide. Creator and count metadata
are read fresh for each affected card, so reused nodes cannot inherit a decision.

The observer watches site-specific attributes. X omits `class`/`title`, which its
adapter never reads. YouTube drops a class record unless one of
`getDecisionClassNames` appeared or disappeared, so hover restyles on either site
read no card. The observer routes remaining mutations through
`getCardSelector` to the owning outer card or X cell. Added subtrees are
inspected locally; unrelated sidebar/player changes are discarded.
Overlapping scopes merge, and more than 32 pending scopes collapse into a full
pass. An 80 ms throttle batches changes. `getCards` includes a matching
Element root as well as descendants, so standalone inserted cards work.
Startup, navigation, relevant settings, language changes and tab resume use full
passes. X shared cells, lost card identities and quote-role changes reconcile their
old hiding marks before wrappers can be reused.

Hiding attributes are the durable state; no collection retains hidden DOM nodes
between passes. Each scope compares existing marks with desired targets and only
writes changed attributes. The `html[data-minimum-views-active]` CSS gate prevents
a detached, previously marked node from hiding when reinserted on an excluded or
disabled page. Foreign styles, classes, hidden attributes and player state remain
untouched. Pending element references are cleared on each scan or suspension.

Hidden tabs and back-forward cache suspension disconnect the observer, clear the
queue and stop the URL timer. Returning visible performs one full reconciliation.
Disabled sites and excluded routes disconnect DOM observation, while retaining
one visible-page URL check per second so silent navigation into Home can resume
filtering. This timer never fetches counts or scans the DOM. Storage failure and
unload remove the active flag, restore connected marks, and release listeners.

`popup.js`, loaded only by `options.html`, validates view thresholds, whitelists,
site/rule/statistics switches, and the X ratio settings defined in `settings.js`, then saves to extension
sync storage. Percentage inputs accept finite values from 0 through 100.
Invalid or over-quota whitelists prevent the whole save and focus the affected
field. Storage changes update all open supported pages. **Copy** writes the
validated form as JSON text (clipboard when allowed, selected text otherwise);
**Load pasted** accepts only complete, valid text from this format and fills the
form without saving. The Settings page never contacts the platforms.

## X engagement decisions and history

The 2026-09-28 feature request adds X low-like filtering and high-engagement
exceptions. Defaults are 0.5% minimum likes/views, 2% rescue likes/views, and 0.5%
rescue bookmarks/views; each rule has its own enabled switch. Settings normalize
missing new keys to these enabled defaults while preserving existing settings.
The settings transfer writes every current setting key. Loading rejects a wrong
format marker, text with no known setting, or any included invalid value; keys
absent from an earlier release's export take their defaults, so a browser still
on an older signed XPI can send settings to a newer one.

For a supported card, read current views, then X engagement when views are
positive and a ratio rule can change the decision. When highlight detection is inactive and the low-like rule is
disabled or set to 0%, cards meeting the enabled view floor skip engagement reads;
below-floor cards still read enabled rescue metrics. A high-like OR high-bookmark
ratio keeps the card. Otherwise a low-like ratio or low views hides it; whitelist matches
rescue any otherwise hidden card. Unknown likes do not establish a low ratio,
and zero/unknown views have no ratio. Comparisons multiply count by 100 and
threshold percentage by views, with a two-operation machine-precision allowance
for decimal boundaries. No history value participates in this decision.

When hiding a card, `getItemMetadata` extracts an own canonical permalink and a
240-character snippet/title. YouTube fallback links exclude description and
creator metadata, so a missing title link cannot attribute their linked videos
to the filtered card. A WeakMap tracks identity on that DOM node without
retaining detached nodes. Stable hidden identities do not produce events on
rescans. A permalink arriving after a linkless hide sends an enrichment event,
which adds the linked entry without increasing totals. Metadata for unidentifiable
recycled cards is inherently ambiguous; totals are hide events, not exact counts
of lifetime unique posts. Reporting failure does not interrupt page filtering.

Content messages contain at most 100 entries; the background verifies its own
extension sender, top frame, exact supported route/host, same item site, reason,
counts, and canonical URLs. Reasons must apply to the item's site and have the
required count snapshots: unknown views are null, while ratio decisions require
positive views and the relevant known numerator. Already canonical stored links
pass a strict format check without creating URL objects. Only the exact Statistics page (`history.html`) may read or reset history
through these messages. A promise queue serializes storage operations across tabs
and resets, and recovers after failed writes. `history-store.js` keeps
`counts[site][reason]` hide events (a site total is `siteTotal` of its reasons,
so the two cannot disagree), `xKeptCounts[keptReason]`, and `xHighlightedCount`, with three independently bounded 500-entry URL
lists: `entries` (hidden), `keptEntries` (kept), and `highlightedEntries`, under
`storage.local.filterHistory` (version 4). Stored counts in any other shape
normalize to zero. Messages carry `outcome`; stored entries omit it because their
list identifies it. Kept events must come from X, name `high-like-ratio` or
`high-bookmark-ratio`, and name the `bypassedReason` (`low-views` or
`low-like-ratio`) the exception overrode.

`getFilterDecision` returns `{reason, keptBy, bypassedReason}`; `getFilterReason`
is its `reason`. `keptBy` is set only when an exception overrode a hide reason,
crediting likes before bookmarks. `content.js` tracks hidden and kept identities
in separate WeakMaps alongside highlighted identities, so each continuous state records once and a card that flips
between them records each new state. Kept cards parse creator metadata only
because they would otherwise be hidden; whitelisted creators produce no hidden/kept events but may highlight. Entries deduplicate by
URL and retain count snapshots, reason, last filtering time, and event count.
No IDs enter sync storage or settings exports, and no platform request is made.
The history page renders through textContent, with links to validated destinations.

## Highlighting, switches, and page presentation

The popup is a compact launcher: `popup-nav.js` opens either `options.html`
(Settings) or `history.html` (Statistics). The manifest's `options_ui` also opens
Settings in a browser tab. Settings and statistics no longer share a page.

`xBookmarkHighlightEnabled` (detection), `xHighlightBookmarkPercent`,
`xBookmarkHighlightShown` (feed edge), `xHighlightLikeRequired`, and
`xHighlightLikePercent` default to true, 1%, true, true, and 2%.
`shouldHighlightX(views, engagement, settings)` requires bookmarks/views AND,
when `xHighlightLikeRequired` is on, likes/views to be strictly above their
thresholds (user request 2026-09-29), with the same floating-point boundary
allowance as filtering. Unknown bookmarks, unknown likes while required, or
zero/unknown views cannot highlight. Detection is active when enabled and either
the edge is shown or statistics are collected; only then does the runtime read
engagement on positive-view X cards that pass every filtering rule. A detected
post is recorded as highlighted whether or not its edge is shown. With the edge
shown, it adds only `data-minimum-views-highlighted` to the visible outer
article. `content.css` draws only a 3px inset amber `box-shadow` edge (80%
alpha). A 1.10.0 fading background wash was removed in 1.10.1 at the user's
request because it tinted the background behind post text. The mid-tone amber stays visible on X's white, Dim (#15202b), and
Lights out (#000) themes without theme detection; the 1.9.0 teal outline at 35%
alpha was nearly invisible on dark themes and also overrode X's focus outline.
X's own background and hover colors are untouched, and the outline stays free for X's focus ring; forced-colors mode gets a system-colored outline.
There is no animation, injected content, layout shift, or inline-style rewrite. The highlight cannot override hiding; whitelisted
posts may highlight. Cleanup reconciles both mark types on mutations, lost card
identity, navigation, settings, and shutdown, with the same document active gate.

Each site has independent `MinimumViewsEnabled` and `WhitelistEnabled`
switches. Turning them off preserves their threshold/list. Site master switches
also disable highlighting. `statisticsEnabled` pauses all outcome reporting
and history metadata extraction while visual decisions continue. The background
checks fresh sync settings inside each queued write. Existing data remains
readable/resettable. Re-enabling resets the runtime WeakMaps so current qualifying
cards begin a new recorded state. A reset alone leaves WeakMaps intact.

`theme.css` supplies shared light/dark colors, cards, buttons, and reason bars;
`options.css` styles settings, and `history.css` styles statistics.
`reason-breakdown.js` renders labeled reason bars using textContent. Native
checkboxes use `role="switch"`; animation starts only after settings load.
Settings switches disable dependent inputs without discarding saved values.
The Statistics page filters loaded entries by Hidden, Kept by high engagement,
or Highlighted, then site/reason. Kept/highlighted lists are X-only. Switching
outcomes clears reason selection; highlighted and kept totals overlap when both
apply to one post. All three lists retain independent event snapshots and bounds.

## Right-click whitelist and sync

A capture-phase `contextmenu` listener in `content.js` stores only the creator
identifier under the pointer, never a DOM reference. Inside a card it uses the
card's single own author (`getCreatorIdentifiers`; ambiguous cards give none);
outside cards it uses a profile/channel link (`getLinkCreatorIdentifier`). The
menu click asks that frame's content script, which consumes the stored value
once, appends it to the site's synced whitelist unless present or over quota,
and replies. The background shows ✓, ? or ! on that tab's toolbar badge for 4 s; ! with
the title "switched off" means the author was stored but that site's whitelist switch is off.
This works on every X/YouTube page because the content script matches the whole
site; the storage change then rescans filtered pages.

Chrome syncs `storage.sync` per extension ID. Unpacked IDs normally derive from
the folder path, so the build adds a public `key` for the fixed ID
`lbjagemindgbhajfhagehgodegndnnhi`. The private key was discarded; it is only needed to sign a
.crx. Firefox already has a fixed gecko ID. Brave Sync does not sync extension
storage ([brave-browser#4094](https://github.com/brave/brave-browser/issues/4094)),
hence the copy/paste transfer. The move from `storage.local` plus the new ID
resets settings once for 1.4.0 users; no migration code exists by design.

## Current verification and limits

For v1.11.0, run `npm ci`, `npm test`, `npm run build`, and
`npm run lint:firefox`. If the shared npm cache is not writable, use a
command-local `--cache /tmp/minimum-views-npm-cache`; no global changes are needed.
The packages now contain 22 files; the stable extension IDs and permissions are
unchanged. Development tests cover both browser API namespaces, English/French
engagement labels, zero/unknown counts, quote exclusion, ratio boundaries and
precedence, exact labels over rounded counts, mutation-driven restoration,
recycled identities, reporting batches/failures, history enrichment, validation,
concurrent tab updates, reset ordering, history bounds, and safe page rendering.

The runtime rules have been executed in jsdom; a fresh installed-browser live-feed
check is not part of this release. Historical live compatibility observations
below do not establish live X bookmark availability or universal DOM coverage
for this release. Next check if a live card behaves unexpectedly: inspect its own
like/bookmark button and group accessibility labels without altering the feed.
Missing bookmark counts cannot rescue or highlight posts; do not fetch them or open posts.
Version 1.9.0 verification (2026-09-29): `npm ci`, `npm test`, build, and
Firefox lint passed (zero errors, notices, or warnings). The tests execute all
eight test files, including strict highlight boundaries, missing and CSS-hidden
counts, recycled IDs, disabled floors/whitelists, stats pausing, highlighted
history validation/enrichment/bounds/reset, page navigation and form switches.
After the final settings-form refinement, its focused tests and the runtime
suite passed again. A Brave localhost preview using synthetic data verified the
full-page settings layout, highlight-switch disabling, separate statistics page,
highlight list, and faint outline appearance. Chrome was unavailable through the
browser-control tool, so the permitted Brave fallback was used. No installed
extension or real browser extension setting was changed. These previews do not
establish live X bookmark-count availability or Firefox rendering.

Version 1.10.0 (2026-09-29): a review of 1.9.0 found that settings text from an
earlier release failed to load, the highlight outline overrode X's focus ring
and was nearly invisible on Dim/Lights out, and the right-click menu reported
"Added" while that site's whitelist was switched off. All three are fixed, and
`xBookmarkHighlightShown` separates the feed edge from detection/recording.
`npm test` (175 tests), build (22 files per package), and Firefox lint (zero
errors, notices, warnings) passed. A synthetic three-theme mockup (white, #15202b,
#000) rendered in the in-app browser confirmed the amber edge is visible on all
three, where the 1.9.0 outline was not. Not yet observed on a live X feed.

Version 1.11.0 (2026-09-29): the highlight requires high bookmarks/views AND high
likes/views by default (`xHighlightLikeRequired`, `xHighlightLikePercent`). 177
tests, build, and Firefox lint passed. Not released as a GitHub release or signed.

Initial engagement/history verification (v1.6.1, 2026-09-28): 140 tests passed,
both 17-file packages built, and
Firefox lint reported 0 errors, 0 notices, and 0 warnings. The synthetic benchmark
passed every expected hiding assertion: 20 one-card mutations required 20 count
reads per site, while unrelated/sidebar and hidden-tab noise required zero. These
workloads mock history messaging and do not measure background storage overhead.
The extra metadata/history work has no live-browser CPU or RAM claim.

Popup/history redesign with per-reason statistics (v1.7.0, 2026-09-28): 145 tests
passed, including per-site/per-reason counting, enrichment not counting, corrupt
count normalization, popup read-only access, popup statistics, whitelist-size
badges, and history chip filters. Both 19-file packages built. Headless Chrome
screenshots of both pages with synthetic history were checked in light and dark
mode. Not yet checked in an installed extension or Firefox's popup renderer.

Kept-by-engagement statistics (v1.8.0, 2026-09-28): 150 tests passed, adding
decision cases (likes vs bookmarks credit, non-rescues, unknown/zero views,
YouTube), once-per-state kept recording with flips and whitelist exclusion,
separate kept counts/lists with validation and enrichment, reset, the kept tab,
and the popup kept block. The synthetic benchmark passed its hiding assertions
(`logs/2026-09-28_002.log`, ignored). Headless Chrome screenshots with synthetic
kept posts were checked. Not yet observed on a live X feed.

Review fixes (v1.8.1, 2026-09-28): all 158 tests pass, both 19-file packages build,
and Firefox lint reports zero errors, notices, and warnings. Regression cases
cover description-link attribution, impossible history snapshots, collapsed
invalid inputs, and delayed reads after Reset. History refreshes coalesce while
one is running and suspend in hidden tabs; reset invalidates earlier read
generations. A 500-row fixture with 20 changes verifies zero hidden-tab reads or
renders and one refresh on return. See [performance measurements](docs/performance.md)
for paired runtime, engagement, and history-transform workloads. These checks
use synthetic data; no installed extension or live-feed behavior was reverified.
Mozilla signed v1.8.1 unlisted. All 19 runtime files match the tested build
(the manifest is semantically equal); the five added files are signatures.

## Build and verify

`scripts/build.cjs` writes a common runtime with separate manifests to
`dist/chrome-brave` and `dist/firefox`. It also generates small PNG icons and
deterministic ZIPs. Firefox declares no data collection and a fixed extension
ID (`minimum-views-filter@gerardwu100.local`); its minimum version is 142.
Builds remain unsigned; Mozilla signing is a separate distribution step.

Both unpacked directories are tracked in Git at the user's request. Run the
build after runtime changes and commit these generated files with their source,
so a pull updates the loadable extension. Do not edit generated files directly.
ZIPs, XPIs, signing directories, `.amo-upload-uuid`, and `.web-extension-id`
remain ignored. Reload an unpacked browser installation after pulling changes;
the tracked Firefox folder is still an unsigned development build.

Whitelist optimization validation on 2026-09-28:

- The full test suite, build, and Firefox lint passed. Four new adapter regressions
  cover conflicting X authors, nested YouTube identities, script-created nested
  anchors, and author sources outside the card boundary.
- Four paired benchmark runs alternated baseline/current execution order against
  commit `ff184ca`. All expected hiding marks and existing adapter/lifecycle counts
  matched. YouTube required fewer selector queries; callback timings varied in
  both directions. See [the measurements](docs/performance.md) and their full data.
- Verification used jsdom; no installed browser extension was updated or timed.

Earlier validation on 2026-09-27:

- 106 tests passed: 29 parser/adapter, 64 runtime/popup, 8 settings, and 5
  background tests. Menu tests cover card authors versus mentions, two posts in
  one X cell, links outside cards, excluded pages, missing/one-shot right-click
  state, duplicate and
  over-quota additions, frames without a content script, and badge restoration.
  Transfer tests cover round trips, alternate spellings, and rejected text.
- Threshold tests cover site independence, defaults, invalid values, and zero.
  Whitelist tests cover known/unknown counts, editing/removal, changing creators,
  foreign hiding rules, quoted/mentioned X accounts, modern/classic YouTube
  metadata, Unicode handles, case-sensitive channel IDs, and invalid URLs.
- Performance/lifecycle regressions cover unrelated mutation noise, hover restyles,
  one-card changes, bounded large bursts, background changes and settings, first load in a
  hidden tab, detached/reinserted nodes, shared X cells, lost card identity, quote
  roles, locale changes, back-forward cache, and teardown before storage resolves.
- Scope regressions cover X search/profiles/Lists, YouTube search/subscriptions/
  channels/playlists, low and unknown counts on excluded pages, watch-page
  recommendations beside/below the player, and navigation with retained cards.
- Browser and Chrome API namespace mocks both passed. Tests run actual scripts
  in jsdom and cover storage-startup races, changing/recycled/new cards,
  navigation, threshold/settings changes, missing metadata, and foreign styles.
- `npm run build` produced both 13-file packages.
- `npm run benchmark` against v1.5.0 commit 2633d3c: creator reads fell 75%
  (e.g. startup 200 → 50); every other operation count is unchanged. See
  `docs/performance.md`.
- Firefox `web-ext lint --warnings-as-errors`: 0 errors, 0 notices, 0 warnings.
- The browser fixture passed in Brave and Firefox 156.0.1 using synthetic
  DOM: low cards hidden even with hidden counters, 1,000 kept, unknown kept,
  1,500 restored, a newly inserted 25-view card hidden, and disable preserved
  the foreign `display:none!important` rule and concealed counters.
- An installed Firefox build saved popup settings. Changing the YouTube minimum
  on a live Home page hid cards below the new threshold and retained a card above
  it without reloading. The **Always show this creator** context-menu item was
  visible; adding a creator and its badge feedback were not exercised.
- Mozilla approved the unlisted 1.5.0 submission and returned a signed XPI.
  Its 13 packaged files match the unsigned build: the manifest is semantically
  identical with different JSON formatting, and the other files match byte for
  byte. Five `META-INF` signature files are the only additions. After removing
  the temporary overlay, Firefox listed the signed build among regular
  extensions and showed zero temporary extensions. Settings exported from the
  temporary copy were imported, saved, and verified after reloading the settings
  page. The signed build also applied the restored threshold to live YouTube Home.
  A fresh page reload exposed missing host permissions after the temporary-copy
  removal. Enabling the six declared X/Twitter/YouTube permissions in the add-on's
  **Permissions and data** tab restored filtering on a fresh YouTube page.
- Live Brave X/YouTube checks confirmed readable metadata with the existing
  extensions active, and later feed checks confirmed threshold filtering. These
  checks do not cover every extension configuration or custom card layout.

To repeat the local fixture with the user's Python convention:

```sh
uv run --no-project python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/tests/browser-fixture.html`. The fixture deliberately
uses hidden counters and a pre-existing foreign hiding rule. Its test shim
dispatches both platform adapters on localhost; it is not in either package.
Stop the temporary server when finished.

## Performance measurement

`npm run benchmark` runs production scripts against synthetic X Home and YouTube
watch cards in jsdom. It counts adapter reads, document scans, callbacks, active
observers/timers, and illustrative synchronous runtime time. The fixture creates
real DOM mutations and validates every expected hiding mark after each batch.
Throttle waits, fixture writes, DOM setup and assertions are excluded from timing.
See [docs/performance.md](docs/performance.md) for the saved comparison and limits.
No claim is made about measured total Brave/Firefox RAM or live browser CPU.

Runtime fixtures dispatch pagehide before closing jsdom, matching actual browser
teardown. Use attribute selectors for repeated YouTube IDs in tests; this jsdom
version can miss duplicate IDs with optimized compound ID selectors.

## Release and project location

The local checkout lives under `one-time-projects/minimum-views-filter` in the
existing projects root. Relative build and test paths keep relocation safe.

GitHub release `v1.5.0` distributes the browser ZIPs, the Mozilla-signed Firefox
XPI, a source ZIP, installation instructions, and SHA-256 checksums. Release
`v1.5.1` (hot-path performance and count-parsing fixes) has the same asset set.
Release `v1.5.2` packages the whitelist extraction changes measured above,
with the same extension IDs, permissions, and settings format.
Mozilla signed its Firefox XPI on 2026-09-28. All 13 build files matched
(the manifest is semantically equal), with only five `META-INF` signature files
added. The release includes the signed XPI and an unsigned development ZIP.
The v1.5.1 unlisted submission was signed with `web-ext sign --channel unlisted` using
AMO API credentials from the ignored `.env` (see `.env.example`). The signed
XPI matched the build: identical runtime files, semantically equal manifest,
plus five `META-INF` signature files. Node's `fetch` in the agent sandbox cannot
reach AMO, so run the signing command from a normal terminal. Runtime
archives are generated from the tagged source and remain ignored by Git; unpacked
browser directories are committed. The
repository is public under the MIT License, so release assets download without
signing in. Mozilla signing was completed separately on 2026-09-27 through the
unlisted self-distribution flow; there is no public Mozilla Add-ons listing.

The signed XPI installs permanently through Firefox's **Install Add-on From
File** command. The unsigned ZIP remains useful for development. There is no
`update_url` in the manifest, so users install newer signed XPIs manually. Keep
the same gecko ID and increment the version for future releases so Firefox
updates the existing add-on and retains its settings.

A temporary copy with the same ID can continue to mask an installed signed XPI.
Export settings before removing that temporary copy, then import and save them
in the permanent one; the tested switch started with fresh default settings.
Check `about:debugging` for zero temporary copies and a regular installed entry.
Also verify its six declared host permissions in `about:addons`; removing the
temporary copy left those permissions off in the tested session. A working popup
does not establish that content scripts can run. Reload a supported site after
granting access to verify the installed extension, rather than a retained script.

For future releases: run `npm run check`, commit and push the release source,
build a source archive from that commit, and submit the Firefox ZIP as a new
unlisted version to Mozilla. Compare the returned signed XPI's runtime files and
manifest with the build, then generate checksums for all release archives and
upload them against an explicit version tag and target commit. Download the
published assets to a temporary directory and compare their hashes before
reporting success. GitHub publication alone does not sign a Firefox build.

`npm run sign:firefox` submits `dist/firefox` as an unlisted version with
`web-ext sign`, reading `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` from the ignored
`.env` through Node's `--env-file`, and saves the signed XPI in ignored
`dist/signed/`. The runtime is unminified, so no review source upload is needed.
Run it outside the agent sandbox (the sandbox cannot reach AMO). On 2026-09-28
this command signed v1.7.0 unlisted: all 18 runtime files matched the build
byte for byte, the manifest was semantically equal, and five `META-INF` signature
files were added. The XPI and updated checksums were added to release v1.7.0,
and every published asset, including a logged-out XPI download, matched.

## Diagnosing a popup/page threshold mismatch

Chromium caches content scripts independently of popup HTML/JavaScript. Updating
an unpacked directory can expose new popup controls before the extension has
been reloaded. Website reload alone does not reload the extension. Follow the
README update sequence before changing parser selectors; preserve local settings
and other extensions. This behavior is documented in
[Chrome's reload table](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#when_to_reload_the_extension).

On 2026-09-27 the user reported Save confirmation for 10,000 in the popup, while the live
Home page hid 729 views and kept 1,117 views from the same account. Its analytics
labels were readable; the same-author contrast ruled out a whitelist exemption
for that pair. Reloading X alone did not resolve the mismatch. A local run of the
production scripts with a synthetic 2,300-view card hid it at a stored 10,000 and
kept it at 1,000. The user then confirmed version 1.0.2 and reported that reloading
the extension followed by X resolved the issue. A fresh live DOM check verified
7,741, 3,640, 1,820, and 789 views hidden, with 17,466 and higher counts kept.
The stale unpacked-extension script issue is resolved; no parser change was needed.

Browser automation was blocked from opening Brave's extension-management page.
Do not bypass that policy via another URL, browser surface, raw protocol command,
or browser profile files. For this report, the user performed the extension reload;
the agent verified Home-page count/hiding markers afterwards.

## YouTube compact-counter report

For a visible low-count card, inspect `html[data-minimum-views-active]` and
`[data-minimum-views-hidden]` before changing selectors. An absent active flag
on an enabled, visible Home page means filtering is not active; it does not
establish a parser failure. The popup runs separately from the page script.

In a second Brave report on 2026-09-27, the popup showed YouTube enabled at
10,000 while 3.8K and 1.3K cards remained visible. Their accessible count labels
were present, but the affected tab had no active flag and zero hiding marks.
Reloading that tab alone restored the active flag and hid five cards with
4.1K, 5.3K, 2.5K, 78, and 72 views; sampled cards at 18K and above stayed visible.
The other open YouTube Home tab already filtered correctly. No setting,
permission, installed extension, or runtime source was changed. This confirms
the page-reload remedy, not the earlier event that left the script inactive.
After installation or an extension reload, refresh each existing site tab;
a working popup alone does not verify the page script is running.

On 2026-09-27 the user reported a visible 511-view Home card after the extension
reload for X. A fresh YouTube Home tab showed the exact same video at 538 views,
with a readable `aria-label="538 views"`, this extension's hiding mark and computed
`display:none`. The shortened visible label retained its accessible count, so no
parser change was needed. Existing YouTube tabs must also be refreshed after an
extension reload. Regression fixtures cover this modern compact metadata on Home
and watch pages, including restoration at 1.2 thousand views. The diagnostic tab
was closed; no installed extension or other extension setting was changed.

## Open issues and verification limits

- **Creator addition, menu persistence, and cross-computer sync need checks.**
  Firefox displayed the menu and saved popup settings, while unit tests cover
  additions and badge feedback. Next step: right-click a visible X post and a
  YouTube channel link, select the menu item, and confirm the ✓ badge and popup
  whitelist; restart Firefox and confirm the menu remains. With Chrome or
  Firefox sync enabled, confirm a second computer receives the settings.
- **Full live-feed coexistence remains bounded.** Browser fixtures and live
  threshold changes establish filtering and preservation of foreign styles for
  the tested cards, but cannot establish every configuration of the supplied
  extensions. Next step: inspect normal scrolling and PocketTube's custom
  layouts in the installed browser. Leave unreadable counts visible.
- **YouTube identity aliases are not resolved.** The whitelist supports observed
  @handle and /channel/ID links, not display names or legacy /c/ and /user/ links.
  If the configured identifier differs from the one on the card, it does not
  match; copy the card's channel link or list both known identifiers. No identity
  lookup is made. Missing creator metadata uses the ordinary view-count policy.
- **Markup/locale coverage is intentionally bounded.** English/French desktop
  cards are supported; other locales, PocketTube Deck, and future DOM layouts
  may remain unfiltered. Capture only sanitized card structure, reproduce in a
  fixture, then extend selectors without searching arbitrary titles/body text.

Last checked: 2026-09-27, Firefox 156.0.1, Node.js 26.8.2, jsdom 29.1.1,
web-ext 10.7.0. Runtime tests caught and verified the fix for a startup storage
race; the corrected merge retains unrelated stored settings.
