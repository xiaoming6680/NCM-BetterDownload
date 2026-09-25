"""Synthesizes the soundtrack of the BetterDownload film: an original, royalty-free track.

120 BPM, so a bar lasts two seconds and the scenes in promo/index.html change on bars.
Hits and interface sounds sit on the film's own cue times.

    python promo/music.py [out.wav] [seconds]
"""
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
BEAT = 0.5
BAR = 4 * BEAT
STEP = BEAT / 4
OUT = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 85.0
N = int(SR * (DUR + 1))
rng = np.random.default_rng(20250925)

BUS = {k: np.zeros((N, 2), np.float32) for k in ('kick', 'drums', 'bass', 'pad', 'keys', 'pluck', 'sfx')}
SEND = {k: np.zeros((N, 2), np.float32) for k in ('hall', 'room', 'echo')}
KICKS = []


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(seconds):
    return np.arange(int(seconds * SR)) / SR


def ramp(t, seconds):
    return np.clip(t / seconds, 0, 1)


def filt(x, kind, f, order=2):
    return signal.sosfilt(signal.butter(order, f, kind, fs=SR, output='sos'), x, axis=0)


def noise(n, channels=1):
    return rng.standard_normal(n) if channels == 1 else rng.standard_normal((n, channels))


def norm(x, peak=1.0):
    return x * (peak / (np.abs(x).max() + 1e-12))


def place(bus, t, sig, gain=1.0, pan=0.0, hall=0.0, room=0.0, echo=0.0):
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], 1) * np.sqrt(2)
    i = int(round(t * SR))
    if i < 0:
        sig, i = sig[-i:], 0
    j = min(N, i + len(sig))
    if j <= i:
        return
    sig = (sig[:j - i] * gain).astype(np.float32)
    BUS[bus][i:j] += sig
    for name, amount in (('hall', hall), ('room', room), ('echo', echo)):
        if amount:
            SEND[name][i:j] += sig * amount


# ---------- oscillators ----------
TN = 4096
_tables = {}


def saw_table(f0, cutoff):
    """One band-limited cycle of a saw whose harmonics roll off above `cutoff`."""
    key = (round(f0, 3), cutoff)
    if key not in _tables:
        k = np.arange(1, max(2, int(min(cutoff * 3, SR * 0.45) / f0)) + 1)
        amp = np.exp(-k * f0 / cutoff) / k
        tab = (amp[:, None] * np.sin(np.outer(k, 2 * np.pi * np.arange(TN) / TN))).sum(0)
        _tables[key] = tab / np.abs(tab).max()
    return _tables[key]


def osc(tab, f, n, phase):
    idx = ((phase + f * np.arange(n) / SR) % 1.0) * TN
    i0 = idx.astype(np.int64)
    fr = idx - i0
    return tab[i0] * (1 - fr) + tab[(i0 + 1) % TN] * fr


def sweep_noise(seconds, f_from, f_to, width=0.55, channels=2):
    """Noise through a band-pass whose centre glides from f_from to f_to."""
    n = int(seconds * SR)
    out = np.zeros((n, channels))
    for c in range(channels):
        fr, tf, z = signal.stft(noise(n), SR, nperseg=2048)
        pos = np.clip(tf / seconds, 0, 1)
        fc = f_from * (f_to / f_from) ** pos
        z *= np.exp(-0.5 * ((np.log2(fr[:, None] + 1) - np.log2(fc[None, :])) / width) ** 2)
        out[:, c] = signal.istft(z, SR, nperseg=2048)[1][:n]
    return out


