'use strict';
// Renders promo/index.html frame by frame into build/promo/BetterDownload-promo.mp4.
//
//   node promo/render.cjs                      whole film with the generated soundtrack
//   node promo/render.cjs --music track.mp3    your own (licensed) music instead
//   node promo/render.cjs --stills 12,25.5     PNG stills at those seconds
//   node promo/render.cjs --vertical           the 1080 × 1920 cut for phone feeds (also works with --stills)
//   node promo/render.cjs --cover              cover images for Douyin and Bilibili
//   node promo/render.cjs --preview            plugin/preview.jpg for the store and docs/images/cover.jpg for the README
//   options: --size 1080|2160  --fps 60  --workers 6  --from 0 --to 85
//
// Needs Playwright (npm install --no-save playwright), Microsoft Edge or Chrome, and ffmpeg
// (on PATH, in FFMPEG, or from `pip install imageio-ffmpeg`). The soundtrack needs Python with numpy, scipy and soundfile.
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'build', 'promo');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
}
const python = process.platform === 'win32' ? 'python' : 'python3';
const vertical = !!args.vertical;

function findFfmpeg() {
    if (process.env.FFMPEG) return process.env.FFMPEG;
    if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
    const r = spawnSync(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']);
    if (r.status === 0) return r.stdout.toString().trim();
    throw new Error('找不到 ffmpeg：请安装 ffmpeg、设置 FFMPEG，或运行 pip install imageio-ffmpeg');
}
function run(cmd, list) {
    const r = spawnSync(cmd, list, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    if (r.status !== 0) throw new Error(`${path.basename(cmd)} 退出码 ${r.status}`);
}
const finished = child => new Promise((resolve, reject) => child.on('close', code => code ? reject(new Error('ffmpeg 退出码 ' + code)) : resolve()));

async function openPage(browser, size) {
    const page = await browser.newPage({ viewport: vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: size / 1080 });
    page.on('pageerror', e => console.error('页面错误：', e.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'index.html')).href + (vertical ? '?render&v' : '?render'));
    await page.evaluate(() => window.PROMO.ready);
    const cdp = await page.context().newCDPSession(page);
    return {
        page,
        async shot(t) {
            // One animation frame lets style, layout and paint catch up before the capture.
            await page.evaluate(t => new Promise(r => { window.PROMO.renderAt(t); requestAnimationFrame(() => r()); }), t);
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
            return Buffer.from(data, 'base64');
        },
    };
}

async function stills(browser, size) {
    const view = await openPage(browser, size);
    for (const t of String(args.stills).split(',').map(Number)) {
        const file = path.join(outDir, `still-${vertical ? 'v-' : ''}${t.toFixed(2)}.png`);
        fs.writeFileSync(file, await view.shot(t));
        console.log(file);
    }
}

function soundtrack(duration) {
    if (args.music) return path.resolve(String(args.music));
    const wav = path.join(outDir, 'music.wav'), src = path.join(__dirname, 'music.py');
    if (args.remix || !fs.existsSync(wav) || fs.statSync(wav).mtimeMs < fs.statSync(src).mtimeMs) {
        console.log('生成配乐…');
        run(python, [src, wav, String(duration)]);
    }
    return wav;
}

// Each cover also works cropped to its middle 3:4 or 4:3, the crops profile grids and feeds show.
const COVERS = [
    ['cover.html', 1080, 1920, [['cover-douyin-9x16.png', null], ['cover-douyin-3x4.png', { x: 0, y: 240, width: 1080, height: 1440 }]]],
    ['cover-bilibili.html', 1920, 1080, [['cover-bilibili-16x9.png', null], ['cover-bilibili-4x3.png', { x: 240, y: 0, width: 1440, height: 1080 }]]],
];
async function covers(browser) {
    for (const [html, width, height, shots] of COVERS) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on('pageerror', e => console.error('页面错误：', e.message));
        await page.goto(pathToFileURL(path.join(__dirname, html)).href);
        await page.evaluate(() => document.fonts.ready);
        for (const [name, clip] of shots) {
            const file = path.join(outDir, name);
            await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
            console.log(file);
        }
        await page.close();
    }
}

