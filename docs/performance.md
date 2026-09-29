# Performance measurements

## Immediate X mutation evaluation, v1.11.1 (2026-09-29)

Compared with source `403510f`, using Node.js v22.17.0 and jsdom 29.1.1.
[Full synthetic measurements](immediate-x-performance-results.json) retain the
single paired sample, including illustrative timings. Every expected hiding
mark passed after every batch. These results measure work, not browser CPU or RAM.

X now reconciles routed cards within each delivered DOM mutation batch, removing
the intentional 80 ms wait on active Home pages. YouTube keeps that wait.
The additional `staggered-count-bursts` workload delivers four alternating count
updates per batch, at separate microtask checkpoints before timers are drained.
There are 20 batches. It measures the coalescing sacrificed by the immediate path.

| Workload | View-count reads before → after | DOM queries before → after |
| --- | ---: | ---: |
| X startup, 200 cards | 200 → 200 | 1,003 → 1,003 |
| X new cards, 20 batches of four | 80 → 80 | 720 → 720 |
| X one count update per batch | 20 → 20 | 190 → 190 |
| X four staggered count updates per batch | 20 → 80 | 140 → 760 |
| YouTube four staggered count updates per batch | 20 → 20 | 180 → 180 |
| Either site, sidebar/player or hidden-tab noise | 0 → 0 | 0 → 0 |

X mutation workloads use zero timer callbacks after the change (previously 20
per workload). They still avoid document scans. Every YouTube operation count
is unchanged. The extra X reads can also record short-lived filtering transitions
that previously disappeared before the delayed scan. History remains bounded
and never feeds back into filtering. Timing from one pair does not support a
speed claim; this is a deliberate latency/work tradeoff, especially when X
hydrates several metadata fields in separate deliveries.

To reproduce, extract `src/` from commit `403510f` into a temporary directory and
run the current `scripts/benchmark.cjs --baseline /path/to/baseline/src`.
No installed browser was changed or measured after the fix.

## Review fixes, v1.8.1 (2026-09-28)

Compared with v1.8.0 commit `550bd3d`, using Node.js v26.10.0 and jsdom 29.1.1.
The [full samples and operation counts](review-performance-results.json) contain
synthetic data only. Runtime comparisons ran in both execution orders and checked
every expected hiding mark after every mutation batch.

| Workload | Before | After |
| --- | ---: | ---: |
| X 200-card startup, DOM queries | 1,302 | 1,002 |
| X high-engagement exceptions only, all cards meet view floor, metric reads | 150 | 0 |
| X engagement parser, 200 cards × 20 passes, subtree queries | 12,000 | 4,000 |
| History batch, 500 hidden + 500 kept entries, URL object constructions | 1,100 | 0 |
| Hidden 500-row history page, initial load + 20 notifications, reads / renders | 21 / 21 | 0 / 0 |
| Visible history page, 20 notifications during initial read, reads / renders | 21 / 21 | 2 / 1 |

The dedicated engagement fixture includes rounded buttons, exact group labels,
and quoted metrics. Seven alternating samples gave median callback times of
149.29 → 139.75 ms. Nine alternating samples of 200 history batches gave
104.56 → 51.19 ms, with all ten representative batch outputs deeply equal.
The history timing covers validation and in-memory transforms; browser messaging,
storage writes, and interface rendering are excluded. These measurements establish
less parsing work on the fixtures, not a browser-wide CPU or RAM reduction.

Low-view cards still read rescue metrics, and unchanged default filtering
decisions pass the full regression suite.
Sidebar/player noise and hidden content tabs still perform zero card reads.

To reproduce, extract `settings.js`, `filter-core.js`, `content.js`, and
`history-store.js` from commit `550bd3d` into a temporary source directory, then run:

```sh
node scripts/benchmark.cjs --baseline /path/to/baseline/src
node scripts/benchmark-engagement.cjs /path/to/baseline/src
node scripts/benchmark-history.cjs /path/to/baseline/src
node --test tests/history-ui.test.cjs
```

## Whitelist extraction, 2026-09-28

Compared with commit `ff184ca`, YouTube skips nested creator containers after
their outer source has already supplied every link. A nested byline/channel
layout now uses **two queries instead of three** for creator extraction. X
tracks a single author without intermediate filtered/mapped arrays and stops on
the second distinct valid author. Both adapters still read current DOM metadata
on each check; no identities or card decisions are cached.

Four paired runs with Node.js v22.17.0 and jsdom 29.1.1 alternated execution
order (baseline first, current first). The 200-card fixtures now include X's
duplicate profile links and own status permalink, and YouTube's nested
`#byline-container > ytd-channel-name`. After 80 new cards arrive, extra scenarios
enable a matching whitelist with unknown-count hiding, recycle one card's creator
links 20 times, then remove the matching whitelist. Every batch checks all marks.

