# Minimum Views Filter

## User's goal and requirements

Build a browser extension for Chrome, Brave, and Firefox that hides X posts and
YouTube videos with fewer than 1,000 views from the user's feeds. The user wants
to avoid low-view recommendations without clicking “Not interested” or training
the platform through negative-feedback actions.

- Filter locally in the page. Never click, like, dismiss, mute, block, unsubscribe,
  submit feedback, or call platform APIs on the user's behalf.
- Each site defaults to a 1,000-view minimum: hide 0–999; keep 1,000 and above,
  subject to the X engagement rules below.
- On X, also hide posts below an adjustable likes/views percentage (default
  0.5%). Keep posts at or above an adjustable likes/views percentage (default 2%)
  OR bookmarks/views percentage (default 0.5%), overriding both hiding rules.
  Each ratio rule has its own switch. Ratios require known, positive views and
  a known numerator; missing likes/bookmarks are unknown, never implicit zero.
- Whitelisted X accounts bypass all ratio rules as well as the view rules.
- Keep local filtering-event totals and the latest 500 identifiable filtered
  items with canonical links, snippets/titles, count snapshots, reasons, and
  timestamps. Provide a reset action. This user-requested history must never
  become a blacklist, be synced, be uploaded, or hold DOM references.
- Do not permanently blacklist IDs. An item must become eligible again when the
  site's displayed counts meet the current rules, including on a later visit.
- Expose independent X and YouTube minimums and switches; the user may set a
  higher X threshold than YouTube.
- Provide separate X account and YouTube channel whitelists. A matching creator
  bypasses both the minimum and unknown-count rule, within the allowed pages.
  Match profile handles/links, never ambiguous display names, mentions, or quoted
  authors. Whitelist changes and recycled creator links must apply immediately.
  Store settings in the browser's extension sync storage (the user requested
  browser-account sync on 2026-09-27); never resolve identities through network
  requests or add a server. A right-click menu may add the clicked card's author.
- Missing counts are unknown, not zero. Keep them visible by default; an explicit
  setting can hide unknown-count video/post cards.
- Read existing DOM text and accessibility labels even when CSS hides them.
  Prefer exact accessibility counts to rounded visible counts.
- Reduce CPU work and memory allocation without changing filtering behavior.
  Route mutations to affected cards; avoid whole-page scans for sidebar/player
  changes. Suspend work in hidden tabs, disconnect DOM observation on excluded
  or disabled pages, bound pending queues, and do not retain hidden DOM nodes.
  Measure representative workloads before making performance or RAM claims.
- Handle new cards, changed counts, recycled DOM nodes, and navigation without
  requiring full-page reloads. Never fetch counts or run background collection.
- Coexist with the user's extensions. Add/remove only this extension's own
  hiding attribute; preserve existing classes, inline styles, hidden attributes,
  player controls, network behavior, titles, thumbnails, and other filters.
- Do not promise complete compatibility with arbitrary user scripts or styles.
  If every copy of a count is removed, use the unknown-count policy.
- This changes presentation; it cannot guarantee that the platform did not log
  an impression or use other activity to personalize recommendations.
- Filter X only on its Home page (For You and Following), never on search,
  profiles, Lists, conversations, notifications, or other pages.
- Filter YouTube only on Home and on recommendations beside or below the video
  being watched. Never filter search, subscriptions, channels, history, playlists,
  the Shorts player, or other pages. Keep the active video player visible.
- Navigating away from an allowed page must remove this extension's hiding marks,
  including on sites that navigate without a full page reload.
- Do not install into the user's browser or change existing extension settings
  as part of development unless the user requests that action.

## Existing extensions that matter for compatibility

User supplied these versions on 2026-09-27: Control Panel for Twitter 4.24.3,
Improve YouTube 4.2081, DeArrow 2.3.10, Enhancer for YouTube 3.0.19, PocketTube
18.9.0, Return YouTube Dislike 4.0.5, SponsorBlock 6.1.6, Stylus 2.4.14, uBlock
Origin 1.75.0, and Violentmonkey 2.49.0. Playback/keyboard extensions also
include Global Speed 3.4.122, h264ify 2.0.1, Disable YouTube Number Keyboard
Shortcuts 1.0, Picture-in-Picture 1.14, and Volume Master 2.4.0.

Do not modify, disable, or reset those extensions to make this one work. Read
`GUIDE_ROOT.md` for verified compatibility observations and remaining limits.

## Project workflow

- Repository: `GerardWu100/minimum-views-filter`, public under the MIT License
  (the user requested publication on 2026-09-27).
- Keep the local checkout under `one-time-projects/minimum-views-filter` within the existing projects root.
- Publish downloadable browser ZIPs as GitHub release assets, not committed build files.
  Label Firefox packages unsigned until Mozilla signing is complete.
- Keep runtime code dependency-free. Development/build packages stay in npm devDependencies.
- Use `npm ci`, `npm test`, `npm run build`, and `npm run lint:firefox`.
- Add behavior tests for meaningful filtering changes. Cover 999/1,000 boundaries,
  hidden/removed counts, new and recycled cards, count increases, and preservation
  of other extensions' DOM changes.
- Update the README and guide when behavior, installation, or limits change.
- Do not commit dependencies, credentials, browser profiles, personal feed content,
  logs, or generated distribution files.
- Verify, review the staged diff, commit with plain `git commit`, and push.
