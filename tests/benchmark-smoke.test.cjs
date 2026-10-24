'use strict';

// Smoke gate: both benchmarks must still run against current sources, so a
// mock the production liveness guard rejects fails normal verification.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SMOKE_CARDS = '40';
const SMOKE_BATCHES = '4';
const run = (...args) => execFileSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8'});

test('the runtime benchmark filters and passes its assertions on a small feed', () => {
  const report = JSON.parse(run('scripts/benchmark.cjs', '--cards', SMOKE_CARDS, '--batches', SMOKE_BATCHES));
  const startup = report.results.filter(({scenario}) => scenario === 'startup');
  assert.deepEqual(startup.map(({site}) => site), ['x', 'youtube']);
  assert.ok(startup.every(({getViewCount}) => getViewCount >= Number(SMOKE_CARDS)));
});

test('the card-state benchmark hides and records every card', () => {
  const report = JSON.parse(run('scripts/benchmark-card-state.cjs', 'src'));
  assert.equal(report.current.entries, report.cards);
});