# ---------- instruments ----------
def pad(t0, dur, notes, gain, bright=1800, bright_to=None, attack=0.6, release=1.6):
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    a = ramp(t, attack)
    env = a * a * (3 - 2 * a) * np.where(t < dur, 1.0, np.exp(-(t - dur) / (release / 4)))
    env *= 1 + 0.05 * np.sin(2 * np.pi * 0.23 * t + rng.random() * 6)
    mixc = ramp(t, dur) if bright_to else None
    out = np.zeros((n, 2))
    for m in notes:
        f = mtof(m)
        dark = saw_table(f, bright)
        lite = saw_table(f, bright_to) if bright_to else None
        for cents, pan in ((-7, -0.75), (0, 0.0), (7, 0.75)):
            fr, ph = f * 2 ** (cents / 1200), rng.random()
            v = osc(dark, fr, n, ph)
            if lite is not None:
                v = v * (1 - mixc) + osc(lite, fr, n, ph) * mixc
            ang = (pan + 1) * np.pi / 4
            out[:, 0] += v * np.cos(ang)
            out[:, 1] += v * np.sin(ang)
    out *= (env * np.sqrt(2) / (len(notes) * 3))[:, None]
    place('pad', t0, out, gain, hall=0.35)


def piano(t0, m, dur, vel=0.8, gain=1.0, pan=0.0, hall=0.3):
    f = mtof(m)
    t = tt(dur + 2.2)
    x = np.zeros(len(t))
    for k in range(1, 14):
        fk = k * f * np.sqrt(1 + 0.00025 * k * k)
        if fk > 14000:
            break
        amp = vel ** (0.6 + 0.12 * k) / k ** 1.15 * np.exp(-k * f / 5000)
        tau = 1.9 * (330 / f) ** 0.3 / (1 + 0.5 * (k - 1))
        x += amp * np.sin(2 * np.pi * fk * t + rng.random() * 6.283) * np.exp(-t / tau)
    thump = filt(noise(len(t)), 'low', 900) * np.exp(-t / 0.012) * 0.04
    x = (x * ramp(t, 0.004) + thump) * np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.25))
    place('keys', t0, norm(x, vel), gain, pan, hall=hall)


def pluck(t0, m, vel=0.7, gain=1.0, pan=0.0):
    f = mtof(m)
    t = tt(0.9)
    x = np.zeros(len(t))
    for k in range(1, 30):
        if k * f > 12000:
            break
        rate = 5.5 + 2.2 * k * (f / 440) ** 0.5
        x += np.sin(2 * np.pi * k * f * t + (rng.random() * 6.283 if k > 1 else 0)) * np.exp(-rate * t) / k
    x *= ramp(t, 0.002) * np.exp(-2.0 * t)
    place('pluck', t0, norm(x, vel), gain, pan, hall=0.12, echo=0.22)


def bass(t0, m, dur, gain=1.0):
    f = mtof(m)
    t = tt(dur)
    ph = 2 * np.pi * f * t
    # Upper harmonics keep the line audible on laptop speakers.
    x = np.sin(ph) + 0.45 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph) + 0.1 * np.sin(4 * ph)
    x = np.tanh(1.6 * x) / np.tanh(1.6) * ramp(t, 0.012) * np.clip((dur - t) / 0.06, 0, 1)
    place('bass', t0, x, gain)


def kick(t0, vel=1.0):
    t = tt(0.6)
    f = 48 + 100 * np.exp(-t / 0.03) + 30 * np.exp(-t / 0.11)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.27) * ramp(t, 0.001)
    click = filt(noise(len(t)), 'high', 2500) * np.exp(-t / 0.004) * 0.18
    place('kick', t0, np.tanh(1.8 * (body + click)) / np.tanh(1.8) * vel, room=0.04)
    KICKS.append(t0)


def clap(t0, vel=1.0, pan=0.0):
    t = tt(0.5)
    env = sum(np.where(t >= d, np.exp(-(t - d) / 0.007), 0) * 0.8 for d in (0, 0.012, 0.024))
    env = env + np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.13), 0) * 0.55
    place('drums', t0, norm(filt(noise(len(t)), 'bandpass', [900, 4000]) * env, vel), 1.0, pan, room=0.25, hall=0.08)


def hat(t0, vel=0.5, open_=False, pan=0.25):
    t = tt(0.5 if open_ else 0.12)
    x = filt(noise(len(t)), 'high', 7500, 4) * np.exp(-t / (0.16 if open_ else 0.024)) * ramp(t, 0.0005)
    place('drums', t0, norm(x, vel), 1.0, pan, room=0.1)


