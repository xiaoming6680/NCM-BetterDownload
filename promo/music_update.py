"""Synthesizes the soundtrack of the 0.6 update video: an original, royalty-free acoustic track.

Nylon guitar, piano, strings and upright bass with snaps and a shaker; no synth pads, drum machine or risers.
120 BPM in D major, so a bar lasts two seconds and the scenes of promo/index.html?update change on bars.
The last eight seconds turn to B minor for the teaser.

    python promo/music_update.py [out.wav] [seconds]
"""
import sys

import numpy as np
from scipy import signal

import sound
from sound import BAR, BEAT, STEP, SR, filt, mtof, noise, norm, piano, place, ramp, tt, click, key, pop, tick, chime, swell, saw_table, TN

OUT = sys.argv[1] if len(sys.argv) > 1 else 'music-update.wav'
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
sound.start(DUR, seed=20260927)


# ---------- acoustic instruments ----------
def string(m, seconds, t60, pick=0.18, bright=0.55, damp=None):
    """A plucked string (Karplus-Strong), tuned with an all-pass fractional delay. damp: seconds until a fretting hand mutes it."""
    f = mtof(m)
    n = int(seconds * SR)
    period = SR / f
    delay = int(period - 0.5 - 0.1)
    frac = period - 0.5 - delay
    c = (1 - frac) / (1 + frac)
    g = 10 ** (-3 / (t60 * f))
    a = np.zeros(delay + 3)
    a[0], a[1] = 1.0, c
    a[delay] -= g * c / 2
    a[delay + 1] -= g * (1 + c) / 2
    a[delay + 2] -= g / 2
    burst = int(period)
    x = np.zeros(n)
    exc = sound.rng.uniform(-1, 1, burst)
    exc = signal.lfilter([1 - bright], [1, -bright], exc)          # softer fingers, warmer tone
    exc -= 0.8 * np.concatenate([np.zeros(max(1, int(pick * burst))), exc])[:burst]
    x[:burst] = exc
    y = signal.lfilter([1, c], a, x)
    if damp is not None:
        t = np.arange(n) / SR
        y *= np.where(t < damp, 1.0, np.exp(-(t - damp) / 0.06))
    return y


def guitar(t0, m, vel=0.55, pan=0.0, t60=None, damp=None):
    """Nylon-string guitar: a plucked string through a small wooden body."""
    t60 = t60 or float(np.interp(m, [40, 76], [3.2, 1.3]))
    y = string(m, t60 * 1.1, t60, 0.2, 0.5, damp)
    body = filt(y, 'bandpass', [90, 260]) * 0.35 + filt(y, 'bandpass', [380, 900]) * 0.2
    y = filt(y + body, 'low', 5200) + 0.012 * filt(noise(len(y)), 'bandpass', [2000, 7000]) * np.exp(-np.arange(len(y)) / SR / 0.004)
    place('pluck', t0, norm(y, vel), 1.0, pan, hall=0.16, room=0.18)


def upright(t0, m, vel=0.6, dur=1.6):
    """Upright bass, plucked: the same string, darker and heavier."""
    y = string(m, dur + 0.4, 1.6, 0.3, 0.72, dur)
    y = filt(y, 'low', 1400) + 0.3 * filt(y, 'bandpass', [60, 160])
    place('bass', t0, norm(y, vel), 1.0, 0.0, room=0.12)


