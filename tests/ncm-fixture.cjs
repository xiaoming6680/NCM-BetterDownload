const crypto = require('node:crypto');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const block = b => Buffer.concat([u32(b.length), b]);
function encrypt(b, key) {
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null);
    return Buffer.concat([cipher.update(b), cipher.final()]);
}
function fixture(audio, options = {}) {
    const key = Buffer.from('Synthetic-test-stream-key');
    const encryptedKey = encrypt(Buffer.concat([Buffer.from('neteasecloudmusic'), key]), 'hzHRAmso5kInbaxW').map(x => x ^ 0x64);
    const box = Array.from({ length: 256 }, (_, i) => i);
    let previous = 0;
    for (let i = 0; i < 256; i++) {
        const index = (box[i] + previous + key[i % key.length]) % 256;
        [box[i], box[index]] = [box[index], box[i]];
        previous = index;
    }
    const encryptedAudio = Buffer.from(audio);
    for (let i = 0; i < audio.length; i++) {
        const j = (i + 1) % 256;
        encryptedAudio[i] ^= box[(box[j] + box[(box[j] + j) % 256]) % 256];
    }
    const meta = options.metadata === false ? Buffer.alloc(0) : Buffer.from("163 key(Don't modify):" + encrypt(Buffer.from('music:' + JSON.stringify({ musicId: 1234567, musicName: '合成测试', album: '测试专辑', artist: [['测试歌手', 1]], track: 3, format: options.claimFormat || 'mp3' })), "#14ljk_!\\]&0U<'(").toString('base64')).map(x => x ^ 0x63);
    const cover = options.cover || require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/cover.png'));
    return Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(2), block(encryptedKey), block(meta), Buffer.alloc(5), u32(cover.length + 128), u32(cover.length), cover, Buffer.alloc(128), encryptedAudio]);
}

module.exports = { fixture, u32 };