def shaker(t0, vel=0.3, pan=-0.35):
    t = tt(0.12)
    x = filt(noise(len(t)), 'bandpass', [5000, 11000]) * ramp(t, 0.012) * np.exp(-t / 0.03)
    place('drums', t0, norm(x, vel), 1.0, pan)


def cymbal(seconds, decay):
    t = tt(seconds)
    x = filt(noise(len(t), 2), 'high', 3500)
    x = x + sum(0.12 * np.sin(2 * np.pi * f * t + rng.random() * 6)[:, None] * np.exp(-t / 0.7)[:, None]
                for f in (3150, 4270, 5330, 6870, 8120, 9600))
    return norm(x * (np.exp(-t / decay) * ramp(t, 0.002))[:, None])


def crash(t0, vel=0.5, seconds=3.0):
    place('drums', t0, cymbal(seconds, 1.1) * vel, hall=0.25)


def swell(t_end, seconds=1.0, vel=0.35):
    """A reversed cymbal that peaks on t_end."""
    x = cymbal(seconds, 0.32)[::-1].copy()
    x[-int(0.015 * SR):] *= np.linspace(1, 0, int(0.015 * SR))[:, None]
    place('sfx', t_end - seconds, x * vel, hall=0.3)


def riser(t0, seconds, vel=0.4):
    t = tt(seconds)
    x = sweep_noise(seconds, 250, 9000, 0.5)
    f = 180 * 4 ** (t / seconds)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.08
    x = norm(x) + tone[:, None]
    place('sfx', t0, x * ((t / seconds) ** 2.4)[:, None] * vel, hall=0.3)


def impact(t0, vel=1.0):
    t = tt(3.5)
    f = 32 + 48 * np.exp(-t / 0.2)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.3) * ramp(t, 0.002)
    thump = filt(noise(len(t)), 'low', 180) * np.exp(-t / 0.09) * 2.0
    place('sfx', t0, np.tanh(1.5 * (sub + thump)) * 0.9 * vel, room=0.1, hall=0.2)
    place('sfx', t0, cymbal(3.5, 1.4) * 0.3 * vel, hall=0.3)


def whoosh(t0, seconds=0.5, vel=0.3, f_from=500, f_to=2600, pan_from=-0.6, pan_to=0.6):
    x = norm(sweep_noise(seconds, f_from, f_to, 0.45, 1)[:, 0])
    t = tt(seconds)
    x *= np.sin(np.pi * np.clip(t / seconds, 0, 1)) ** 2
    ang = (np.linspace(pan_from, pan_to, len(t)) + 1) * np.pi / 4
    place('sfx', t0, np.stack([x * np.cos(ang), x * np.sin(ang)], 1) * np.sqrt(2) * vel, hall=0.2)


def tick(t0, m, vel=0.3, pan=0.0):
    """A small glassy bell, for things snapping into place."""
    f = mtof(m)
    t = tt(0.7)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.16) + 0.35 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.06)
         + 0.12 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / 0.025)) * ramp(t, 0.0015)
    place('sfx', t0, norm(x, vel), 1.0, pan, hall=0.25, echo=0.1)


def click(t0, vel=0.3, f=3000, pan=0.0):
    t = tt(0.05)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.005) + filt(noise(len(t)), 'high', 4000) * np.exp(-t / 0.0012) * 0.6
    place('sfx', t0, norm(x, vel), 1.0, pan, room=0.2)


def chime(t0, notes=(86, 93), vel=0.3):
    for i, m in enumerate(notes):
        f = mtof(m)
        t = tt(2.5)
        x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d)
                for r, a, d in ((1, 1, 1.6), (2.0, 0.5, 0.9), (3.01, 0.25, 0.5), (4.2, 0.15, 0.3), (5.4, 0.08, 0.2)))
        place('sfx', t0 + i * 0.07, norm(x * ramp(t, 0.002), vel), 1.0, -0.2 + 0.4 * i, hall=0.35, echo=0.15)


