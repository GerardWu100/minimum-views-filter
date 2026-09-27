# Performance measurements

Measured 2026-09-27 with Node.js v22.17.0 and jsdom 29.1.1.
Baseline: v1.0.3 runtime at commit 2e9c83c4. Updated: working tree after v1.0.3.
[Full measured results](performance-results.json) include illustrative callback timings.
The v1.0.2 → v1.0.3 change had already removed whole-document scans from these
mutation scenarios (for example, one changed card: 4,000 count reads → 20).

## Workload and results

Each platform starts with 200 synthetic cards. Each scenario delivers
20 separate mutation batches. New-card batches add 4 cards each; hover batches
rewrite one card element's `class` five times, as hover styling does.
A nonempty whitelist exercises creator parsing alongside count parsing. The
benchmark checks expected hiding marks on every card after each batch/scenario.

| Site | Scenario | Count reads before | Count reads after | Observer callbacks |
| --- | --- | ---: | ---: | --- |
| X | unrelated-sidebar-player-noise | 0 | 0 | 20 → 20 |
| X | card-hover-restyles | 20 | 0 | 20 → 0 |
| X | one-card-count-changes | 20 | 20 | 20 → 20 |
| X | new-card-batches | 80 | 80 | 20 → 20 |
| YouTube | unrelated-sidebar-player-noise | 0 | 0 | 20 → 20 |
| YouTube | card-hover-restyles | 20 | 20 | 20 → 20 |
| YouTube | one-card-count-changes | 20 | 20 | 20 → 20 |
| YouTube | new-card-batches | 80 | 80 | 20 → 20 |

No scenario above performs a whole-document scan. The observer attribute list is
now site-specific. The X adapter never reads `class` or `title`, so X's hover
restyles no longer wake the extension or reread the hovered post. YouTube keeps
`class` because metadata classes can establish a count, so a hover restyle still
rereads that one card. Within one observer callback, repeated text/attribute
records for the same element are routed once; this saves ancestor lookups but
does not change the count-read column, which was already deduplicated.
Full scans still occur when their scope is necessary: startup, navigation, settings,
language changes and returning to a visible tab. Resume checks all 280 current cards.

Hidden tabs stop the mutation observer and URL timer. Disabled/excluded visible
pages stop DOM observation but retain the one-second URL check so navigation into
Home can reactivate filtering without a reload. The timer does not inspect counts.

## Memory and interpretation

The runtime no longer keeps a collection of hidden DOM elements. Hiding attributes
store decisions on the site's own nodes, and local reconciliation reads those
attributes only within changed scopes. At most 32 pending scopes are retained
between passes; a larger burst becomes one full pass. Pending scopes and observer
records are released when work is suspended. Whitelist sets and the count-label
regular expression are reused rather than rebuilt on every pass.

These changes reduce extension scanning, temporary allocation and opportunities
to retain detached DOM nodes. **No browser RAM or CPU percentage was measured.**
jsdom timings are single-run synchronous callback work, not a Chrome/Brave/Firefox
speed or memory benchmark. The browser/site still owns hidden cards, images and
players; local CSS filtering does not unload those resources or control other
extensions' memory. Actual total browser RAM savings may therefore be modest.

## Reproduce

`npm run benchmark` measures the current source. For a before/after comparison,
extract the baseline runtime into a temporary directory and provide its src path:

`node scripts/benchmark.cjs --baseline /path/to/baseline/src`

Optional `--cards` and `--batches` values adjust the workload. No network access or
browser installation is needed. The benchmark executes actual runtime scripts,
delivers native MutationObserver records, and drains their scheduled callbacks
without the artificial 80 ms throttle wait. Setup, fixture writes, waits and
assertions are excluded from timing. Results are workload proxies; compare
operation counts first. Do not equate callback time with total process CPU/RAM.
