'use strict';

/**
 * Count values retained by actual runtime WeakMaps for 200 synthetic cards.
 * Usage: node scripts/benchmark-card-state.cjs /path/to/baseline/src
 * This measures retained object/text counts, never browser heap bytes or RAM.
 */
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const CARD_COUNT = 200;
const TITLE_LENGTH = 240;
const SETTLE_ROUNDS = 10;
const SOURCE_FILES = ['settings.js', 'filter-core.js', 'content.js'];
const currentSource = path.resolve(__dirname, '../src');
const baselineSource = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(baselineSource, 'Supply a baseline src directory');

/** Inspect runtime-owned WeakMap values while fixture cards stay connected. */
async function measure(sourceDirectory) {
  const title = 'Synthetic video '.padEnd(TITLE_LENGTH, 'x');
  const markup = Array.from({length: CARD_COUNT}, (_, index) =>
    `<ytd-rich-item-renderer><a class="ytLockupMetadataViewModelTitle" href="/watch?v=${index}">${title}</a><div id="metadata-line"><span>999 views</span></div></ytd-rich-item-renderer>`).join('');
  const dom = new JSDOM(markup, {url: 'https://www.youtube.com/', runScripts: 'outside-only', pretendToBeVisual: true});
  const {window} = dom;
  try {
    if (window.document.readyState !== 'complete') await new Promise((resolve) => window.addEventListener('load', resolve, {once: true}));
    const maps = [];
    const NativeWeakMap = window.WeakMap;
    window.WeakMap = class extends NativeWeakMap {
      constructor(...args) {super(...args); maps.push(this);}
    };
    const messages = [];
    window.browser = {
      storage: {sync: {get: async () => ({statisticsEnabled: true})}, onChanged: {addListener() {}, removeListener() {}}},
      runtime: {sendMessage: async (message) => {messages.push(JSON.parse(JSON.stringify(message))); return {ok: true};},
        onMessage: {addListener() {}, removeListener() {}}},
    };
    for (const file of SOURCE_FILES) window.eval(readFileSync(path.join(sourceDirectory, file), 'utf8'));
    for (let round = 0; round < SETTLE_ROUNDS; round++) await Promise.resolve();
    const cards = [...window.document.querySelectorAll('ytd-rich-item-renderer')];
    assert.equal(cards.filter((card) => card.hasAttribute('data-minimum-views-hidden')).length, CARD_COUNT);
    assert.equal(messages.flatMap((message) => message.items).length, CARD_COUNT);
    const retained = {entries: 0, metadataObjects: 0, titleCharacters: 0, urlCharacters: 0};
    for (const map of maps) for (const card of cards) {
      if (!map.has(card)) continue;
      retained.entries++;
      const value = map.get(card);
      if (value && typeof value === 'object') {
        retained.metadataObjects++;
        retained.titleCharacters += value.title?.length || 0;
        retained.urlCharacters += value.url?.length || 0;
      } else if (typeof value === 'string') retained.urlCharacters += value.length;
    }
    assert.equal(retained.entries, CARD_COUNT);
    return {retained, messages};
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    window.close();
  }
}

(async () => {
  const baseline = await measure(baselineSource);
  const current = await measure(currentSource);
  assert.deepEqual(current.messages, baseline.messages);
  console.log(JSON.stringify({cards: CARD_COUNT, titleLength: TITLE_LENGTH,
    conditions: 'Connected synthetic YouTube cards; runtime WeakMap values only. Identical history messages and hiding marks. No browser heap/RAM measurement.',
    baseline: baseline.retained, current: current.retained}, null, 2));
})().catch((error) => {console.error(error); process.exitCode = 1;});