def pop(t0, vel=0.25):
    t = tt(0.12)
    f = 520 + 700 * ramp(t, 0.04)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.03) * ramp(t, 0.002)
    place('sfx', t0, norm(x, vel), room=0.2)


def key(t0, vel=0.18):
    t = tt(0.06)
    x = filt(noise(len(t)), 'bandpass', [1500, 5000]) * np.exp(-t / 0.006) + 0.6 * np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.018)
    place('sfx', t0, norm(x, vel * (0.8 + 0.4 * rng.random())), 1.0, rng.uniform(-0.2, 0.2), room=0.25)


def blip_down(t0, vel=0.22):
    t = tt(0.35)
    f = 880 * 0.25 ** ramp(t, 0.3)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.1) * ramp(t, 0.003)
    place('sfx', t0, norm(x, vel), hall=0.3)


def swoosh_down(t0, seconds=1.0, vel=0.25):
    whoosh(t0, seconds, vel, 4000, 300, 0.4, -0.4)


# ---------- arrangement ----------
CHORDS = {  # bass note, pad voicing
    'Bm9': (35, [50, 54, 57, 61, 66]),
    'Gmaj9': (31, [55, 59, 62, 66, 69]),
    'D/F#': (42, [50, 57, 61, 64, 66]),
    'Asus': (33, [57, 62, 64, 69]),
    'A7sus': (33, [55, 57, 62, 64, 69]),
    'D': (38, [57, 62, 64, 66, 69]),
    'A/C#': (37, [57, 61, 64, 69, 71]),
    'Bm7': (35, [57, 62, 64, 66, 71]),
    'Em9': (40, [55, 59, 62, 66, 71]),
}
GROOVE = ['D', 'A/C#', 'Bm7', 'Gmaj9']
PLAN = (['Bm9', 'Gmaj9', 'D/F#', 'Asus']      # 0–8 s    the locked library
        + ['Gmaj9', 'A7sus']                   # 8–12 s   "现在，" and the icon
        + GROOVE * 2                           # 12–28 s  reveal, unlocking, the card
        + GROOVE * 2 + ['D', 'A/C#']           # 28–48 s  five features
        + ['Em9', 'Gmaj9', 'Bm9', 'Asus']      # 48–56 s  the card up close
        + ['Gmaj9', 'A7sus']                   # 56–60 s  converting old downloads
        + GROOVE * 2                           # 60–76 s  what BetterNCM is and how to get the plugin
        + ['D', 'Gmaj9', 'D'])                 # 76 s–    end card, last chord rings out
SECTION = {}
for b in range(len(PLAN)):
    SECTION[b] = ('intro' if b < 4 else 'build' if b < 6 else 'groove' if b < 14 else 'feature' if b < 24
                  else 'break' if b < 28 else 'build2' if b < 30 else 'groove' if b < 38 else 'finale' if b < 40 else 'end')

TRESILLO = [0, 3, 6, 8, 11, 14]
ARP = [0, 2, 4, 1, 3, 2]
HOOK = {  # beats within the bar, note, length in beats
    'D': [(0, 78, 1.5), (1.5, 76, 0.5), (2, 74, 2)],
    'A/C#': [(0, 76, 1), (1, 73, 1), (2, 69, 2)],
    'Bm7': [(0, 74, 1.5), (1.5, 73, 0.5), (2, 71, 1), (3, 74, 1)],
    'Gmaj9': [(0, 78, 3), (3, 76, 1)],
}
INTRO_TUNE = [
    [(0, 78, 2), (2, 76, 1), (3, 74, 1)],
    [(0, 74, 3), (3, 71, 1)],
    [(0, 69, 1), (1, 73, 1), (2, 76, 2)],
    [(0, 74, 2), (2, 76, 1), (3, 73, 1)],
]