The query column counts production `querySelector`/`querySelectorAll` calls for
the entire filtering pass, not just creator extraction. Timings include counter
overhead and are medians of the four runs. [Full results and samples](whitelist-performance-results.json).

| Site | Scenario | Queries before → after | Callback ms before → after |
| --- | --- | ---: | ---: |
| X | startup | 602 → 602 | 121.8 → 119.2 |
| X | matching whitelist, low/unknown | 912 → 912 | 89.3 → 91.1 |
| X | recycled creator links | 130 → 130 | 17.7 → 17.8 |
| X | whitelist removed | 1,052 → 1,052 | 110.7 → 99.1 |
| YouTube | startup | 1,152 → 1,102 | 139.3 → 133.5 |
| YouTube | matching whitelist, low/unknown | 1,822 → 1,682 | 100.2 → 96.1 |
| YouTube | recycled creator links | 200 → 180 | 20.7 → 20.8 |
| YouTube | whitelist removed | 1,822 → 1,682 | 117.3 → 122.3 |

All adapter-read, observer, timer and full-scan counts were unchanged. Query
reductions were identical across runs, while timings varied in both directions;
these results establish less duplicate query work, **not a consistent elapsed-time
speedup or a measured browser CPU/RAM reduction**. A combined complex selector
was also tried and discarded after it slowed several scenarios. The retained
implementation keeps the original simple selectors and skips covered containers.

## Earlier runtime measurements

Measured 2026-09-27 with Node.js v22.17.0 and jsdom 29.1.1.
Baseline: v1.0.3 runtime at commit 2e9c83c4. Updated: v1.4.0.
[Full measured results](performance-results.json) include illustrative callback timings.

**Post-1.5.0 hot-path pass** (compared with commit 2633d3c): each card's count
is read before its creator, so creator metadata is parsed only for cards that
would otherwise be hidden. Card selection, quote checks and metadata filters use
fewer, native DOM ancestor/subtree walks, and selector strings are built once.
Every hiding mark and every non-creator operation count is unchanged. Median of
three jsdom runs (callback ms is illustrative, not browser CPU):

| Site | Scenario | Creator reads | Callback ms |
| --- | --- | --- | --- |
| X | startup | 200 → 50 | 120 → 51 |
| X | one-card-count-changes | 20 → 10 | 14 → 8 |
| X | new-card-batches | 80 → 20 | 51 → 32 |
| X | visible-tab-return | 280 → 70 | 92 → 51 |
| YouTube | startup | 200 → 50 | 172 → 101 |
| YouTube | one-card-count-changes | 20 → 10 | 17 → 12 |
| YouTube | new-card-batches | 80 → 20 | 66 → 44 |
| YouTube | visible-tab-return | 280 → 70 | 142 → 93 |

v1.5.0 adds the right-click menu and sync storage without changing filtering work:
compared with v1.4.0 (commit 5cffa9e), every operation count in every scenario is identical.
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
| YouTube | card-hover-restyles | 20 | 0 | 20 → 20 |
| YouTube | one-card-count-changes | 20 | 20 | 20 → 20 |
| YouTube | new-card-batches | 80 | 80 | 20 → 20 |

No scenario above performs a whole-document scan. The observer attribute list is
site-specific. The X adapter never reads `class` or `title`, so X hover restyles
no longer wake the extension. YouTube must still observe `class`, because a few
metadata classes can establish a count; the browser therefore still delivers
those records. Each record now compares its old and new class lists against
`getDecisionClassNames` (the eight classes the adapter's selectors name) and
is dropped unless one of those classes appeared or disappeared, so YouTube hover
restyles read no card. A core test fails if a selector names an unlisted class.
Within one observer callback, repeated text/attribute records for the same
element are routed once; this saves ancestor lookups but does not change the
count-read column, which was already deduplicated.
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

## Engagement/history release validation (2026-09-28)

The v1.6.1 runtime passed the existing 200-card, 20-batch synthetic workload.
Each expected hiding mark was checked after every batch.

| Site | Workload | Count reads | Card scans |
| --- | --- | ---: | ---: |
| x | unrelated-sidebar-player-noise | 0 | 0 |
| x | one-card-count-changes | 20 | 20 |
| x | hidden-tab-noise | 0 | 0 |
| youtube | unrelated-sidebar-player-noise | 0 | 0 |
| youtube | one-card-count-changes | 20 | 20 |
| youtube | hidden-tab-noise | 0 | 0 |

This is an operation-count regression check, not a speed comparison. History
messages use a no-op mock here, so background storage costs are not measured.
The workload does not represent every mix of X engagement labels. No new
live-browser CPU or RAM claim is made. Run `npm run benchmark` to reproduce.
