# Trail notes

## Decisions

- 2026-09-27: Settings live in `storage.sync`. The Chromium build carries a public `key` so its ID stays `lbjagemindgbhajfhagehgodegndnnhi` (private key discarded; only needed for a .crx). The 1.4.0 → 1.5.0 reset is accepted; no migration code by design.
- 2026-09-27: Keep the Firefox gecko ID `minimum-views-filter@gerardwu100.local` and bump the version each release, so the signed XPI updates in place. No `update_url`; updates are manual. Each GitHub release carries both browser ZIPs, the signed XPI, a source ZIP built from the tagged commit, and SHA-256 checksums, uploaded against an explicit tag and target commit; GitHub publication alone does not sign the XPI.
- 2026-09-27: Content scripts match the whole X/YouTube site and check the route themselves, so silent navigation into Home works and the right-click menu works everywhere. Do not narrow the manifest matches.
- 2026-09-27: The settings copy/paste transfer exists because Brave does not sync extension storage. Exports from older versions must still load (missing keys take defaults), so an older signed XPI can hand settings to a newer one.
- 2026-09-29: Mutations are applied at the end of each mutation batch with no delay (X 1.11.1, YouTube 1.11.2 at the user's request). This costs extra reads when a card hydrates in steps; do not reintroduce a batching timer.
- 2026-10-24: All settings writes (Settings page and right-click menu) go through the background's serialized writer, sending only changed keys and whitelist additions/removals. A whole-form write from an old Settings tab erased newer whitelist entries (audit F1/F5).

## Assumptions

- 2026-10-18: X thread-line detection (empty div, width >0 and ≤3px), the outgoing-line position, and the per-theme divider colors come from X's known layout, not a live signed-in page. Check: inspect a joined reply on live X Home in Default, Dim and Lights out.
- 2026-10-17: Re-injection into open tabs after an extension reload works only in jsdom and mocks. Check: reload the extension with an X Home tab open; Statistics must record new X events without reloading the tab.
- 2026-10-17: Author extraction and CSV/JSON export are tested on synthetic markup and a stubbed download only. Check on a live feed and a real saved file.
- 2026-09-29: X exposes bookmark counts in feed cards. Check: read the post's own like/bookmark button and group labels without altering the feed. Never open posts or fetch counts to fill gaps.
- 2026-09-27: Not checked live: adding a creator from the right-click menu (badge and whitelist), the menu after a Firefox restart, sync to a second computer, and PocketTube custom layouts.

## Gotchas

- 2026-09-27: Chromium caches content scripts apart from the popup. After replacing unpacked files, reload the extension and then every X/YouTube tab. Two "threshold ignored" reports were this, not the parser; check `html[data-minimum-views-active]` and the hide marks before changing selectors. Since 1.15.1 the background re-injects into open tabs, but that is unverified live (see Assumptions), so still reload the tabs.
- 2026-09-27: Browser automation cannot open Brave's extension-management page. Do not bypass it through other URLs, raw protocol commands or profile files; ask the user to reload the extension.
- 2026-09-27: Firefox: a temporary copy with the same ID masks the signed XPI, and removing it left the six host permissions off. A working popup does not prove the content scripts run; reload a supported page after granting access.
- 2026-10-10: If the shared npm cache is not writable, pass a command-local `--cache <writable dir>` to `npm ci`; do not change global npm config.
- 2026-09-28: Node's `fetch` in the agent sandbox cannot reach AMO. Run `npm run sign:firefox` from a normal terminal; it reads the AMO keys from `.env`.
- 2026-09-29: X can add a post to `seenTweetIds` before the local hide lands (1 of 39 posts, hidden 45 ms after first seen). Hiding cannot fix this; do not intercept or rewrite requests. Method: `docs/x-seen-list-check.md`.
- 2026-10-24: A YouTube title link's `aria-label` contains the channel name; a channel named "10 views" was once read as the count (audit F3). Strip creator names before parsing.
- 2026-09-27: For an unfiltered live card (new layout, locale, PocketTube Deck), capture only sanitized card structure, reproduce it in a fixture, then extend selectors. Never take counts from arbitrary title or body text.
- 2026-10-24: Benchmark and test mocks must give `runtime.id` a value, or the liveness guard stops the script (both benchmarks were silently broken until audit F7).
- 2026-09-27: jsdom can miss repeated YouTube IDs with compound ID selectors; use attribute selectors in tests. Dispatch `pagehide` before closing jsdom.
- 2026-09-27: The GitHub wiki is a separate repo (`minimum-views-filter.wiki.git`), not part of this checkout.

## Failed approaches

- 2026-09-29: Highlight styles. The 1.9.0 teal outline at 35% alpha was nearly invisible on Dim/Lights out and overrode X's focus ring; the 1.10.0 fading background wash tinted the text background and the user rejected it. *Disproved*; the 3px amber inset left edge replaced both.

## Open blockers

- 2026-09-29: Live checks (scrolling CPU/RAM profile, repeat of the passive seen-list capture, the Assumptions above) need the user to reload the installed extension first, because the agent cannot. Next check: ask for a reload, then run one bounded scrolling session.

## Untried ideas

- 2026-10-31: Minimum sample size for X ratio rules. Ratios on tiny view counts swing sharply (1 reply on 50 views passes 0.1%); a floor such as 100 views is a small settings and decision change.
