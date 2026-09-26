const { test } = require('node:test');
const assert = require('node:assert/strict');
const lyrics = require('../plugin/lyrics.js');

// Shaped like NetEase's /api/song/lyric/v1 reply; the words are made up for the test.
const reply = (lrc, tlyric = '', extra = {}) => Object.assign({ code: 200, lrc: { version: 3, lyric: lrc }, tlyric: { version: 1, lyric: tlyric } }, extra);
const credits = '{"t":0,"c":[{"tx":"作词: "},{"tx":"测试作者","li":"x"}]}\n{"t":1500,"c":[{"tx":"作曲: "},{"tx":"测试作曲"}]}\n';

test('request goes to NetEase itself and only accepts an https domain', () => {
    assert.equal(lyrics.url('123', 'https://music.163.com'), 'https://music.163.com/api/song/lyric/v1?tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0&cp=false&id=123');
    assert.match(lyrics.url('123', 'javascript:alert(1)'), /^https:\/\/music\.163\.com\//);
    assert.match(lyrics.url('1 2'), /id=1%202$/);
});

test('credits written as JSON become ordinary LRC lines and the lyrics are kept as they are', () => {
    const lrc = lyrics.build(reply(credits + '[00:05.20]第一句\r\n[00:09.345]第二句\n\n[00:12.00]\n'));
    assert.equal(lrc, '[00:00.00]作词: 测试作者\n[00:01.50]作曲: 测试作曲\n[00:05.20]第一句\n[00:09.345]第二句\n[00:12.00]\n');
});

test('instrumentals, missing lyrics and credit-only replies give nothing to embed', () => {
    assert.equal(lyrics.build(reply('[00:00.00]纯音乐，请欣赏', '', { pureMusic: true })), '');
    assert.equal(lyrics.build({ code: 200, nolyric: true }), '');
    assert.equal(lyrics.build({ code: 200, uncollected: true }), '');
    assert.equal(lyrics.build(reply(credits)), '');
    assert.equal(lyrics.build(reply('[by:someone]\n')), '');
    assert.equal(lyrics.build(null), '');
    assert.equal(lyrics.build(reply('{broken json\n[00:01.00]还在\n')), '[00:01.00]还在\n');
});

test('translation goes under its line with the same timestamp, only when asked', () => {
    const original = '[00:05.20]First line\n[00:09.345]Second line\n[00:12.00]Third line\n';
    const translation = '[by:译者]\n[00:05.2]第一句\n[00:09.345]第二句\n[00:12.00]//\n';
    assert.equal(lyrics.build(reply(original, translation)), original);
    assert.equal(lyrics.build(reply(original, translation), { translation: true }),
        '[00:05.20]First line\n[00:05.20]第一句\n[00:09.345]Second line\n[00:09.345]第二句\n[00:12.00]Third line\n');
});

test('lyrics without timestamps are still embedded as plain text', () => {
    assert.equal(lyrics.build(reply('第一行\n第二行\n')), '第一行\n第二行\n');
});

test('timestamps are written as minutes, seconds and hundredths', () => {
    assert.equal(lyrics.stamp(0), '[00:00.00]');
    assert.equal(lyrics.stamp(61234), '[01:01.23]');
    assert.equal(lyrics.stamp(3600000), '[60:00.00]');
});