def strings(t0, dur, notes, gain=0.8, attack=0.9, release=1.8, bright=2300, swell_to=1.0):
    """A small string section: five detuned players per note with delayed vibrato."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    a = ramp(t, attack)
    env = a * a * (3 - 2 * a) * np.where(t < dur, 1.0, np.exp(-(t - dur) / (release / 4)))
    env *= np.interp(t, [0, dur], [1.0, swell_to])
    vib_depth = 7 * ramp(t - 0.35, 0.8)                                   # cents, arriving after the attack
    out = np.zeros((n, 2))
    for m in notes:
        f = mtof(m)
        tab = saw_table(f, bright)
        for k in range(5):
            cents = (k - 2) * 4.5 + sound.rng.uniform(-1.5, 1.5)
            rate, ph0 = 4.8 + sound.rng.uniform(-0.5, 0.5), sound.rng.random() * 6.283
            fr = f * 2 ** ((cents + vib_depth * np.sin(2 * np.pi * rate * t + ph0)) / 1200)
            phase = (sound.rng.random() + np.cumsum(fr) / SR) % 1.0
            idx = phase * TN
            i0 = idx.astype(np.int64)
            v = tab[i0] * (1 - (idx - i0)) + tab[(i0 + 1) % TN] * (idx - i0)
            ang = ((k - 2) / 2.4 + 1) * np.pi / 4
            out[:, 0] += v * np.cos(ang)
            out[:, 1] += v * np.sin(ang)
    out = filt(out, 'low', 3600)
    out = out + 0.25 * filt(out, 'bandpass', [700, 1600])             # a little rosin in the mids
    out *= (env * np.sqrt(2) / (len(notes) * 5))[:, None]
    place('pad', t0, out, gain, hall=0.55)


def snap(t0, vel=0.3, pan=0.15):
    t = tt(0.25)
    x = filt(noise(len(t)), 'bandpass', [1400, 4200]) * np.exp(-t / 0.014) * ramp(t, 0.0008)
    x += 0.5 * np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.007)
    place('drums', t0, norm(x, vel), 1.0, pan, room=0.35, hall=0.1)


def shaker(t0, vel=0.12, pan=-0.3):
    t = tt(0.14)
    x = filt(noise(len(t)), 'bandpass', [4500, 10000]) * ramp(t, 0.02) * np.exp(-t / 0.035)
    place('drums', t0, norm(x, vel), 1.0, pan, room=0.1)


def felt_kick(t0, vel=0.5):
    t = tt(0.5)
    f = 46 + 40 * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2) * ramp(t, 0.003)
    place('kick', t0, x * vel, room=0.05)


def celesta(t0, m, vel=0.25, pan=0.0):
    f = mtof(m)
    t = tt(2.2)
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in ((1, 1, 1.1), (3.0, 0.22, 0.35), (4.1, 0.1, 0.18), (0.5, 0.08, 0.6)))
    place('keys', t0, norm(x * ramp(t, 0.002), vel), 1.0, pan, hall=0.5, echo=0.2)


# ---------- arrangement ----------
CHORDS = {  # bass note, string voicing, guitar voicing
    'D': (38, [62, 66, 69, 74], [50, 57, 62, 66, 69]),
    'A/C#': (37, [61, 64, 69, 73], [49, 57, 61, 64, 69]),
    'Bm7': (35, [62, 66, 69, 71], [47, 54, 57, 62, 66]),
    'Gmaj9': (31, [62, 66, 69, 71], [43, 50, 57, 59, 66]),
    'D/F#': (42, [62, 66, 69, 74], [54, 57, 62, 66, 69]),
    'Em9': (40, [59, 62, 66, 67], [52, 55, 59, 62, 66]),
    'A7sus': (33, [62, 64, 67, 69], [45, 52, 55, 62, 64]),
    'Bm9': (35, [61, 62, 66, 69], [47, 54, 61, 62, 66]),
    'Gmaj7#11': (31, [61, 62, 66, 71], [43, 50, 59, 61, 66]),
    'Em/B': (35, [59, 64, 67, 71], [47, 52, 59, 64, 67]),
}
PLAN = (['D', 'Bm7', 'Gmaj9']                               # 0–6 s    lyrics scrolling, piano alone
        + ['A7sus', 'A7sus']                                # 6–10 s   the icon and "0.6"
        + ['D', 'A/C#', 'Bm7', 'Gmaj9'] * 2 + ['D', 'A/C#'] # 10–30 s  lyrics in the file, any player, translation, optional
        + ['Gmaj9', 'D/F#', 'Em9', 'A7sus', 'D', 'A/C#', 'Bm7', 'Gmaj9']  # 30–46 s  how to install
        + ['D', 'Gmaj9', 'D']                               # 46–52 s  end card
        + ['Bm9', 'Gmaj7#11', 'Em/B', 'Bm9'])               # 52–60 s  one more thing
MELODY = {  # beats within the bar, note, length in beats
    'D': [(0.5, 74, 0.5), (1, 76, 0.5), (1.5, 78, 1.5), (3, 76, 1)],
    'A/C#': [(0, 73, 1.5), (1.5, 76, 0.5), (2, 81, 1.5), (3.5, 78, 0.5)],
    'Bm7': [(0, 78, 1), (1, 76, 1), (2, 74, 1.5), (3.5, 73, 0.5)],
    'Gmaj9': [(0, 71, 1), (1, 74, 1), (2, 79, 2)],
}
INTRO = [[(0, 78, 1.5), (1.5, 76, 0.5), (2, 74, 2)], [(0, 74, 1), (1, 76, 1), (2, 78, 1.5), (3.5, 76, 0.5)], [(0, 74, 3), (3, 71, 1)]]
PICKING = [0, 3, 2, 4, 1, 3, 2, 4]  # eighth notes over the guitar voicing, bass string first

for b, name in enumerate(PLAN):
    t0 = b * BAR
    root, voices, frets = CHORDS[name]
    intro, brand, feature, install, end, teaser = b < 3, 3 <= b < 5, 5 <= b < 15, 15 <= b < 23, 23 <= b < 26, b >= 26

    # Piano: alone under the scrolling lyrics, the tune over the features, chords elsewhere.
    if intro:
        for beat, m, length in INTRO[b]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.55, 0.9, 0.1, hall=0.45)
        piano(t0, root + 24, BAR, 0.3, 0.7, -0.2, hall=0.45)
    elif brand:
        for i, m in enumerate(sorted(voices)):
            piano(t0 + i * 0.025, m, BAR, 0.4, 0.7, -0.2 + 0.13 * i, hall=0.4)
    elif (feature or end) and name in MELODY:
        for beat, m, length in MELODY[name]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.6, 0.85, 0.12, hall=0.35)
    elif install:
        for m in sorted(voices)[:3]:
            piano(t0, m, BAR * 0.9, 0.3, 0.55, 0.0, hall=0.4)

    # Strings: a quiet bed that opens up at the reveal and the end card.
    if intro:
        strings(t0, BAR, voices, 0.55, attack=1.2 if b == 0 else 0.5)
    elif brand:
        strings(t0, BAR, voices + [root + 24], 0.7 + 0.25 * (b - 3), attack=0.4, swell_to=1.35)
    elif feature or install:
        strings(t0, BAR, voices, 0.55 if feature else 0.42, attack=0.35)
    elif end:
        strings(t0, BAR if b < 25 else 4.5, voices + [root + 24], 0.85, attack=0.3, release=2.5)

    # Guitar picking and bass under the groove.
    if brand or feature or install or (end and b < 25):
        for i in range(8):
            if brand and b == 3 and i < 4:
                continue
            guitar(t0 + i * BEAT / 2, frets[PICKING[i]], 0.5 if i % 2 else 0.62, [-0.3, 0.25][i % 2])
        upright(t0, root + 12, 0.7, BEAT * 1.8)
        upright(t0 + 2 * BEAT, root + 12 + (7 if name not in ('A7sus',) else 5), 0.55, BEAT * 1.8)
    elif end:
        for i, m in enumerate(frets):                              # the last chord, strummed
            guitar(t0 + i * 0.03, m, 0.55, -0.3 + 0.15 * i)
        upright(t0, root + 12, 0.7, 3.0)

    # Light percussion: felt kick, snaps on two and four, a shaker in eighths.
    if feature or install or (end and b < 25):
        felt_kick(t0, 0.42); felt_kick(t0 + 2 * BEAT, 0.28)
        snap(t0 + BEAT, 0.34); snap(t0 + 3 * BEAT, 0.34, -0.1)
        for s in range(0, 16, 2):
            shaker(t0 + s * STEP, 0.13 if s % 4 else 0.08)

    # One more thing: dark strings, a celesta line and a low piano.
    if teaser:
        strings(t0, BAR, [n - 12 for n in voices] + voices[1:3], 0.34 + 0.08 * (b - 26), attack=0.8 if b == 26 else 0.4, bright=1500)
        upright(t0, root, 0.5, BAR * 0.95)

# ---------- hits and interface sounds, on the video's cues ----------
piano(52.0, 74, 1.6, 0.45, 0.8, 0.0, hall=0.6)                  # 还有一件事。
for i, m in enumerate((90, 85, 86, 81, 90, 93)):               # the green line crosses the screen
    celesta(54.0 + i * 0.22, m, 0.2 + 0.03 * i, -0.5 + 0.2 * i)
for m in (38, 45, 50, 54):                                       # 即将到来。
    piano(57.5, m, 2.4, 0.4, 0.8, 0.0, hall=0.6)
celesta(57.5, 97, 0.18, 0.3)
swell(46.0, 1.2, 0.18)                                           # into the end card
for i, t in enumerate((10.9, 11.4, 11.9, 12.4)):                 # lyric lines fly into the song
    tick(t, (86, 88, 90, 93)[i], 0.12, -0.3 + 0.2 * i)
pop(13.2, 0.16)                                                  # 已写入
pop(24.3, 0.16)                                                  # .lrc
click(27.25, 0.22, 2400)                                         # the lyrics switch
tick(27.35, 93, 0.12)
for i, m in enumerate((81, 83, 86, 88, 90)):                     # client + BetterNCM = plugins
    tick(30.85 + i * 0.2, m, 0.1, -0.4 + 0.2 * i)
tick(32.3, 93, 0.14)
click(35.3, 0.22, 2400); tick(35.6, 90, 0.12); pop(36.1, 0.16)   # 安装, the new button
click(38.52, 0.2, 2400)                                          # 开始使用 BetterNCM
click(38.97, 0.2, 2600)                                          # the magnifier
for i in range(14):                                              # typing BetterDownload
    key(39.2 + i * 0.05, 0.16)
click(40.84, 0.22, 2400); tick(41.4, 93, 0.12)                   # install, installed
click(42.92, 0.22, 2400)                                         # 重启
chime(44.8, (86, 93), 0.2)                                       # the next download is done
for i in range(14):                                              # the end card types the name
    key(48.72 + i * 0.038, 0.18)

sound.finish(OUT, DUR, pump=False)
