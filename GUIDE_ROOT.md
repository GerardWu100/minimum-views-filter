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
`content.js`, plus the single scoped CSS rule. `background.js` (a Chrome service
worker, or a Firefox background script after `settings.js`) only owns the
right-click menu. There is no page-world injection, network request, or
dependency in the installed package.

`settings.js` is the shared source of settings rules and constants: defaults,
`STORAGE_AREA` (`sync`), the 8,192-byte per-item sync quota check, site URL
patterns (also used by the build for manifest matches), the menu message type,
and the copy/paste transfer format.

`filter-core.js` exposes `MinimumViewsCore` to the isolated extension world and
CommonJS tests. `getCards` selects outer independent cards. Generic YouTube
wrappers must link to a video; playlists/channels/playables and known ad wrappers
are excluded. X quote subtrees never supply the outer post's count.
`getViewCount` reads bounded metadata, preferring exact accessible count labels.
English/French parsing returns `null` for unknown or contradictory data.
`getCreatorIdentifiers` reads the own X User-Name/status link or bounded YouTube
channel/byline metadata. The settings normalizer canonicalizes X handles without
@, YouTube handles with @ (NFC/lowercase), and case-sensitive `channel/ID` values.
Unknown creators return an empty array; quoted authors, mentions, repost context,
and arbitrary title/body links cannot establish an exemption.

`content.js` selects `xMinimumViews`/`xWhitelist` or the YouTube counterparts
by host, merging any settings changes that arrive during startup. The whitelist
Set is rebuilt only when relevant settings change. Creator and count metadata
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

`popup.js` loads and validates the two thresholds, two whitelists, and three
boolean switches defined in `settings.js`, then saves to extension sync storage.
Invalid or over-quota whitelists prevent the whole save and focus the affected
field. Storage changes update all open supported pages. **Copy** writes the
validated form as JSON text (clipboard when allowed, selected text otherwise);
**Load pasted** accepts only complete, valid text from this format and fills the
form without saving. The popup never contacts the platforms.

## Right-click whitelist and sync

A capture-phase `contextmenu` listener in `content.js` stores only the creator
identifier under the pointer, never a DOM reference. Inside a card it uses the
card's single own author (`getCreatorIdentifiers`; ambiguous cards give none);
outside cards it uses a profile/channel link (`getLinkCreatorIdentifier`). The
menu click asks that frame's content script, which consumes the stored value
once, appends it to the site's synced whitelist unless present or over quota,
and replies. The background shows ✓, ? or ! on that tab's toolbar badge for 4 s.
This works on every X/YouTube page because the content script matches the whole
site; the storage change then rescans filtered pages.

Chrome syncs `storage.sync` per extension ID. Unpacked IDs normally derive from
the folder path, so the build adds a public `key` for the fixed ID
`lbjagemindgbhajfhagehgodegndnnhi`. The private key was discarded; it is only needed to sign a
.crx. Firefox already has a fixed gecko ID. Brave Sync does not sync extension
storage ([brave-browser#4094](https://github.com/brave/brave-browser/issues/4094)),
hence the copy/paste transfer. The move from `storage.local` plus the new ID
resets settings once for 1.4.0 users; no migration code exists by design.

## Build and verify

`scripts/build.cjs` writes a common runtime with separate manifests to
`dist/chrome-brave` and `dist/firefox`. It also generates small PNG icons and
deterministic ZIPs. Firefox declares no data collection and a fixed extension
ID; its minimum version is 142. Signing is an external distribution step.

Validation on 2026-09-27:

- 105 tests passed: 29 parser/adapter, 64 runtime/popup, 8 settings, and 4
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
- `npm run benchmark` against v1.4.0: every operation count unchanged.
- The right-click menu, badge, and real sync were **not** exercised in an
  installed browser; they rely on documented Chrome/Firefox APIs and mocks.
- Firefox `web-ext lint --warnings-as-errors`: 0 errors, 0 notices, 0 warnings.
- The initial build was checked in Brave using `tests/browser-fixture.html` and synthetic
  DOM: low cards hidden even with hidden counters, 1,000 kept, unknown kept,
  1,500 restored, a newly inserted 25-view card hidden, and disable preserved
  the foreign `display:none!important` rule and concealed counters.
- Live Brave X/YouTube DOM was inspected read-only to confirm current count
  labels and wrapper shapes with the user's extensions active. No actual
  extension installation or full live-feed end-to-end filtering was performed.

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

GitHub release `v1.5.0` distributes the browser ZIPs, a source ZIP, installation
instructions, and SHA-256 checksums. Runtime artifacts are generated from the
tagged source and remain ignored by Git. The repository is public under the
MIT License, so release assets download without signing in. Publishing a GitHub
release does not submit to either browser store or sign the Firefox package.

For future releases: run `npm run check`, commit and push the release source,
build a source archive from that commit, generate checksums for all ZIPs, then
upload the assets against an explicit version tag and target commit. Download
the published assets to a temporary directory and compare their hashes before
reporting success.

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

On 2026-09-27 the user reported a visible 511-view Home card after the extension
reload for X. A fresh YouTube Home tab showed the exact same video at 538 views,
with a readable `aria-label="538 views"`, this extension's hiding mark and computed
`display:none`. The shortened visible label retained its accessible count, so no
parser change was needed. Existing YouTube tabs must also be refreshed after an
extension reload. Regression fixtures cover this modern compact metadata on Home
and watch pages, including restoration at 1.2 thousand views. The diagnostic tab
was closed; no installed extension or other extension setting was changed.

## Open issues and verification limits

- **Right-click menu and sync need an installed-browser check.** Unit tests
  mock the APIs. Next step: in Brave/Chrome, reload the extension, right-click a
  visible X post and a YouTube channel link, and confirm the ✓ badge and popup
  list; with Chrome sync on, confirm a second computer receives the settings.
  Firefox event-page menus are recreated on install and startup; confirm the
  item still appears after a Firefox restart once a signed build exists.

- **Permanent Firefox installation remains unsigned.** Code, package, and lint
  are complete. No Mozilla account/signing workflow was used. Next step: submit
  `dist/minimum-views-filter-firefox-1.5.0.zip` for unlisted signing, then test
  the returned XPI in release Firefox. Do not weaken signature settings.
- **Full live-feed coexistence remains a manual installation check.** No browser
  settings or other extension settings were changed. The page DOM observations
  and fixture tests establish count readability and preservation of foreign
  styles, but cannot establish every configuration of the supplied extensions.
  Next step: install unpacked in Brave, reload X/YouTube, and inspect normal
  scrolling and PocketTube's custom layouts. Leave unreadable counts visible.
- **YouTube identity aliases are not resolved.** The whitelist supports observed
  @handle and /channel/ID links, not display names or legacy /c/ and /user/ links.
  If the configured identifier differs from the one on the card, it does not
  match; copy the card's channel link or list both known identifiers. No identity
  lookup is made. Missing creator metadata uses the ordinary view-count policy.
- **Markup/locale coverage is intentionally bounded.** English/French desktop
  cards are supported; other locales, PocketTube Deck, and future DOM layouts
  may remain unfiltered. Capture only sanitized card structure, reproduce in a
  fixture, then extend selectors without searching arbitrary titles/body text.

Last checked: 2026-09-27, Node.js 22.17.0, jsdom 29.1.1, web-ext 10.7.0.
The newest threshold/whitelist controls were verified in jsdom, without installing
the extension into the user's browser. Runtime tests caught and verified the fix for
a startup storage race; the corrected merge retains unrelated stored settings.
