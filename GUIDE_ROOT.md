# Minimum Views Filter developer guide

Read `AGENTS.md` for the user's requirements and `README.md` for supported
surfaces, installation, and privacy limits.

## Runtime flow

The Manifest V3 content script loads `filter-core.js`, `settings.js`, and
`content.js`, plus the single scoped CSS rule. There is no background worker,
page-world injection, network request, or dependency in the installed package.

`filter-core.js` exposes `MinimumViewsCore` to the isolated extension world and
CommonJS tests. `getCards` selects outer independent cards. Generic YouTube
wrappers must link to a video; playlists/channels/playables and known ad wrappers
are excluded. X quote subtrees never supply the outer post's count.
`getViewCount` reads bounded metadata, preferring exact accessible count labels.
English/French parsing returns `null` for unknown or contradictory data.

`content.js` merges local settings with any changes that arrived during startup,
then reconciles hideable DOM nodes. It marks low-count nodes with
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

`popup.js` loads and validates the four fields defined in `settings.js` and
saves to extension local storage. Storage changes update all open supported
pages. The popup never contacts the platforms.

## Build and verify

`scripts/build.cjs` writes a common runtime with separate manifests to
`dist/chrome-brave` and `dist/firefox`. It also generates small PNG icons and
deterministic ZIPs. Firefox declares no data collection and a fixed extension
ID; its minimum version is 142. Signing is an external distribution step.

Validation on 2026-09-27:

- 21 parser/adapter tests and 20 runtime/popup integration tests passed.
- Browser and Chrome API namespace mocks both passed. Tests run actual scripts
  in jsdom and cover storage-startup races, changing/recycled/new cards,
  navigation, threshold/settings changes, missing metadata, and foreign styles.
- `npm run build` produced both 12-file packages.
- Firefox `web-ext lint --warnings-as-errors`: 0 errors, 0 notices, 0 warnings.
- Brave ran `tests/browser-fixture.html` using production scripts and synthetic
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

GitHub release `v1.0.0` distributes the browser ZIPs, a source ZIP, installation
instructions, and SHA-256 checksums. Runtime artifacts are generated from the
tagged source and remain ignored by Git. The private repository requires an
authorized signed-in account to download release assets. Publishing a GitHub
release does not submit to either browser store or sign the Firefox package.

For future releases: run `npm run check`, commit and push the release source,
build a source archive from that commit, generate checksums for all ZIPs, then
upload the assets against an explicit version tag and target commit. Download
the published assets to a temporary directory and compare their hashes before
reporting success.

## Open issues and verification limits

- **Permanent Firefox installation remains unsigned.** Code, package, and lint
  are complete. No Mozilla account/signing workflow was used. Next step: submit
  `dist/minimum-views-filter-firefox-1.0.0.zip` for unlisted signing, then test
  the returned XPI in release Firefox. Do not weaken signature settings.
- **Full live-feed coexistence remains a manual installation check.** No browser
  settings or other extension settings were changed. The page DOM observations
  and fixture tests establish count readability and preservation of foreign
  styles, but cannot establish every configuration of the supplied extensions.
  Next step: install unpacked in Brave, reload X/YouTube, and inspect normal
  scrolling and PocketTube's custom layouts. Leave unreadable counts visible.
- **Markup/locale coverage is intentionally bounded.** English/French desktop
  cards are supported; other locales, PocketTube Deck, and future DOM layouts
  may remain unfiltered. Capture only sanitized card structure, reproduce in a
  fixture, then extend selectors without searching arbitrary titles/body text.

Last checked: 2026-09-27, Node.js 22.17.0, jsdom 29.1.1, web-ext 10.7.0,
user's connected Brave session. Runtime tests caught and verified the fix for
a startup storage race; the corrected merge retains unrelated stored settings.
