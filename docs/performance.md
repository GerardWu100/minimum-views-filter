# Performance measurements

Measured 2026-09-27 with Node.js v22.17.0 and jsdom 29.1.1.
Baseline: v1.0.2 runtime at commit 2e885100. Updated: v1.0.3.
[Full measured results](performance-results.json) include illustrative callback timings.

## Workload and results

Each platform starts with 200 synthetic cards. Each scenario delivers
20 separate mutation batches. New-card batches add 4 cards each.
A nonempty whitelist exercises creator parsing alongside count parsing. The
benchmark checks expected hiding marks on every card after each batch/scenario.

| Site | Scenario | Count reads before | Count reads after | Whole-document scans |
| --- | --- | ---: | ---: | --- |
| X | unrelated-sidebar-player-noise | 4000 | 0 | 20 → 0 |
| X | one-card-count-changes | 4000 | 20 | 20 → 0 |
| X | new-card-batches | 4840 | 80 | 20 → 0 |
| X | hidden-tab-noise | 5600 | 0 | 20 → 0 |
| YouTube | unrelated-sidebar-player-noise | 4000 | 0 | 20 → 0 |
| YouTube | one-card-count-changes | 4000 | 20 | 20 → 0 |
| YouTube | new-card-batches | 4840 | 80 | 20 → 0 |
| YouTube | hidden-tab-noise | 5600 | 0 | 20 → 0 |

Creator-read counts match the count-read columns in this workload. Changing one
card now reads only that card, a 99.5% reduction across the 200-card fixture.
The new-card scenario inspects the 80 added cards, not the existing feed again.
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
