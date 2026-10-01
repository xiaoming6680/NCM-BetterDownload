// Requires Playwright. NBD_BROWSER_CHANNEL=msedge uses an installed Edge.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const version = require('../plugin/manifest.json').version;
const DARK = 'radial-gradient(ellipse at 100% 65%, #548198, transparent 43%), radial-gradient(ellipse at 65% 100%, #524b72, transparent 48%), #181c26';
(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.NBD_BROWSER_CHANNEL ? { channel: process.env.NBD_BROWSER_CHANNEL } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 1080, height: 800 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.route('http://nbd.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;min-height:100vh"></body></html>' }));
        await page.goto('http://nbd.test/');
        const backdrop = (background, color) => page.evaluate(([background, color]) => { document.body.style.background = background; document.body.style.color = color; }, [background, color]);
        await backdrop(DARK, '#e6e6e4');
        await page.evaluate(async version => {
            const root = 'C:/BetterNCM/ncm-better-download', covers = 'C:\\BetterNCM\\ncm-better-download\\runtime-' + version + '\\covers\\';
            // Synthetic album covers: a warm sunset and a cool sea, to show the tint follows the art.
            const paint = (stops, glow) => new Promise(resolve => {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
                const g = canvas.getContext('2d'), fill = g.createLinearGradient(0, 0, 300, 300);
                stops.forEach((color, i) => fill.addColorStop(i / (stops.length - 1), color));
                g.fillStyle = fill; g.fillRect(0, 0, 300, 300);
                g.fillStyle = glow; g.beginPath(); g.arc(196, 108, 50, 0, Math.PI * 2); g.fill();
                g.fillStyle = 'rgba(20,8,40,.45)'; g.fillRect(0, 214, 300, 86);
                canvas.toBlob(resolve, 'image/png');
            });
            window.mock = { files: { 'C:/BetterNCM/plugins_runtime/ncm-better-download/release.json': JSON.stringify({ repository: 'https://github.com/xiaoming6680/NCM-BetterDownload', issues: 'https://github.com/xiaoming6680/NCM-BetterDownload/issues' }) },
                calls: [], saved: null, config: {}, listener: null, removed: [], alive: true,
                covers: { [covers + '1.png']: await paint(['#ff8a5c', '#e2466f', '#5b2a86'], 'rgba(255,226,170,.92)'), [covers + '2.png']: await paint(['#34d1c4', '#2f6fd8', '#1b2a6b'], 'rgba(220,245,255,.85)') } };
            window.sdk = { Storage: { downloadDir: 'D:\\CloudMusic' }, Bridge: {
                appendRegisterCall: (name, ns, cb) => { if (name !== 'addid3done' || ns !== 'storage') throw Error('wrong hook'); mock.listener = cb; },
                removeRegisterCall: (name, ns, cb) => { if (mock.listener === cb) mock.listener = null; }
            } };
            const loader = Object.assign(() => {}, { c: { sdk: { exports: sdk } }, m: {} });
            window.webpackJsonp = []; webpackJsonp.push = chunk => Object.values(chunk[1])[0]({}, {}, loader);
            window.plugin = { pluginPath: 'C:/BetterNCM/plugins_runtime/ncm-better-download', manifest: { version }, getConfig: (k, v) => k in mock.config ? mock.config[k] : v, setConfig: (k, v) => { mock.config[k] = v; if (k === 'enabled') mock.saved = v; }, onConfig: cb => { window.configCallback = cb; }, onLoad: cb => { window.loadCallback = cb; } };
            window.betterncm = {
                fs: { exists: async p => p.endsWith('worker.exe') || p.endsWith('TagLibSharp.dll') || p.startsWith('D:\\') || p in mock.files,
                    mkdir: async () => true, readFileText: async p => mock.files[p] || '',
                    writeFile: async (p, content) => { mock.files[p] = typeof content === 'string' ? content : await content.text(); return true; },
                    readFile: async p => { if (!mock.covers[p]) throw Error('missing ' + p); return mock.covers[p]; },
                    readDir: async () => [root + '/runtime-0.4.1', root + '/runtime-' + version, root + '/receipts.json', root + '/receipts-v3.json'],
                    remove: async p => { mock.removed.push(p); return true; } },
                app: { getDataPath: async () => 'C:/BetterNCM', exec: async (...args) => { mock.calls.push(args); return true; } },
                ncm: { openUrl: url => mock.calls.push(url) }
            };
            window.betterncm_native = { fs: { writeFileText: (p, s) => { mock.files[p] = s; } } };
            const file = name => (Object.keys(mock.files).find(p => p.endsWith('control.json')) || '').replace('control.json', name);
            window.control = () => JSON.parse(mock.files[file('control.json')]);
            // Plays the worker: status.json for this session, kept fresh while mock.alive.
            window.publish = (activity, extra = {}) => { mock.files[file('status.json')] = JSON.stringify(Object.assign({ session: control().session, heartbeat: Date.now(), state: 'converting', message: '正在转换', results: {}, activity }, extra)); };
            setInterval(() => { const f = file('status.json'); if (mock.alive && mock.files[f]) { const s = JSON.parse(mock.files[f]); s.heartbeat = Date.now(); mock.files[f] = JSON.stringify(s); } }, 1000);
        }, version);
        for (const file of ['download-hook.js', 'progress-card.js', 'lyrics.js', 'main.js']) await page.addScriptTag({ path: path.resolve('plugin', file) });
        // Opening the settings page plays the entrance: every block rises in, the logo pops.
        const entrance = await page.evaluate(() => { document.body.appendChild(configCallback()); loadCallback(); return Array.from(document.querySelectorAll('.nbd-settings .nbd-in, .nbd-settings .nbd-logo')).map(node => node.getAnimations().length); });
        assert.equal(entrance.length, 11);
        assert.ok(entrance.every(count => count > 0), JSON.stringify(entrance));
        await page.waitForFunction(() => !!mock.listener);
        const settings = page.locator('.nbd-settings'), card = page.locator('#nbd-progress-card');
        const text = selector => card.locator(selector).textContent();
        const shadowText = (selector, value) => page.waitForFunction(([selector, value]) => document.querySelector('#nbd-progress-card').shadowRoot.querySelector(selector).textContent === value, [selector, value]);
        const hidden = () => page.waitForFunction(() => document.querySelector('#nbd-progress-card').style.display === 'none', null, { timeout: 9000 });
        assert.equal(await settings.locator('input').count(), 0);
        assert.equal(await settings.getByRole('switch').count(), 4);
        assert.deepEqual(await settings.getByRole('radio').allTextContents(), ['每首歌', '仅出错', '不显示', '标准', '简洁', '2 秒', '4 秒', '6 秒']);
        assert.deepEqual(await settings.getByRole('radio', { checked: true }).allTextContents(), ['每首歌', '标准', '4 秒']);
        assert.equal(await settings.locator('button').count(), 14);
        assert.equal(await settings.locator('.nbd-version').textContent(), 'v' + version);
        // NetEase 2.10.x core.css stretches every svg to its box; the icons keep their own size.
        const iconSizes = () => page.evaluate(() => Array.from(document.querySelectorAll('.nbd-settings svg')).map(svg => { const s = getComputedStyle(svg); return Math.round(parseFloat(s.width)) + 'x' + Math.round(parseFloat(s.height)); }));
        const expectedIcons = ['28x28', ...Array(5).fill('14x14'), ...Array(3).fill('16x16')];
        assert.deepEqual(await iconSizes(), expectedIcons);
        await page.evaluate(() => { const style = document.createElement('style'); style.id = 'ncm210-core'; style.textContent = 'svg{width:100%;height:100%;pointer-events:none}'; document.head.appendChild(style); });
        assert.deepEqual(await iconSizes(), expectedIcons);
        await page.evaluate(() => document.getElementById('ncm210-core').remove());
        const toggle = page.getByRole('switch', { name: '启用 BetterDownload' });
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        // Without downloads nothing runs in the background: no worker, no control writes.
        await page.waitForTimeout(800);
        assert.deepEqual(await page.evaluate(() => [mock.calls.length, Object.keys(mock.files).filter(p => /(control|status)\.json$/.test(p)).length]), [0, 0]);
        assert.deepEqual(await settings.locator('[data-links] a').allTextContents(), ['源代码', '问题反馈']);
        await page.evaluate(() => { mock.listener('failed', 0, 'VipSongsDownload/failed.ncm'); mock.listener('ordinary', 1, 'ordinary.mp3'); });
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => mock.calls.length), 0);
        await page.evaluate(() => mock.listener('task-1', 1, 'VipSongsDownload/歌手/夜间来信.ncm'));
        await page.waitForFunction(() => mock.calls.length > 0);
        assert.deepEqual(await page.evaluate(() => mock.calls[0]), ['"C:/BetterNCM/ncm-better-download/runtime-' + version + '/worker.exe"', false, false]);
        const job = await page.evaluate(() => control().jobs[0]);
        assert.equal(job.target, 'D:\\CloudMusic\\VipSongsDownload\\unlock\\歌手\\夜间来信.ncm');
        // Until the worker reports progress the bar sweeps instead of sitting at 0%.
        await card.locator('.line.waiting').waitFor();
        assert.equal(await card.locator('.percent').isVisible(), false);
        const coverPath = 'C:\\BetterNCM\\ncm-better-download\\runtime-' + version + '\\covers\\1.png';
        await page.evaluate(({ job, coverPath }) => publish({ id: job.id, state: 'converting', path: job.source, percent: 42, format: 'FLAC', cover: coverPath }), { job, coverPath });
        await shadowText('.percent', '42%');
        // Album art comes from the worker's copy of the embedded cover and tints the glass.
        await card.locator('.art img.ready').waitFor();
        assert.notEqual(await card.locator('.tint').evaluate(el => el.style.backgroundColor), '');
        assert.equal(await text('.format'), 'FLAC');
        assert.equal(await text('.detail-text'), '正在整理音频与封面');
        fs.mkdirSync('build', { recursive: true });
        await page.waitForTimeout(450);
        assert.equal(Math.round((await card.boundingBox()).width), 290);
        await card.screenshot({ path: 'build/progress-converting.png' });
        // An idle progress card disappears completely, with no handle to reopen it.
        await hidden();
        await page.evaluate(({ job, coverPath }) => publish({ id: job.id, state: 'converting', path: job.source, percent: 73, format: 'FLAC', cover: coverPath }), { job, coverPath });
        await page.waitForTimeout(350);
        assert.equal(await card.isVisible(), false);
        assert.equal(await page.getByRole('button', { name: '展开转换进度' }).count(), 0);
        const output = job.target.replace(/\.ncm$/, '.flac');
        // The longest note the worker writes for a single song.
        const note = '封面格式无法识别，未写入封面';
        await page.evaluate(({ job, coverPath, output, note }) => publish({ id: job.id, state: 'success', path: output, output, percent: 100, format: 'FLAC', cover: coverPath, warning: note }, { state: 'ready', results: { [job.id]: { state: 'success', output, warning: note } } }), { job, coverPath, output, note });
        const open = page.getByRole('button', { name: '打开文件夹' });
        await open.waitFor({ state: 'visible' });
        await page.waitForTimeout(450);
        assert.ok((await open.boundingBox()).width < 95);
        assert.ok((await card.boundingBox()).height < 135);
        // A note sits beside the folder button, whole, instead of adding a row.
        const beside = async () => {
            const [noteBox, openBox] = [await card.locator('.notice').boundingBox(), await open.boundingBox()];
            assert.ok(Math.abs(noteBox.y + noteBox.height / 2 - (openBox.y + openBox.height / 2)) < 2 && noteBox.x + noteBox.width <= openBox.x, JSON.stringify([noteBox, openBox]));
            // Only the note gives way: the button keeps one line and a round total is never cut.
            assert.ok(openBox.height < 30 && openBox.width > 70, JSON.stringify(openBox));
            assert.ok(await card.locator('.summary').evaluate(el => !el.textContent || el.scrollWidth <= el.clientWidth), 'round total cut off');
        };
        assert.equal(await text('.notice'), note);
        await beside();
        assert.ok(await card.locator('.notice').evaluate(el => el.scrollWidth <= el.clientWidth), 'the note is not cut off');
        assert.match(await card.locator('.card').evaluate(el => getComputedStyle(el).backdropFilter), /blur\(28px\)/);
        assert.equal(await text('.label'), 'BetterDownload');
        assert.equal(await text('.state-text'), '已完成');
        assert.equal(await text('.detail-text'), '转换完成');
        assert.equal(await page.evaluate(() => control().jobs.length), 0);
        await card.screenshot({ path: 'build/progress-card-preview.png' });
        await page.screenshot({ path: 'build/progress-complete.png' });
        // The client's default theme is light, so the glass must also read well over a white list.
        await backdrop('#f5f5f7', '#222');
        await card.screenshot({ path: 'build/progress-card-light-art.png' });
        await backdrop(DARK, '#e6e6e4');
        await page.emulateMedia({ contrast: 'more' });
        assert.equal(await card.locator('.card').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
        await page.emulateMedia({ contrast: 'no-preference' });
        // Keyboard focus should keep the action usable before it is activated.
        await open.focus();
        await page.waitForTimeout(6500);
        assert.equal(await card.isVisible(), true);
        await open.click();
        assert.deepEqual(await page.evaluate(() => mock.calls.at(-1)), ['"D:\\CloudMusic\\VipSongsDownload\\unlock\\歌手"', false, true]);
        assert.equal(await page.evaluate(() => !!document.querySelector('#nbd-progress-card').shadowRoot.activeElement), false);
        await page.mouse.move(10, 10);
        await hidden();
        await page.mouse.move(1075, 690);
        assert.equal(await card.isVisible(), false);
        // A native folder window can suppress mouseleave; blur must also release hover.
        await page.evaluate(() => mock.listener('task-2', 1, 'VipSongsDownload/歌手/晚风.ncm'));
        await page.waitForFunction(() => control().jobs.length === 1);
        const second = await page.evaluate(() => control().jobs[0]), secondOutput = second.target.replace(/\.ncm$/, '.mp3');
        await page.evaluate(({ second, secondOutput }) => publish({ id: second.id, state: 'success', path: secondOutput, output: secondOutput, percent: 100 }, { state: 'ready', results: { [second.id]: { state: 'success', output: secondOutput } } }), { second, secondOutput });
        await shadowText('.format', 'MP3');
        await open.waitFor({ state: 'visible' });
        await open.hover();
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await hidden();
        await toggle.click();
        await page.waitForFunction(() => control().enabled === false);
        assert.equal(await page.evaluate(() => mock.saved), false);
        assert.equal(await page.evaluate(() => mock.listener), null);
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        await toggle.click();
        await page.waitForFunction(() => control().enabled === true && !!mock.listener);
        // Songs finishing close together form one round: a position while converting, a total when done.
        await page.evaluate(() => { mock.listener('a', 1, 'VipSongsDownload/歌手甲/清晨.ncm'); mock.listener('b', 1, 'VipSongsDownload/歌手乙/黄昏.ncm'); });
        await page.waitForFunction(() => control().jobs.length === 2);
        const [first, next] = await page.evaluate(() => control().jobs);
        const firstOutput = first.target.replace(/\.ncm$/, '.flac'), nextOutput = next.target.replace(/\.ncm$/, '.flac');
        await page.evaluate(({ first, coverPath }) => publish({ id: first.id, state: 'converting', path: first.source, percent: 30, format: 'FLAC', cover: coverPath.replace('1.png', '2.png') }), { first, coverPath });
        await shadowText('.detail-text', '第 1 首 · 还剩 1 首');
        await page.waitForTimeout(800);
        await card.screenshot({ path: 'build/progress-round.png' });
        await page.evaluate(({ first, next, firstOutput }) => publish({ id: next.id, state: 'converting', path: next.source, percent: 55, format: 'FLAC' }, { results: { [first.id]: { state: 'success', output: firstOutput } } }), { first, next, firstOutput });
        await shadowText('.detail-text', '第 2 首');
        const warning = '封面格式无法识别，未写入封面';
        await page.evaluate(({ next, nextOutput, warning }) => publish({ id: next.id, state: 'success', path: nextOutput, output: nextOutput, percent: 100, format: 'FLAC', warning }, { state: 'ready', results: { [next.id]: { state: 'success', output: nextOutput, warning } } }), { next, nextOutput, warning });
        await shadowText('.summary', '本轮 2 首');
        assert.equal(await text('.notice'), warning);
        // With a round total the note shares the row and may shorten; its tooltip keeps the whole text.
        await beside();
        assert.equal(await card.locator('.notice').getAttribute('title'), warning);
        await backdrop('#f5f5f7', '#222');
        await page.waitForTimeout(450);
        await card.screenshot({ path: 'build/progress-card-light.png' });
        await backdrop(DARK, '#e6e6e4');
        await open.click();
        assert.deepEqual(await page.evaluate(() => mock.calls.at(-1)), ['"D:\\CloudMusic\\VipSongsDownload\\unlock"', false, true]);
        // A user-requested search queues what the worker found; nothing is queued without it.
        await page.getByRole('button', { name: '查找并转换' }).click();
        await page.waitForFunction(() => !!control().scan);
        const request = await page.evaluate(() => control().scan);
        assert.equal(request.root, 'D:\\CloudMusic\\VipSongsDownload');
        assert.equal(await settings.locator('[data-scan]').isDisabled(), true);
        await page.evaluate(request => publish(null, { state: 'ready', scan: { id: request.id, files: ['D:\\CloudMusic\\VipSongsDownload\\旧歌.ncm', 'D:\\CloudMusic\\VipSongsDownload\\歌手\\老歌.ncm', 'C:\\elsewhere\\x.ncm'], skipped: 3, more: false, error: '' } }), request);
        await page.waitForFunction(() => control().jobs.length === 2 && control().scan === null);
        assert.equal(await settings.locator('[data-scan-note]').textContent(), '已加入 2 首待转换');
        const found = await page.evaluate(() => control().jobs);
        await page.evaluate(found => publish(null, { state: 'ready', results: Object.fromEntries(found.map(job => [job.id, { state: 'success', output: job.target.replace(/\.ncm$/, '.flac') }])) }), found);
        await page.waitForFunction(() => control().jobs.length === 0);
        // Lyrics are off by default; their options wait until they are on, and the page says they need the network.
        const lyricsSwitch = settings.getByRole('switch', { name: '写入歌词' });
        assert.equal(await lyricsSwitch.getAttribute('aria-checked'), 'false');
        assert.deepEqual(await settings.locator('[data-lyrics-option] button').evaluateAll(buttons => buttons.map(b => b.disabled)), [true, true]);
        assert.match(await settings.locator('[data-lyrics-note]').textContent(), /需要联网/);
        await lyricsSwitch.click();
        await settings.getByRole('switch', { name: '附带翻译' }).click();
        assert.deepEqual(await page.evaluate(() => [mock.config.lyrics, mock.config.lyricsTranslation, mock.config.lyricsFile]), [true, true, undefined]);
        assert.match(await settings.locator('[data-lyrics-note]').textContent(), /^已开启/);
        // The worker asks by song ID; the plugin answers from NetEase's lyric API, credits and translation folded into LRC.
        await page.evaluate(() => { window.fetch = async url => { mock.fetched = String(url); if (mock.offline) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, json: async () => ({ code: 200, lrc: { lyric: '{"t":0,"c":[{"tx":"作词: "},{"tx":"测试作者"}]}\n[00:01.00]First line\n' }, tlyric: { lyric: '[00:01.00]第一句\n' } }) }; }; });
        await page.evaluate(() => mock.listener('lyric', 1, 'VipSongsDownload/歌手/有词.ncm'));
        await page.waitForFunction(() => control().jobs.length === 1);
        const worded = await page.evaluate(() => control().jobs[0]);
        assert.deepEqual(await page.evaluate(() => control().lyrics), { enabled: true, file: false });
        await page.evaluate(job => publish({ id: job.id, state: 'converting', path: job.source, percent: 0, message: '正在获取歌词' }, { lyrics: { id: job.id, musicId: '42' } }), worded);
        await page.waitForFunction(() => typeof control().jobs[0].lyrics === 'string');
        assert.equal(await page.evaluate(() => control().jobs[0].lyrics), '[00:00.00]作词: 测试作者\n[00:01.00]First line\n[00:01.00]第一句\n');
        assert.match(await page.evaluate(() => mock.fetched), /^https:\/\/music\.163\.com\/api\/song\/lyric\/v1\?.*&id=42$/);
        await shadowText('.detail-text', '正在获取歌词');
        const wordedOutput = worded.target.replace(/\.ncm$/, '.flac');
        await page.evaluate(({ worded, wordedOutput }) => publish({ id: worded.id, state: 'success', path: wordedOutput, output: wordedOutput, percent: 100, format: 'FLAC', lyrics: true }, { state: 'ready', results: { [worded.id]: { state: 'success', output: wordedOutput } } }), { worded, wordedOutput });
        await shadowText('.detail-text', '转换完成 · 含歌词');
        await page.waitForFunction(() => control().jobs.length === 0);
        // Without the network the song still converts; the plugin passes on a note instead of lyrics.
        await page.evaluate(() => { mock.offline = true; mock.listener('offline', 1, 'VipSongsDownload/歌手/断网.ncm'); });
        await page.waitForFunction(() => control().jobs.length === 1);
        const offline = await page.evaluate(() => control().jobs[0]);
        await page.evaluate(job => publish({ id: job.id, state: 'converting', path: job.source, percent: 0, message: '正在获取歌词' }, { lyrics: { id: job.id, musicId: '43' } }), offline);
        await page.waitForFunction(() => control().jobs[0].lyricsNote === '歌词获取失败');
        assert.equal(await page.evaluate(() => control().jobs[0].lyrics), '');
        await page.evaluate(job => publish(null, { state: 'ready', results: { [job.id]: { state: 'success', output: job.target.replace(/\.ncm$/, '.flac'), warning: '歌词获取失败' } } }), offline);
        await page.waitForFunction(() => control().jobs.length === 0);
        await settings.getByRole('switch', { name: '附带翻译' }).click();
        await lyricsSwitch.click();
        assert.deepEqual(await page.evaluate(() => [mock.config.lyrics, mock.config.lyricsTranslation]), [false, false]);
        // A worker that never answers (for example blocked by security software) is reported, not retried silently.
        await page.evaluate(() => { mock.alive = false; publish(null, { state: 'stopped', heartbeat: Date.now() - 60000 }); });
        const launches = await page.evaluate(() => mock.calls.length);
        await page.evaluate(() => mock.listener('stuck', 1, 'VipSongsDownload/歌手/卡住.ncm'));
        await page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('安全软件'), null, { timeout: 16000 });
        assert.ok(await page.evaluate(() => mock.calls.length) - launches >= 3);
        assert.equal(await text('.state-text'), '未完成');
        await settings.screenshot({ path: 'build/settings-problem.png' });
        const stuck = await page.evaluate(() => control().jobs[0]);
        await page.evaluate(stuck => { mock.alive = true; publish({ id: stuck.id, state: 'converting', path: stuck.source, percent: 10 }); }, stuck);
        await page.waitForFunction(() => !document.querySelector('[data-status]').textContent.includes('安全软件'));
        await page.evaluate(stuck => publish(null, { state: 'ready', results: { [stuck.id]: { state: 'success', output: stuck.target.replace(/\.ncm$/, '.flac') } } }), stuck);
        await page.waitForFunction(() => control().jobs.length === 0);
        // Pop-up choice: "不显示" keeps converting silently, "仅出错" shows failures only.
        const finish = (name, state) => page.evaluate(async ([name, state]) => {
            mock.listener(name, 1, 'VipSongsDownload/歌手/' + name + '.ncm');
            await new Promise(resolve => setTimeout(resolve, 400));
            const job = control().jobs.find(item => item.source.endsWith(name + '.ncm'));
            const result = state === 'success' ? { state, output: job.target.replace(/\.ncm$/, '.flac') } : { state, message: '不是受支持的 NCM 文件。' };
            publish({ id: job.id, state, path: job.source, output: result.output || '', message: result.message || '', percent: 100 }, { state: 'ready', results: { [job.id]: result } });
        }, [name, state]);
        await settings.getByRole('radio', { name: '不显示' }).click();
        assert.equal(await page.evaluate(() => mock.config.notify), 'off');
        // The highlight slides to the chosen option instead of jumping.
        assert.equal(await settings.locator('[data-notify]').evaluate(node => node.style.getPropertyValue('--index')), '2');
        assert.ok(await settings.locator('[data-notify] .nbd-thumb').evaluate(node => node.getAnimations().length > 0));
        await hidden();
        await finish('安静', 'success');
        await page.waitForFunction(() => control().jobs.length === 0);
        await page.waitForTimeout(400);
        assert.equal(await card.isVisible(), false);
        await settings.getByRole('radio', { name: '仅出错' }).click();
        await finish('顺利', 'success');
        await page.waitForFunction(() => control().jobs.length === 0);
        await page.waitForTimeout(400);
        assert.equal(await card.isVisible(), false);
        await finish('出错', 'error');
        await shadowText('.state-text', '未完成');
        assert.equal(await card.isVisible(), true);
        await settings.getByRole('radio', { name: '每首歌' }).click();
        assert.equal(await page.evaluate(() => mock.config.notify), 'all');
        // Compact style: one row, same width; the preview shows it without waiting for a download.
        await settings.getByRole('radio', { name: '简洁' }).click();
        assert.equal(await page.evaluate(() => mock.config.cardStyle), 'compact');
        await settings.getByRole('button', { name: '预览' }).click();
        await shadowText('.song', '示例歌曲');
        await page.waitForTimeout(450);
        assert.equal(Math.round((await card.boundingBox()).width), 290);
        assert.ok((await card.boundingBox()).height < 60);
        await card.screenshot({ path: 'build/progress-card-compact.png' });
        await shadowText('.state-text', '已完成');
        await open.waitFor({ state: 'visible' });
        assert.ok((await open.boundingBox()).width < 30);
        await card.screenshot({ path: 'build/progress-card-compact-done.png' });
        const style = settings.getByRole('radiogroup', { name: '卡片样式' });
        await style.getByRole('radio', { checked: true }).focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => mock.config.cardStyle), 'standard');
        await settings.getByRole('button', { name: '预览' }).click();
        await page.waitForTimeout(500);
        assert.ok((await card.boundingBox()).height > 80);
        // Stay time: with 2 秒 an untouched card leaves about 2 seconds after completing.
        await settings.getByRole('radio', { name: '2 秒' }).click();
        assert.equal(await page.evaluate(() => mock.config.cardStay), 2000);
        await settings.getByRole('button', { name: '预览' }).click();
        await shadowText('.state-text', '已完成');
        const completedAt = Date.now();
        await hidden();
        assert.ok(Date.now() - completedAt < 3200, 'a 2 second card should leave soon after completing');
        await settings.getByRole('radio', { name: '4 秒' }).click();
        assert.equal(await page.evaluate(() => mock.config.cardStay), 4000);
        // With reduced motion requested, the page keeps its layout but skips the movement.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.ok(parseFloat(await settings.locator('.nbd-panel').first().evaluate(node => getComputedStyle(node).animationDuration)) < 0.001);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        // Runtime copies of earlier versions are removed about 20 seconds after start; the current one stays.
        await page.waitForFunction(() => mock.removed.length >= 2, null, { timeout: 25000 });
        assert.deepEqual(await page.evaluate(() => mock.removed.slice().sort()), ['C:/BetterNCM/ncm-better-download/receipts.json', 'C:/BetterNCM/ncm-better-download/runtime-0.4.1']);
        await page.waitForTimeout(300);
        await settings.screenshot({ path: 'build/settings-preview.png' });
        await backdrop('#f5f5f7', '#222');
        await settings.screenshot({ path: 'build/settings-preview-light.png' });
        await backdrop(DARK, '#e6e6e4');
        await page.setViewportSize({ width: 420, height: 800 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: 'build/settings-preview-narrow.png' });
        await page.evaluate(() => window.__ncmBetterDownload.dispose());
        assert.equal(await card.count(), 0);
        assert.equal(await page.evaluate(() => mock.listener), null);
        assert.deepEqual(errors, []);
        console.log('UI passed: on-demand worker, album art and tint, rounds, search, lyrics, blocked-worker notice, pop-up modes, compact style and preview, stay time, settings motion, runtime cleanup, switch, 290px card with notes beside the folder button, idle disappearance, hover/focus, light/dark, narrow layout, cleanup.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