// Written straight to where they are used. The README shows its cover 880 wide, so that one renders at 2x.
// Below quality 100 Chrome's JPEG encoder leaves blotches in the dark glow; the files stay small anyway.
const PREVIEWS = [
    ['?store', 960, 480, 1, path.join(root, 'plugin', 'preview.jpg')],
    ['', 880, 440, 2, path.join(root, 'docs', 'images', 'cover.jpg')],
];
async function previews(browser) {
    for (const [query, width, height, scale, file] of PREVIEWS) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
        page.on('pageerror', e => console.error('页面错误：', e.message));
        await page.goto(pathToFileURL(path.join(__dirname, 'preview.html')).href + query);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: file, type: 'jpeg', quality: 100 });
        console.log(file);
        await page.close();
    }
}

async function film(browser, size, ff) {
    const probe = await openPage(browser, size);
    const duration = await probe.page.evaluate(() => window.PROMO.duration);
    await probe.page.close();
    const fps = Number(args.fps || 60), from = Number(args.from || 0), to = Number(args.to || duration);
    const total = Math.round((to - from) * fps);
    const workers = Math.max(1, Math.min(Number(args.workers || Math.max(2, Math.min(8, os.cpus().length >> 2))), total));
    const music = soundtrack(duration);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nbd-promo-'));
    const chunk = Math.ceil(total / workers), segments = [];
    let done = 0, last = 0;
    const started = Date.now();
    console.log(`渲染 ${total} 帧（${size}p${fps}，${workers} 路并行）…`);
    await Promise.all(Array.from({ length: workers }, async (_, w) => {
        const a = w * chunk, b = Math.min(total, a + chunk);
        if (a >= b) return;
        const seg = path.join(tmp, `part${w}.mp4`); segments[w] = seg;
        const encoder = spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
            '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'animation', seg],
            { stdio: ['pipe', 'inherit', 'inherit'] });
        const closed = finished(encoder);
        const view = await openPage(browser, size);
        for (let i = a; i < b; i++) {
            const png = await view.shot(from + i / fps);
            if (!encoder.stdin.write(png)) await new Promise(r => encoder.stdin.once('drain', r));
            if (++done - last >= fps * 2 || done === total) {
                last = done;
                const s = (Date.now() - started) / 1000;
                process.stdout.write(`\r${(done / total * 100).toFixed(1)}%  ${done}/${total} 帧  已用 ${s.toFixed(0)} 秒  剩余约 ${(s / done * (total - done)).toFixed(0)} 秒   `);
            }
        }
        encoder.stdin.end();
        await closed;
        await view.page.close();
    }));
    console.log('');
    const list = path.join(tmp, 'parts.txt');
    fs.writeFileSync(list, segments.filter(Boolean).map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
    const video = path.join(tmp, 'video.mp4');
    run(ff, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);
    const length = total / fps, name = args.out ? path.resolve(String(args.out))
        : path.join(outDir, `BetterDownload-promo${vertical ? '-vertical' : ''}${size > 1080 ? '-4k' : ''}.mp4`);
    // Music of any length is trimmed to the film and faded out over its last seconds.
    run(ff, ['-y', '-loglevel', 'error', '-i', video, '-ss', String(from), '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
        '-af', `afade=t=out:st=${Math.max(0, length - 2.5)}:d=2.5`, '-c:a', 'aac', '-b:a', '256k', '-t', String(length), '-movflags', '+faststart', name]);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(name);
}

(async () => {
    fs.mkdirSync(outDir, { recursive: true });
    const size = Number(args.size || 1080);
    const browser = await chromium.launch({ channel: process.env.NBD_BROWSER_CHANNEL || 'msedge' });
    try {
        if (args.cover) await covers(browser);
        else if (args.preview) await previews(browser);
        else if (args.stills) await stills(browser, size);
        else await film(browser, size, findFfmpeg());
    } finally {
        await browser.close();
    }
})().catch(e => { console.error(e); process.exit(1); });