for b, name in enumerate(PLAN):
    t0, sec = b * BAR, SECTION[b]
    root, voicing = CHORDS[name]
    last = b == len(PLAN) - 1

    # Pads carry every bar; they open up in the builds.
    if sec == 'intro':
        pad(t0, BAR, voicing + [root + 12], 0.9, 1100, attack=0.9 if b else 2.0)
    elif sec in ('build', 'build2'):
        k = b - (4 if sec == 'build' else 28)
        pad(t0, BAR, voicing, 0.95, 1300 + 1300 * k, 2600 + 1600 * k, attack=0.3)
    elif sec == 'break':
        pad(t0, BAR, voicing + [root + 24], 0.95, 1500, attack=0.5)
    elif last:
        pad(t0, 4.0, voicing + [root + 24], 1.0, 2600, attack=0.05, release=3.5)
    else:
        pad(t0, BAR, voicing, 1.05, 2600, attack=0.15)

    # Sub bass under the grooves.
    if sec in ('groove', 'feature', 'finale', 'build2'):
        bass(t0, root, BAR, 0.3)
    elif sec == 'break':
        bass(t0, root, BAR, 0.2)
    elif last:
        bass(t0, root, 4.5, 0.3)

    # Drums.
    if sec in ('groove', 'feature', 'finale'):
        for s in range(0, 16, 4):
            kick(t0 + s * STEP, 0.72)
        for s in (4, 12):
            clap(t0 + s * STEP, 1.0)
        for s in (2, 6, 10, 14):
            hat(t0 + s * STEP, 0.42 if s != 14 or b % 4 != 3 else 0.5, open_=s == 14 and b % 4 == 3)
        if sec == 'feature':
            for s in range(16):
                shaker(t0 + s * STEP, 0.3 if s % 2 else 0.16)
    elif sec == 'break':
        if b in (24, 26):
            kick(t0, 0.6)
        for s in (0, 4, 8, 12):
            hat(t0 + s * STEP, 0.22)
    elif sec == 'build2':
        for s in range(0, 16, 4):
            kick(t0 + s * STEP, 0.66)
        steps = range(0, 16, 2) if b == 28 else range(16)
        for s in steps:
            p = (s / 16 + (b - 28)) / 2
            clap(t0 + s * STEP, 0.2 + 0.6 * p)
    elif last:
        kick(t0, 0.8)

    # Plucked arpeggios.
    if sec in ('build', 'build2'):
        tones = sorted(voicing)
        for i, s in enumerate(range(0, 16, 2)):
            pluck(t0 + s * STEP, tones[i % len(tones)] + 12, 0.35 + 0.35 * ((b % 2) * 8 + i) / 16, 1.25, 0.3 if i % 2 else -0.3)
    elif (sec == 'groove' and b >= 7) or sec in ('feature', 'finale'):
        tones = sorted(voicing)
        for i, s in enumerate(TRESILLO):
            pluck(t0 + s * STEP, tones[ARP[i] % len(tones)] + 12, 0.62 if i == 0 else 0.5, 1.25, [-0.35, 0.35][i % 2])

    # Keys: a quiet tune over the locked library, soft chords under the unlocking, a hook over the features,
    # arpeggios in the breakdown.
    if sec == 'intro':
        for beat, m, length in INTRO_TUNE[b]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.62, 0.9, 0.1)
        piano(t0, root % 12 + 48, BAR, 0.35, 0.7, -0.2)
    elif sec == 'groove' and b >= 7:
        for s in (0, 6):
            for m in sorted(voicing)[1:4]:
                piano(t0 + s * STEP, m, 0.9, 0.38, 0.8, 0.1)
    elif sec in ('feature', 'finale') and name in HOOK:
        for beat, m, length in HOOK[name]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.7, 0.8, 0.15)
    elif sec == 'break':
        tones = sorted(voicing) + [sorted(voicing)[1] + 12]
        for i in range(8):
            piano(t0 + i * BEAT / 2, tones[[0, 2, 4, 5, 3, 4, 2, 1][i] % len(tones)] + 12, BEAT, 0.5, 0.8, [-0.25, 0.25][i % 2])
    elif last:
        for i, m in enumerate(sorted(voicing + [root + 24])):
            piano(t0 + i * 0.03, m + 12, 4.0, 0.55, 0.8, -0.3 + 0.12 * i, hall=0.45)

