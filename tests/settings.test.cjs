'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {normalizeSettings, normalizeAccountIdentifier, parseWhitelistInput, formatSettingsTransfer, parseSettingsTransfer, oversizedSyncKeys} = require('../src/settings.js');

test('thresholds default and validate independently without altering valid zero or high values', () => {
  assert.equal(normalizeSettings().xMinimumViews, 1000);
  assert.equal(normalizeSettings().youtubeMinimumViews, 1000);
  const settings = normalizeSettings({xMinimumViews: 25000, youtubeMinimumViews: 0});
  assert.equal(settings.xMinimumViews, 25000);
  assert.equal(settings.youtubeMinimumViews, 0);
  for (const invalid of [-1, 0.5, NaN, Infinity, '3000', 1000000000001]) {
    assert.equal(normalizeSettings({xMinimumViews: invalid, youtubeMinimumViews: 42}).xMinimumViews, 1000);
    assert.equal(normalizeSettings({xMinimumViews: invalid, youtubeMinimumViews: 42}).youtubeMinimumViews, 42);
    assert.equal(normalizeSettings({xMinimumViews: 42, youtubeMinimumViews: invalid}).youtubeMinimumViews, 1000);
  }
});

test('X whitelist identities normalize handles and genuine profile URLs', () => {
  for (const entry of ['NASA', '@NASA', 'https://x.com/NASA', 'https://www.twitter.com/NASA/?s=21', 'x.com/NASA']) {
    assert.equal(normalizeAccountIdentifier(entry, 'x'), 'nasa');
  }
  assert.equal(normalizeAccountIdentifier('@one_user123', 'x'), 'one_user123');
});

test('YouTube whitelist identities preserve channel ID case and normalize international handles', () => {
  for (const entry of ['@NASA', 'https://www.youtube.com/@NASA', 'youtube.com/@NASA/videos']) {
    assert.equal(normalizeAccountIdentifier(entry, 'youtube'), '@nasa');
  }
  assert.equal(normalizeAccountIdentifier('https://www.youtube.com/@Caf%C3%A9', 'youtube'), '@café');
  assert.equal(normalizeAccountIdentifier('@CAFE\u0301', 'youtube'), '@café');
  assert.equal(normalizeAccountIdentifier('@星空·研究', 'youtube'), '@星空·研究');
  assert.equal(normalizeAccountIdentifier('https://www.youtube.com/channel/UCAbC-1_2', 'youtube'), 'channel/UCAbC-1_2');
  assert.equal(normalizeAccountIdentifier('channel/UCAbC-1_2', 'youtube'), 'channel/UCAbC-1_2');
});

test('whitelists reject unrelated, credentialed, malformed, or non-profile URLs and display names', () => {
  for (const site of ['x', 'youtube']) {
    for (const entry of [null, 42, {}, '', 'Display Name', 'javascript:alert(1)', 'https://example.org/@nasa', 'https://youtube.com.evil.org/@nasa', 'https://evil.org@youtube.com/@nasa', 'https://x.com:444/NASA', 'https://x.com/NASA/status/123', 'https://youtube.com/watch?v=123', 'https://youtube.com/@%ZZ']) {
      assert.equal(normalizeAccountIdentifier(entry, site), null, site + ': ' + entry);
    }
  }
  for (const entry of ['home', '@notifications', 'https://x.com/search?q=test', 'https://youtube.com/@nasa']) {
    assert.equal(normalizeAccountIdentifier(entry, 'x'), null);
  }
  for (const entry of ['NASA', 'https://x.com/NASA', 'https://youtube.com/c/SomeChannel']) {
    assert.equal(normalizeAccountIdentifier(entry, 'youtube'), null);
  }
});

test('whitelist input deduplicates identities and surfaces invalid entries for correction', () => {
  assert.deepEqual(parseWhitelistInput('@NASA, https://x.com/nasa\r\n@SpaceX\nnot a handle', 'x'), {
    identifiers: ['nasa', 'spacex'], invalidEntries: ['not a handle'],
  });
  assert.deepEqual(parseWhitelistInput(' , \n', 'youtube'), {identifiers: [], invalidEntries: []});
});

test('malformed stored whitelists are isolated and callers cannot mutate shared defaults', () => {
  const settings = normalizeSettings({xWhitelist: ['@NASA', 'nasa', null, 'https://x.com/home'], youtubeWhitelist: ['@NASA', 'channel/UCAbC', 'channel/UCabc']});
  assert.deepEqual(settings.xWhitelist, ['nasa']);
  assert.deepEqual(settings.youtubeWhitelist, ['@nasa', 'channel/UCAbC', 'channel/UCabc']);
  assert.deepEqual(normalizeSettings({xWhitelist: '@nasa'}).xWhitelist, []);
  settings.xWhitelist.push('other');
  assert.deepEqual(normalizeSettings().xWhitelist, []);
});

test('transfer text round-trips and rejects anything incomplete or invalid', () => {
  const settings = {xMinimumViews: 10000, youtubeMinimumViews: 0, xWhitelist: ['nasa'], youtubeWhitelist: ['@science', 'channel/UCExample'], xEnabled: false, youtubeEnabled: true, hideUnknown: true};
  const text = formatSettingsTransfer(settings);
  assert.deepEqual(parseSettingsTransfer(text), settings);
  const value = JSON.parse(text);
  assert.deepEqual(parseSettingsTransfer(JSON.stringify({...value, xWhitelist: ['@NASA', 'https://x.com/nasa']})).xWhitelist, ['nasa']);
  for (const invalid of [
    {...value, format: undefined}, {...value, xMinimumViews: 1.5}, {...value, youtubeMinimumViews: '1000'},
    {...value, xWhitelist: 'nasa'}, {...value, youtubeWhitelist: ['Science Channel']}, {...value, xEnabled: 1},
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'hideUnknown')),
  ]) assert.equal(parseSettingsTransfer(JSON.stringify(invalid)), null);
  for (const invalid of ['', '{', 'null', '[]', '"text"']) assert.equal(parseSettingsTransfer(invalid), null);
});

test('sync quota check measures UTF-8 key and JSON value bytes', () => {
  // 8192 bytes = key + JSON array; '[""]' adds 4 bytes around the entry.
  const fits = 'a'.repeat(8192 - 'xWhitelist'.length - 4);
  assert.deepEqual(oversizedSyncKeys({xWhitelist: [fits]}), []);
  assert.deepEqual(oversizedSyncKeys({xWhitelist: [fits + 'a']}), ['xWhitelist']);
  // Two-byte characters count twice.
  assert.deepEqual(oversizedSyncKeys({youtubeWhitelist: ['é'.repeat(4100)]}), ['youtubeWhitelist']);
  assert.deepEqual(oversizedSyncKeys({xMinimumViews: 1000, hideUnknown: false}), []);
});
