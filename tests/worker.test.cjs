const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');
const { fixture, u32 } = require('./ncm-fixture.cjs');
const worker = path.resolve('plugin/worker.exe');
const audio = ext => fs.readFileSync(path.join(__dirname, 'fixtures/tone.' + ext));
const cover = fs.readFileSync(path.join(__dirname, 'fixtures/cover.png'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup(t) {
    // The worker reports long paths; CI's temp directory is an 8.3 short path (RUNNER~1), so compare in long form.
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-测试 空格-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const input = path.join(root, 'VipSongsDownload'), output = path.join(input, 'unlock'), state = path.join(root, 'state');
    fs.mkdirSync(input);
    const config = { state, jobs: [], enabled: true, session: 'test', heartbeat: Date.now() };
    const control = path.join(root, 'control.json');
    const save = () => fs.writeFileSync(control, JSON.stringify(config)); save();
    const run = () => spawnSync(worker, ['--once', control], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    const job = (name, bytes) => {
        const source = path.join(input, name), target = path.join(output, name);
        fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, bytes);
        config.jobs.push({ id: 'job-' + (config.jobs.length + 1), source, target }); save();
        return { source, target };
    };
    const copy = () => { for (const name of ['worker.exe', 'TagLibSharp.dll']) fs.copyFileSync(path.resolve('plugin', name), path.join(root, name)); return path.join(root, 'worker.exe'); };
    const status = () => JSON.parse(fs.readFileSync(path.join(root, 'status.json')));
    return { root, input, output, state, config, control, save, run, job, copy, status };
}
// MP4 audio samples in order, read through stco/co64, stsc and stsz, so chunks moved by a bigger moov are checked too.
function samples(bytes) {
    const box = (start, end, type) => { for (let p = start; p + 8 <= end;) { const size = bytes.readUInt32BE(p); if (bytes.toString('latin1', p + 4, p + 8) === type) return [p + 8, p + size]; p += size; } assert.fail('no ' + type); };
    let [s, e] = box(0, bytes.length, 'moov');
    for (const type of ['trak', 'mdia', 'minf', 'stbl']) [s, e] = box(s, e, type);
    const [sz] = box(s, e, 'stsz'), fixed = bytes.readUInt32BE(sz + 4), count = bytes.readUInt32BE(sz + 8);
    const sizes = Array.from({ length: count }, (_, i) => fixed || bytes.readUInt32BE(sz + 12 + 4 * i));
    const [co] = box(s, e, 'stco'), chunks = Array.from({ length: bytes.readUInt32BE(co + 4) }, (_, i) => bytes.readUInt32BE(co + 8 + 4 * i));
    const [sc] = box(s, e, 'stsc'), runs = Array.from({ length: bytes.readUInt32BE(sc + 4) }, (_, i) => [bytes.readUInt32BE(sc + 8 + 12 * i), bytes.readUInt32BE(sc + 12 + 12 * i)]);
    const out = []; let sample = 0;
    chunks.forEach((offset, i) => {
        const perChunk = runs.filter(([first]) => first <= i + 1).pop()[1];
        for (let n = 0, p = offset; n < perChunk && sample < count; n++) { out.push(bytes.subarray(p, p + sizes[sample])); p += sizes[sample++]; }
    });
    assert.equal(sample, count);
    return Buffer.concat(out);
}
// Compare encoded audio frames independently of TagLib; tags may move/change size.
function frames(bytes, ext) {
    if (ext === 'm4a') return samples(bytes);
    if (ext === 'flac') {
        assert.equal(bytes.subarray(0, 4).toString(), 'fLaC');
        let p = 4, last = false;
        while (!last) { last = !!(bytes[p] & 128); p += 4 + bytes.readUIntBE(p + 1, 3); }
        return bytes.subarray(p);
    }
    let start = 0, end = bytes.length;
    if (bytes.subarray(0, 3).toString() === 'ID3') start = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
    if (bytes.subarray(end - 128, end - 125).toString() === 'TAG') end -= 128;
    return bytes.subarray(start, end);
}
for (const ext of ['flac', 'mp3', 'm4a']) test(ext + ': native job preserves audio frames, embeds cover/title/album/artist, no sidecars, receipt reuse', t => {
    const s = setup(t), original = audio(ext), encoded = fixture(original);
    const job = s.job('歌手/歌曲.ncm', encoded);
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    const output = job.target.replace(/\.ncm$/, '.' + ext), converted = fs.readFileSync(output);
    assert.deepEqual(frames(converted, ext), frames(original, ext));
    assert.ok(converted.includes(cover));
    for (const title of ['合成测试', '测试专辑', '测试歌手']) assert.ok(converted.includes(Buffer.from(title, 'utf8')) || converted.includes(Buffer.from(title, 'utf16le')), title);
    assert.deepEqual(fs.readFileSync(job.source), encoded);
    assert.deepEqual(fs.readdirSync(path.dirname(output)), ['歌曲.' + ext]);
    assert.equal(s.status().activity.state, 'success');
    assert.equal(s.status().activity.percent, 100);
    assert.deepEqual(Object.keys(s.status().results), ['job-1']);
    assert.equal(s.status().results['job-1'].output, output);
    // The card gets the format and a copy of the embedded cover beside control.json.
    assert.equal(s.status().activity.format, ext.toUpperCase());
    assert.equal(path.dirname(s.status().activity.cover), path.join(s.root, 'covers'));
    assert.deepEqual(fs.readFileSync(s.status().activity.cover), cover);
    assert.equal(s.run().status, 0); assert.equal(fs.readdirSync(path.dirname(output)).length, 1);
    fs.unlinkSync(output); assert.equal(s.run().status, 0); assert.ok(fs.existsSync(output));
});
test('no metadata/cover, filename conflicts and changed source preserve existing files', t => {
    const s = setup(t), job = s.job('歌曲.ncm', fixture(audio('mp3'), { metadata: false, cover: Buffer.alloc(0) }));
    fs.mkdirSync(s.output); const existing = path.join(s.output, '歌曲.mp3'), own = path.join(s.output, '歌曲 (2).mp3'); fs.writeFileSync(existing, 'keep');
    assert.equal(s.run().status, 0); assert.equal(fs.readFileSync(existing, 'utf8'), 'keep');
    assert.deepEqual(frames(fs.readFileSync(own), 'mp3'), frames(audio('mp3'), 'mp3'));
    // Downloading the same song again refreshes the file this plugin wrote instead of adding "(3)".
    fs.writeFileSync(job.source, fixture(audio('mp3')));
    assert.equal(s.run().status, 0); assert.ok(!fs.existsSync(path.join(s.output, '歌曲 (3).mp3')));
    assert.ok(fs.readFileSync(own).includes(Buffer.from('合成测试', 'utf16le')) || fs.readFileSync(own).includes(Buffer.from('合成测试')));
    assert.equal(fs.readFileSync(existing, 'utf8'), 'keep');
    // Once the user has changed that file, it is never replaced.
    fs.appendFileSync(own, 'edited');
    fs.writeFileSync(job.source, fixture(audio('mp3'), { metadata: false }));
    assert.equal(s.run().status, 0); assert.ok(fs.existsSync(path.join(s.output, '歌曲 (3).mp3')));
    assert.ok(fs.readFileSync(own).subarray(-6).equals(Buffer.from('edited')));
});
test('unreadable cover or tags never cost the audio', t => {
    const s = setup(t);
    s.job('gif.ncm', fixture(audio('flac'), { cover: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]) }));
    const broken = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(64, 0xff)]);
    s.job('broken.ncm', fixture(broken));
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    const gif = fs.readFileSync(path.join(s.output, 'gif.flac'));
    assert.deepEqual(frames(gif, 'flac'), frames(audio('flac'), 'flac'));
    assert.ok(!gif.includes(Buffer.from('GIF89a')));
    assert.match(s.status().results['job-1'].warning, /封面格式无法识别/);
    // TagLib cannot parse this stream; the untouched audio is written again without tags.
    assert.deepEqual(fs.readFileSync(path.join(s.output, 'broken.flac')), broken);
    assert.equal(s.status().results['job-2'].warning, '封面与歌曲信息未写入');
    assert.equal(s.status().failed, 0);
    assert.deepEqual(fs.readdirSync(s.output).sort(), ['broken.flac', 'gif.flac']);
});
// Made-up lyrics in the shape the plugin hands over: LRC with credits turned into ordinary lines.
const LRC = '[00:00.00]作词: 测试作者\n[00:01.00]第一句歌词\n[00:02.50]Second line\n';
const lyricsIn = (bytes, ext) => ext === 'flac' ? bytes.includes(Buffer.from('LYRICS=' + LRC, 'utf8'))
    : ext === 'm4a' ? bytes.includes(Buffer.from('\xa9lyr', 'latin1')) && bytes.includes(Buffer.from(LRC, 'utf8'))
    : bytes.includes(Buffer.from('USLT')) && (bytes.includes(Buffer.from(LRC, 'utf16le')) || bytes.includes(Buffer.from(LRC, 'utf8')));
