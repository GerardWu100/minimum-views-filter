'use strict';

/**
 * Compare X decision behavior and synchronous call time with a source baseline.
 *
 * Reproduce this audit with:
 *   git show 5608ce4:src/filter-core.js > /tmp/minimum-views-filter-core-baseline.js
 *   node scripts/benchmark-decisions.cjs --baseline /tmp/minimum-views-filter-core-baseline.js --baseline-revision 5608ce4
 *
 * This measures only JavaScript decision calls in Node.js. It does not measure
 * browser scanning, paint timing, memory, or the platform's own work.
 */
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const {normalizeSettings} = require('../src/settings.js');

const DEFAULT_ITERATIONS = 400_000;
const TRIAL_COUNT = 6;
const KEEP_RULE_NAMES = ['xHighLikeRatioEnabled', 'xHighBookmarkRatioEnabled', 'xHighReplyRatioEnabled'];
const METRIC_COUNTS = [null, 0, 1, 3, 10, 20, 100];
const VIEW_COUNTS = [null, 0, 500, 1000, 5000];
const TIMED_CASES = [
  [500, {likes: 10, bookmarks: 3, replies: 1}],
  [500, {likes: 10, bookmarks: 3, replies: null}],
  [500, {likes: 0, bookmarks: 3, replies: 1}],
  [10000, {likes: 300, bookmarks: 70, replies: 20}],
];

function parseArguments() {
  if (process.argv.length !== 6 || process.argv[2] !== '--baseline' || process.argv[4] !== '--baseline-revision') {
    throw new Error('Usage: node scripts/benchmark-decisions.cjs --baseline /path/to/filter-core.js --baseline-revision REV');
  }
  return {baselineFile: path.resolve(process.argv[3]), baselineRevision: process.argv[5]};
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Exhaustively compare available-rule combinations and unknown metric states. */
function assertEquivalent(baseline, current) {
  let decisions = 0;
  let highlights = 0;
  for (let enabledBits = 0; enabledBits < 2 ** KEEP_RULE_NAMES.length; enabledBits++) {
    for (const lowLikeEnabled of [false, true]) {
      for (const viewFloorEnabled of [false, true]) {
        for (const hideUnknown of [false, true]) {
          const keepSwitches = Object.fromEntries(KEEP_RULE_NAMES.map((name, index) => [name, !!(enabledBits & (1 << index))]));
          const settings = normalizeSettings({...keepSwitches, xLowLikeRatioEnabled: lowLikeEnabled,
            xMinimumViewsEnabled: viewFloorEnabled, hideUnknown});
          for (const views of VIEW_COUNTS) {
            for (const likes of METRIC_COUNTS) {
              for (const bookmarks of METRIC_COUNTS) {
                for (const replies of METRIC_COUNTS) {
                  const engagement = {likes, bookmarks, replies};
                  assert.deepEqual(
                    current.getFilterDecision(views, 'x', settings, engagement),
                    baseline.getFilterDecision(views, 'x', settings, engagement),
                  );
                  decisions++;
                }
              }
            }
          }
        }
      }
    }
  }
  for (const highlightEnabled of [false, true]) {
    for (const likeRequired of [false, true]) {
      for (const replyRequired of [false, true]) {
        const settings = normalizeSettings({xBookmarkHighlightEnabled: highlightEnabled,
          xHighlightLikeRequired: likeRequired, xHighlightReplyRequired: replyRequired});
        for (const views of VIEW_COUNTS) {
          for (const likes of METRIC_COUNTS) {
            for (const bookmarks of METRIC_COUNTS) {
              for (const replies of METRIC_COUNTS) {
                const engagement = {likes, bookmarks, replies};
                assert.equal(
                  current.shouldHighlightX(views, engagement, settings),
                  baseline.shouldHighlightX(views, engagement, settings),
                );
                highlights++;
              }
            }
          }
        }
      }
    }
  }
  return {decisions, highlights};
}

/** Time a balanced mix of eligible, ineligible, and unknown reply counts. */
function timeDecisions(core, settings, iterations) {
  let keptCount = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    const [views, engagement] = TIMED_CASES[index % TIMED_CASES.length];
    if (core.getFilterDecision(views, 'x', settings, engagement).keptBy) keptCount++;
  }
  return {milliseconds: Number((performance.now() - start).toFixed(3)), keptCount};
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return (sorted[2] + sorted[3]) / 2;
}

function main() {
  const {baselineFile, baselineRevision} = parseArguments();
  const currentFile = path.resolve(__dirname, '../src/filter-core.js');
  const baseline = require(baselineFile);
  const current = require(currentFile);
  const checks = assertEquivalent(baseline, current);
  const settings = normalizeSettings();
  // Warm both implementations before alternating their timing order.
  timeDecisions(baseline, settings, DEFAULT_ITERATIONS);
  timeDecisions(current, settings, DEFAULT_ITERATIONS);
  const trials = [];
  for (let trial = 0; trial < TRIAL_COUNT; trial++) {
    const order = trial % 2 ? [['current', current], ['baseline', baseline]] : [['baseline', baseline], ['current', current]];
    for (const [version, core] of order) trials.push({trial, version, ...timeDecisions(core, settings, DEFAULT_ITERATIONS)});
  }
  assert.equal(new Set(trials.map((trial) => trial.keptCount)).size, 1);
  const baselineMedianMs = median(trials.filter((trial) => trial.version === 'baseline').map((trial) => trial.milliseconds));
  const currentMedianMs = median(trials.filter((trial) => trial.version === 'current').map((trial) => trial.milliseconds));
  process.stdout.write(JSON.stringify({
    environment: {node: process.version},
    sources: {baselineRevision, baselineSha256: sha256(baselineFile), currentSha256: sha256(currentFile)},
    fixture: {iterationsPerTrial: DEFAULT_ITERATIONS, trialCount: TRIAL_COUNT, timedCases: TIMED_CASES},
    semanticChecks: checks,
    timingScope: 'Synchronous Node.js getFilterDecision calls only; excludes DOM, browser CPU, memory, rendering, and history storage.',
    trials,
    medianMilliseconds: {baseline: Number(baselineMedianMs.toFixed(3)), current: Number(currentMedianMs.toFixed(3))},
  }, null, 2) + '\n');
}

main();
