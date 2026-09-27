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
`content.js`, plus the single scoped CSS rule. There is no background worker,
page-world injection, network request, or dependency in the installed package.

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

`content.js` merges local settings with any changes that arrived during startup,
then reconciles hideable DOM nodes. It selects `xMinimumViews`/`xWhitelist` or
`youtubeMinimumViews`/`youtubeWhitelist` by host. Whitelisted creators bypass
both low-count and unknown-count rules, using current links on every scan so
recycled nodes cannot inherit an exemption. It marks low-count nodes with
`data-minimum-views-hidden`; `content.css` makes them `display:none!important`.
X uses a `cellInnerDiv` wrapper only when it contains exactly one tweet/article.
The next pass removes obsolete marks, including when a node is reused, its
count rises, the route changes, or filtering is disabled. Detached nodes leave
the Set. Nothing records IDs across visits.

A MutationObserver coalesces relevant page mutations into one pass with an
80 ms throttle. Its own hiding attribute is excluded from observation. A
one-second timer checks only the URL for single-page navigation without a DOM
event; it does not poll counts or make requests. No timer exists outside the
open matching page. Storage failure leaves the page unfiltered.

`popup.js` loads and validates the two thresholds, two whitelists, and three
boolean switches defined in `settings.js`, then saves to extension local storage.
Invalid whitelist entries prevent the whole save and focus the affected field. Storage changes update all open supported
pages. The popup never contacts the platforms.

## Build and verify

`scripts/build.cjs` writes a common runtime with separate manifests to
`dist/chrome-brave` and `dist/firefox`. It also generates small PNG icons and
deterministic ZIPs. Firefox declares no data collection and a fixed extension
ID; its minimum version is 142. Signing is an external distribution step.

Validation on 2026-09-27:

- 68 tests passed: 28 parser/adapter, 34 runtime/popup, and 6 settings tests.
- Threshold tests cover site independence, defaults, invalid values, and zero.
  Whitelist tests cover known/unknown counts, editing/removal, changing creators,
  foreign hiding rules, quoted/mentioned X accounts, modern/classic YouTube
  metadata, Unicode handles, case-sensitive channel IDs, and invalid URLs.
- Scope regressions cover X search/profiles/Lists, YouTube search/subscriptions/
  channels/playlists, low and unknown counts on excluded pages, watch-page
  recommendations beside/below the player, and navigation with retained cards.
- Browser and Chrome API namespace mocks both passed. Tests run actual scripts
  in jsdom and cover storage-startup races, changing/recycled/new cards,
  navigation, threshold/settings changes, missing metadata, and foreign styles.
- `npm run build` produced both 12-file packages.
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

## Release and project location

The local checkout lives under `one-time-projects/minimum-views-filter` in the
existing projects root. Relative build and test paths keep relocation safe.

GitHub release `v1.0.2` distributes the browser ZIPs, a source ZIP, installation
instructions, and SHA-256 checksums. Runtime artifacts are generated from the
tagged source and remain ignored by Git. The private repository requires an
authorized signed-in account to download release assets. Publishing a GitHub
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
kept it at 1,000. These findings support a cached-script/settings mismatch; they
do not establish the installed extension version or confirm an extension reload.

Browser automation was blocked from opening Brave's extension-management page.
Do not bypass that policy via another URL, browser surface, raw protocol command,
or browser profile files. Ask the user to reload the extension and report its
version, then verify Home-page count/hiding markers again.

## Open issues and verification limits

- **Reported 10,000-view setting still needs an installed-extension reload check.**
  The live page behaves like a 1,000 minimum despite user-reported Save success.
  Current scripts handle the reported count correctly in the local reproduction.
  See the diagnosis above. Awaiting the user's extension version/reload result;
  after that, inspect live count/hiding markers before calling this resolved.

- **Permanent Firefox installation remains unsigned.** Code, package, and lint
  are complete. No Mozilla account/signing workflow was used. Next step: submit
  `dist/minimum-views-filter-firefox-1.0.2.zip` for unlisted signing, then test
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