# ---------- hits and interface sounds, on the film's cues ----------
whoosh(4.15, 1.4, 0.18, 200, 900, 0, 0)                   # the library fades in
riser(8.6, 3.4, 0.45)                                     # "现在，"
tick(10.1, 81, 0.18)                                      # the arrow drops in
click(11.45, 0.35, 3400)                                  # the lock springs open
click(11.49, 0.25, 1800)
impact(12.0, 1.0)                                         # BetterDownload
swell(14.0, 0.8, 0.3)                                     # 下载即解锁。
for c, m in enumerate([81, 83, 86, 88, 90, 93, 95]):      # each column unlocks
    tick(17.3 + c * 0.3, m, 0.22, -0.6 + c * 0.2)
whoosh(22.9, 0.42, 0.22, 900, 3200, 0.8, 0.2)            # the card slides in
chime(25.5, (86, 93), 0.32)                               # 已完成
for s in (28, 32, 36, 40, 44):                            # feature changes
    swell(s, 0.6, 0.18)
for i in range(5):                                        # tags ticked off
    tick(33.2 + i * 0.2, [86, 88, 90, 93, 95][i], 0.12, 0.3)
for p in (36.33, 36.37, 36.42, 36.49, 36.61, 36.9):       # the counter rolls to 0
    click(p, 0.16, 2200)
pop(42.1, 0.22)                                           # 原样保留
pop(42.35, 0.25)                                          # 新
blip_down(46.95, 0.2)                                     # the converter exits
swoosh_down(47.4, 0.9, 0.2)                               # into the breakdown
for i in range(4):                                        # cards float in
    whoosh(48.35 + i * 0.16, 0.5, 0.08, 700, 2400, -0.6 + 0.4 * i, -0.2 + 0.4 * i)
whoosh(53.2, 0.7, 0.12, 2500, 5000, -0.5, 0.5)            # the tint follows the cover
whoosh(54.4, 0.7, 0.12, 2500, 5000, 0.5, -0.5)
click(57.52, 0.3, 2400)                                   # 查找并转换
pop(58.6, 0.22)                                           # 已加入 12 首
whoosh(58.85, 0.42, 0.18, 900, 3200, 0.8, 0.2)
riser(58.0, 2.0, 0.35)
crash(60.0, 0.35)                                         # 它是一个 BetterNCM 插件。
for i, m in enumerate((81, 83, 86, 88, 90)):              # client + BetterNCM = plugins
    tick(60.85 + i * 0.2, m, 0.16, -0.4 + 0.2 * i)
tick(62.3, 93, 0.2)                                       # BetterDownload lights up
swell(64.0, 0.6, 0.2)                                     # 第 1 步
click(65.3, 0.3, 2400)                                    # 安装
tick(65.6, 90, 0.16)
pop(66.1, 0.22)                                           # the BetterNCM button appears
swell(68.0, 0.6, 0.2)                                     # 第 2 步
click(68.52, 0.28, 2400)                                  # 开始使用 BetterNCM
for i in range(14):                                       # searching for BetterDownload
    key(69.0 + i * 0.06, 0.24)
whoosh(69.45, 0.5, 0.1, 900, 2600, 0.3, -0.3)            # the card moves to the front
click(70.84, 0.3, 2400)                                   # install
tick(71.4, 93, 0.18)                                      # installed
whoosh(71.55, 0.5, 0.12, 700, 2200, 0, 0)                 # 插件的更改需要重启以生效
click(72.92, 0.3, 2400)                                   # 重启
swoosh_down(73.05, 0.6, 0.18)
whoosh(73.6, 0.42, 0.18, 900, 3200, 0.8, 0.2)             # the next download
chime(74.8, (86, 93), 0.3)                                # 已完成
swell(76.0, 0.8, 0.25)
impact(76.0, 0.8)                                         # the end card
tick(77.0, 93, 0.12)                                      # the icon's shine
for i in range(14):                                       # typing BetterDownload
    key(79.95 + i * 0.055, 0.28)
