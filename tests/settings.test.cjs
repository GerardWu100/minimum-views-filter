'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {DEFAULTS, X_RATIO_SETTING_KEYS, PERCENT_SETTING_KEYS, normalizeSettings, normalizeAccountIdentifier, parseWhitelistInput, formatSettingsTransfer, parseSettingsTransfer, oversizedSyncKeys} = require('../src/settings.js');

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

test('X ratio settings default independently and accept finite percentages from 0 to 100', () => {
  assert.deepEqual(X_RATIO_SETTING_KEYS, [
    'xLowLikeRatioEnabled', 'xMinimumLikePercent',
    'xHighLikeRatioEnabled', 'xKeepLikePercent',
    'xHighBookmarkRatioEnabled', 'xKeepBookmarkPercent',
    'xBookmarkHighlightEnabled', 'xHighlightBookmarkPercent', 'xBookmarkHighlightShown',
    'xHighlightLikeRequired', 'xHighlightLikePercent',
  ]);
  assert.deepEqual(PERCENT_SETTING_KEYS, ['xMinimumLikePercent', 'xKeepLikePercent', 'xKeepBookmarkPercent', 'xHighlightBookmarkPercent', 'xHighlightLikePercent']);
  assert.deepEqual(X_RATIO_SETTING_KEYS.map((key) => normalizeSettings()[key]), [true, 0.5, true, 2, true, 0.5, true, 1, true, true, 2]);
  const settings = normalizeSettings({
    xLowLikeRatioEnabled: false, xMinimumLikePercent: 0,
    xHighLikeRatioEnabled: false, xKeepLikePercent: 12.345,
    xHighBookmarkRatioEnabled: false, xKeepBookmarkPercent: 100,
    xBookmarkHighlightEnabled: false, xHighlightBookmarkPercent: 1.75, xBookmarkHighlightShown: false,
    xHighlightLikeRequired: false, xHighlightLikePercent: 3.5,
  });
  assert.deepEqual(X_RATIO_SETTING_KEYS.map((key) => settings[key]), [false, 0, false, 12.345, false, 100, false, 1.75, false, false, 3.5]);
  for (const key of PERCENT_SETTING_KEYS) {
    for (const invalid of [-0.01, 100.01, NaN, Infinity, -Infinity, '2', null]) {
      assert.equal(normalizeSettings({[key]: invalid})[key], DEFAULTS[key], `${key}: ${invalid}`);
    }
  }
  for (const key of X_RATIO_SETTING_KEYS.filter((entry) => entry.endsWith('Enabled') || entry.endsWith('Shown') || entry.endsWith('Required'))) {
    assert.equal(normalizeSettings({[key]: 1})[key], true);
  }
});

test('each settings switch accepts booleans and defaults to its intended state', () => {
  const switchDefaults = {
    xEnabled: true, youtubeEnabled: true, xMinimumViewsEnabled: true,
    youtubeMinimumViewsEnabled: true, xWhitelistEnabled: true,
    youtubeWhitelistEnabled: true, hideUnknown: false, statisticsEnabled: true,
    xLowLikeRatioEnabled: true, xHighLikeRatioEnabled: true,
    xHighBookmarkRatioEnabled: true, xBookmarkHighlightEnabled: true, xBookmarkHighlightShown: true, xHighlightLikeRequired: true,
  };
  for (const [key, value] of Object.entries(switchDefaults)) {
    assert.equal(normalizeSettings()[key], value);
    assert.equal(normalizeSettings({[key]: !value})[key], !value);
    assert.equal(normalizeSettings({[key]: 1})[key], value);
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

test('transfer text round-trips, rejects invalid text, and defaults settings absent from earlier releases', () => {
  const settings = {xMinimumViews: 10000, youtubeMinimumViews: 0, xMinimumViewsEnabled: false, youtubeMinimumViewsEnabled: true, xWhitelist: ['nasa'], youtubeWhitelist: ['@science', 'channel/UCExample'], xWhitelistEnabled: false, youtubeWhitelistEnabled: true, xEnabled: false, youtubeEnabled: true, hideUnknown: true, statisticsEnabled: false, xLowLikeRatioEnabled: false, xMinimumLikePercent: 0.75, xHighLikeRatioEnabled: true, xKeepLikePercent: 3.25, xHighBookmarkRatioEnabled: false, xKeepBookmarkPercent: 0, xBookmarkHighlightEnabled: false, xHighlightBookmarkPercent: 1.2, xBookmarkHighlightShown: false, xHighlightLikeRequired: false, xHighlightLikePercent: 4};
  const text = formatSettingsTransfer(settings);
  assert.deepEqual(parseSettingsTransfer(text), settings);
  const value = JSON.parse(text);
  assert.deepEqual(parseSettingsTransfer(JSON.stringify({...value, xWhitelist: ['@NASA', 'https://x.com/nasa']})).xWhitelist, ['nasa']);
  for (const invalid of [
    {...value, format: undefined}, {...value, xMinimumViews: 1.5}, {...value, youtubeMinimumViews: '1000'},
    {...value, xWhitelist: 'nasa'}, {...value, youtubeWhitelist: ['Science Channel']}, {...value, xEnabled: 1},
    {...value, xMinimumLikePercent: -1}, {...value, xKeepLikePercent: Infinity},
    {...value, xKeepBookmarkPercent: '0.5'}, {...value, xHighLikeRatioEnabled: 1},
    {...value, xHighlightBookmarkPercent: -1}, {...value, statisticsEnabled: 'false'},
    {...value, xBookmarkHighlightShown: 'false'}, {...value, xWhitelist: null},
  ]) assert.equal(parseSettingsTransfer(JSON.stringify(invalid)), null);
  // Text from an earlier release lacks newer keys; those take their defaults.
  const earlier = Object.fromEntries(Object.entries(value).filter(([key]) => !['xBookmarkHighlightShown', 'xBookmarkHighlightEnabled', 'statisticsEnabled'].includes(key)));
  assert.deepEqual(parseSettingsTransfer(JSON.stringify(earlier)), {...settings, xBookmarkHighlightShown: true, xBookmarkHighlightEnabled: true, statisticsEnabled: true});
  assert.deepEqual(parseSettingsTransfer(JSON.stringify({format: value.format, xMinimumViews: 5})), {...DEFAULTS, xMinimumViews: 5});
  assert.equal(parseSettingsTransfer(JSON.stringify({format: value.format})), null);
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