for (const ext of ['flac', 'mp3', 'm4a']) test(ext + ': lyrics are asked for by song ID, then embedded beside the other tags with an .lrc next to the song', t => {
    const s = setup(t); s.config.lyrics = { enabled: true, file: true }; s.save();
    const job = s.job('歌手/歌曲.ncm', fixture(audio(ext)));
    // First pass: nothing is written yet; the request carries the ID from the NCM's metadata.
    assert.equal(s.run().status, 0);
    assert.deepEqual(s.status().lyrics, { id: 'job-1', musicId: '1234567' });
    assert.deepEqual(s.status().results, {});
    assert.ok(!fs.existsSync(s.output));
    s.config.jobs[0].lyrics = LRC; s.save();
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    const output = job.target.replace(/\.ncm$/, '.' + ext), converted = fs.readFileSync(output);
    assert.deepEqual(frames(converted, ext), frames(audio(ext), ext));
    assert.ok(lyricsIn(converted, ext), 'lyrics embedded where players read them');
    assert.ok(converted.includes(cover));
    // UTF-8 with a BOM and CRLF, which older players read correctly.
    assert.deepEqual(fs.readFileSync(output.replace(/\.\w+$/, '.lrc')), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(LRC.replace(/\n/g, '\r\n'))]));
    assert.equal(s.status().lyrics, null);
    assert.equal(s.status().activity.lyrics, true);
    assert.equal(s.status().results['job-1'].message, '音频、歌曲信息与歌词已保存');
});
// 臻音全景声 arrives as MP4 with an Audio Vivid ("av3a") sample entry; the AAC fixture is relabelled to stand in for it.
const vivid = () => { const m4a = Buffer.from(audio('m4a')), at = m4a.indexOf('stsd') + 16; assert.equal(m4a.toString('latin1', at, at + 4), 'mp4a'); m4a.write('av3a', at, 'latin1'); return m4a; };
test('Audio Vivid is kept as .m4a with tags and a note that most players cannot play it; plain AAC gets no note', t => {
    const s = setup(t), song = s.job('臻音.ncm', fixture(vivid())), aac = s.job('aac.ncm', fixture(audio('m4a')));
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    const output = song.target.replace(/\.ncm$/, '.m4a'), converted = fs.readFileSync(output);
    assert.deepEqual(frames(converted, 'm4a'), frames(vivid(), 'm4a'));
    assert.ok(converted.includes('av3a') && converted.includes(cover) && converted.includes(Buffer.from('合成测试')));
    assert.equal(s.status().results['job-1'].state, 'success');
    assert.equal(s.status().results['job-1'].warning, '多数播放器不支持臻音全景声');
    assert.equal(s.status().results['job-2'].warning, '');
    assert.deepEqual(frames(fs.readFileSync(aac.target.replace(/\.ncm$/, '.m4a')), 'm4a'), frames(audio('m4a'), 'm4a'));
    assert.deepEqual(fs.readdirSync(s.output).sort(), ['aac.m4a', '臻音.m4a']);
});
test('lyrics that do not arrive in time, or a song without an ID, never hold up the audio', t => {
    const s = setup(t); s.config.lyrics = { enabled: true, file: true, wait: 0 }; s.save();
    const late = s.job('late.ncm', fixture(audio('flac'))), anonymous = s.job('anonymous.ncm', fixture(audio('mp3'), { metadata: false }));
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    assert.ok(!fs.readFileSync(late.target.replace(/\.ncm$/, '.flac')).includes(Buffer.from('LYRICS=')));
    assert.ok(fs.existsSync(anonymous.target.replace(/\.ncm$/, '.mp3')));
    assert.deepEqual(fs.readdirSync(s.output).sort(), ['anonymous.mp3', 'late.flac']);
    assert.equal(s.status().results['job-1'].message, '音频与歌曲信息已保存');
    assert.equal(s.status().activity.lyrics, false);
});
test('a failed lyric request is noted, an existing .lrc is kept, and lyrics stay out when turned off', t => {
    const s = setup(t); s.config.lyrics = { enabled: true, file: true }; s.save();
    s.job('failed.ncm', fixture(audio('flac'))); Object.assign(s.config.jobs[0], { lyrics: '', lyricsNote: '歌词获取失败' });
    const kept = s.job('kept.ncm', fixture(audio('mp3'))); s.config.jobs[1].lyrics = LRC; s.save();
    fs.mkdirSync(s.output); const own = kept.target.replace(/\.ncm$/, '.lrc'); fs.writeFileSync(own, '我自己的歌词');
    assert.equal(s.run().status, 0, JSON.stringify(s.status()));
    assert.equal(s.status().results['job-1'].warning, '歌词获取失败');
    assert.equal(s.status().results['job-1'].message, '音频已保存；歌词获取失败');
    assert.ok(lyricsIn(fs.readFileSync(kept.target.replace(/\.ncm$/, '.mp3')), 'mp3'));
    assert.equal(fs.readFileSync(own, 'utf8'), '我自己的歌词');
    assert.deepEqual(fs.readdirSync(s.output).sort(), ['failed.flac', 'kept.lrc', 'kept.mp3']);
    const off = setup(t); off.config.lyrics = { enabled: false, file: true }; off.save();
    const plain = off.job('plain.ncm', fixture(audio('flac'))); off.config.jobs[0].lyrics = LRC; off.save();
    assert.equal(off.run().status, 0);
    assert.ok(!fs.readFileSync(plain.target.replace(/\.ncm$/, '.flac')).includes(Buffer.from('LYRICS=')));
    assert.deepEqual(fs.readdirSync(off.output), ['plain.flac']);
    assert.equal(off.status().lyrics, null);
});
test('a running worker waits for the plugin to hand over lyrics, and converts without them once the wait is over', { timeout: 15000 }, async t => {
    const s = setup(t); s.config.lyrics = { enabled: true, file: false, wait: 1500 }; s.save();
    const child = spawn(s.copy(), [], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    const beat = setInterval(() => { s.config.heartbeat = Date.now(); s.save(); }, 1000);
    t.after(async () => { clearInterval(beat); if (child.exitCode === null) { child.kill(); await exited; } });
    const read = () => { try { return s.status(); } catch (_) { return null; } };
    const until = async (check, ms) => { for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(30)) if (check()) return true; return false; };
    const answered = s.job('answered.ncm', fixture(audio('flac'))), first = answered.target.replace(/\.ncm$/, '.flac');
    assert.ok(await until(() => read() && read().lyrics && read().lyrics.id === 'job-1', 4000), 'the worker asks for lyrics');
    assert.equal(read().activity.message, '正在获取歌词');
    assert.ok(!fs.existsSync(first));
    s.config.jobs[0].lyrics = LRC; s.save();
    assert.ok(await until(() => fs.existsSync(first) && read() && read().results['job-1'], 3000));
    assert.ok(lyricsIn(fs.readFileSync(first), 'flac'));
    // Nobody answers for the second song.
    const started = Date.now(), ignored = s.job('ignored.ncm', fixture(audio('flac'))), second = ignored.target.replace(/\.ncm$/, '.flac');
    assert.ok(await until(() => fs.existsSync(second) && read() && read().results['job-2'], 6000));
    assert.ok(Date.now() - started >= 1300, 'it waited for the lyrics first');
    assert.ok(!fs.readFileSync(second).includes(Buffer.from('LYRICS=')));
    assert.equal(read().lyrics, null);
    s.config.enabled = false; s.save();
    assert.equal(await Promise.race([exited, sleep(3000).then(() => 'timeout')]), 0);
});
test('user-requested search lists unconverted NCM downloads only', t => {
    const s = setup(t);
    for (const name of ['new.ncm', '歌手/second.ncm', 'done.ncm', 'vivid.ncm', 'unlock/x/inside.ncm']) {
        fs.mkdirSync(path.dirname(path.join(s.input, name)), { recursive: true });
        fs.writeFileSync(path.join(s.input, name), fixture(audio('flac')));
    }
    fs.writeFileSync(path.join(s.input, 'plain.mp3'), audio('mp3'));
    fs.writeFileSync(path.join(s.output, 'done.flac'), 'converted earlier');
    fs.writeFileSync(path.join(s.output, 'vivid.m4a'), 'converted earlier');
    s.config.scan = { id: 'scan-1', root: s.input }; s.save();
    assert.equal(s.run().status, 0);
    const scan = s.status().scan;
    assert.equal(scan.id, 'scan-1'); assert.equal(scan.error, '');
    assert.deepEqual(scan.files, [path.join(s.input, 'new.ncm'), path.join(s.input, '歌手', 'second.ncm')]);
    assert.equal(scan.skipped, 2);
    // Searching converts nothing by itself; the plugin queues the reported files.
    assert.ok(!fs.existsSync(path.join(s.output, 'new.flac')));
    s.config.scan = { id: 'scan-2', root: s.root }; s.save();
    s.run(); assert.match(s.status().scan.error, /VipSongsDownload/);
});
test('malformed/truncated containers, oversized key and unknown audio fail without leftovers', t => {
    const s = setup(t);
    s.job('bad.ncm', Buffer.from('wrong file'));
    s.job('truncated.ncm', fixture(audio('flac')).subarray(0, 38));
    s.job('oversized.ncm', Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(2), u32(0xffffffff)]));
    s.job('unknown.ncm', fixture(Buffer.from('OggS123')));
    assert.equal(s.run().status, 1);
    assert.equal(s.status().failed, 4);
    assert.equal(s.status().results['job-4'].message, '无法识别的音频格式');
    assert.ok(!fs.existsSync(s.output) || fs.readdirSync(s.output).length === 0);
});
test('only queued files are processed; pre-existing directory contents are never scanned', t => {
    const s = setup(t); fs.writeFileSync(path.join(s.input, 'unrequested.ncm'), fixture(audio('flac')));
    assert.equal(s.run().status, 0); assert.ok(!fs.existsSync(s.output));
});
test('output outside VipSongsDownload/unlock is rejected', t => {
    const s = setup(t); s.job('song.ncm', fixture(audio('flac')));
    s.config.jobs[0].target = path.join(s.root, 'outside.ncm'); s.save();
    assert.equal(s.run().status, 1); assert.ok(!fs.existsSync(path.join(s.root, 'outside.flac')));
});
test('Windows source lock, cancellation cleanup and changed-source protection', t => {
    const s = setup(t), job = s.job('locked.ncm', fixture(audio('flac'))); fs.mkdirSync(s.output); s.copy();
    const harness = path.join(s.root, 'checks.exe');
    const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const build = spawnSync(compiler, ['/nologo', '/target:exe', '/out:' + harness, '/reference:' + worker, path.resolve('tests/WorkerUnit.cs')], { encoding: 'utf8', windowsHide: true });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const run = spawnSync(harness, [job.source, job.target], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr);
});
test('expired heartbeat prevents a queued background conversion', t => {
    const s = setup(t); s.job('song.ncm', fixture(audio('flac'))); s.config.heartbeat = Date.now() - 60000; s.save();
    const run = spawnSync(s.copy(), [], { timeout: 5000, windowsHide: true });
    assert.equal(run.status, 0); assert.ok(!fs.existsSync(s.output));
});
test('warm worker processes an event promptly and exits when disabled', { timeout: 12000 }, async t => {
    const s = setup(t), child = spawn(s.copy(), [], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    t.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
    const readyDeadline = Date.now() + 4000;
    while (!fs.existsSync(path.join(s.root, 'status.json')) && Date.now() < readyDeadline) await sleep(30);
    assert.equal(s.status().state, 'ready');
    const start = Date.now(); s.job('new.ncm', fixture(audio('flac')));
    const output = path.join(s.output, 'new.flac');
    while (!fs.existsSync(output) && Date.now() - start < 3500) await sleep(30);
    assert.ok(fs.existsSync(output), 'should not wait for directory scanning or a fixed stability delay');
    assert.deepEqual(frames(fs.readFileSync(output), 'flac'), frames(audio('flac'), 'flac'));
    s.config.enabled = false; s.save();
    assert.equal(await Promise.race([exited, sleep(3000).then(() => 'timeout')]), 0);
});
test('a reader holding status.json neither stops the worker nor fails a finished song', { timeout: 20000 }, async t => {
    const s = setup(t), child = spawn(s.copy(), [], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    const beat = setInterval(() => { s.config.heartbeat = Date.now(); s.save(); }, 1000);
    t.after(async () => { clearInterval(beat); if (child.exitCode === null) { child.kill(); await exited; } });
    const statusPath = path.join(s.root, 'status.json'), read = () => { try { return s.status(); } catch (_) { return null; } };
    s.job('song.ncm', fixture(audio('flac')));
    for (const deadline = Date.now() + 6000; Date.now() < deadline && !(read() && read().activity && read().activity.state === 'success');) await sleep(50);
    assert.equal(read().activity.state, 'success');
    // BetterNCM opens files without FILE_SHARE_DELETE, so File.Replace fails while the plugin reads status.json.
    const hold = spawn('powershell', ['-NoProfile', '-Command', "$f = [IO.File]::Open($env:NBD_HOLD, 'Open', 'Read', 'ReadWrite'); 'held'; Start-Sleep -Milliseconds 3000; $f.Close()"], { windowsHide: true, env: { ...process.env, NBD_HOLD: statusPath } });
    await new Promise(resolve => hold.stdout.once('data', resolve));
    await new Promise(resolve => hold.once('exit', resolve));
    const released = Date.now();
    while (Date.now() - released < 3000 && !(read() && read().heartbeat >= released)) await sleep(50);
    assert.equal(child.exitCode, null, 'worker must survive a blocked status write');
    const status = read();
    assert.ok(status.heartbeat >= released, 'status writes resume once the reader lets go');
    assert.equal(status.failed, 0); assert.equal(status.activity.state, 'success');
    assert.deepEqual(fs.readdirSync(s.root).filter(name => name.endsWith('.tmp')), []);
    s.config.enabled = false; s.save();
    assert.equal(await Promise.race([exited, sleep(3000).then(() => 'timeout')]), 0);
});
test('an idle worker exits on its own', { timeout: 15000 }, async t => {
    const s = setup(t); s.config.idle = 1500; s.save();
    const start = Date.now(), child = spawn(s.copy(), [], { windowsHide: true, stdio: 'ignore' });
    const exited = new Promise(resolve => child.once('exit', resolve));
    t.after(async () => { if (child.exitCode === null) { child.kill(); await exited; } });
    assert.equal(await Promise.race([exited, sleep(8000).then(() => 'timeout')]), 0);
    assert.ok(Date.now() - start >= 1400);
    assert.equal(s.status().state, 'stopped'); assert.match(s.status().message, /空闲/);
});