crash(80.0, 0.22, 4.0)


# ---------- mix ----------
def reverb(x, t60, pre=0.02, lp=6500):
    t = tt(t60)
    ir = noise(len(t), 2) * np.exp(-6.9 * t / t60)[:, None]
    low = filt(ir, 'low', lp)
    ir = low + (ir - low) * np.exp(-t / 0.3)[:, None] * 0.5
    ir = np.concatenate([np.zeros((int(pre * SR), 2)), ir])
    ir /= np.sqrt((ir ** 2).sum(0))
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)
    return filt(y, 'high', 180)


def echo(x, delay=0.375, feedback=0.38, repeats=6):
    d = int(delay * SR)
    src = filt(x, 'bandpass', [300, 5000])
    y = np.zeros_like(x)
    for i in range(1, repeats + 1):
        if i * d >= N:
            break
        shifted = np.zeros_like(x)
        shifted[i * d:] = src[:N - i * d]
        y += (shifted[:, ::-1] if i % 2 else shifted) * 0.6 * feedback ** (i - 1)
    return y


def sidechain(depth, release=0.16):
    g = np.ones(N)
    t = tt(0.45)
    shape = 1 - depth * ramp(t, 0.004) * np.exp(-t / release)
    for tk in KICKS:
        i = int(round(tk * SR))
        j = min(N, i + len(shape))
        g[i:j] = np.minimum(g[i:j], shape[:j - i])
    return g[:, None]


def loudness(x):
    """Integrated loudness in LUFS (ITU-R BS.1770-4)."""
    k = signal.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x, axis=0)
    k = signal.lfilter([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621], k, axis=0)
    size, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([(k[i:i + size] ** 2).mean(0).sum() for i in range(0, len(k) - size, hop)])
    z = z[z > 10 ** ((-70 + 0.691) / 10)]
    z = z[z > z.mean() * 10 ** (-1.0)]
    return -0.691 + 10 * np.log10(z.mean())


def limit(x, ceiling_db=-1.0):
    """Look-ahead limiter on 4x oversampled peaks, so the true peak stays under the ceiling."""
    c = 10 ** (ceiling_db / 20)
    up = signal.resample_poly(x, 4, 1, axis=0)
    peak = np.abs(up).max(1)[:len(x) * 4].reshape(-1, 4).max(1)
    need = np.minimum(1.0, c / np.maximum(peak, 1e-9))
    w = int(0.006 * SR)
    g = uniform_filter1d(minimum_filter1d(need, 2 * w + 1), w)
    g = np.minimum(g, uniform_filter1d(minimum_filter1d(need, 8 * w + 1), 4 * w))
    return x * g[:, None]


mix = (BUS['kick'] + BUS['drums'] + BUS['sfx']
       + BUS['bass'] * sidechain(0.6) + BUS['pad'] * sidechain(0.45) + BUS['pluck'] * sidechain(0.3) + BUS['keys'] * sidechain(0.15)).astype(np.float64)
mix += reverb(SEND['hall'].astype(np.float64), 2.8) * 0.9 + reverb(SEND['room'].astype(np.float64), 0.7, 0.008, 9000) * 0.6
mix += echo(SEND['echo'].astype(np.float64))
mix = filt(mix, 'high', 28)
end = int(DUR * SR)
mix = mix[:end]
mix[-int(1.5 * SR):] *= np.linspace(1, 0, int(1.5 * SR))[:, None] ** 2
mix *= 10 ** ((-14 - loudness(mix)) / 20)
mix = limit(np.tanh(mix * 1.1) / 1.1)
sf.write(OUT, mix.astype(np.float32), SR, subtype='PCM_24')
print(f'{OUT}: {len(mix) / SR:.1f} s, {loudness(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS')
