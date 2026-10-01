"""Synthesizes the soundtrack of the 0.6 update video: a variation on the film's, in the same sounds.

It plays the film's own bars (promo/music.py, through music.bar()) in the film's order: its intro, build, groove, the
end of its breakdown, its build and its install groove, with one phrase of that groove played twice and the rest of
the film's feature section left out. The variation is in the melodies: the intro tune follows the lyric lines, the
groove from 20 s carries a new hook, and the film's own hook comes back on the end card. The music ends there; after
a second of silence the teaser has only a few soft sounds of its own, so it arrives unannounced.
120 BPM, so a bar lasts two seconds; the scenes of promo/index.html?update change on bars and their animations land on
beats, each with a sound.

    python promo/music_update.py [out.wav] [seconds]
"""
import sys

import numpy as np

import music
import sound
from sound import *  # noqa: F401,F403  instruments, BAR/BEAT/STEP and the mix

OUT = sys.argv[1] if len(sys.argv) > 1 else 'music-update.wav'
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 78.0
start(DUR, seed=20260930)

# ---------- the film's bars, and the variation ----------
BARS = (list(range(0, 10))        # 0–20 s   intro (lyrics, then 现在，歌词也能一起带走), build (the icon), groove (lines land)
        + list(range(14, 18))     # 20–28 s  the film's hook section, with the new hook: any player; translation
        + [26, 27]                # 28–32 s  the second half of its breakdown: 想要，就打开
        + [28, 29]                # 32–36 s  its build; the switch is clicked at 34
        + list(range(30, 38))     # 36–52 s  its install groove: what BetterNCM is, step 1, step 2
        + list(range(34, 38))     # 52–60 s  the groove's last phrase again: steps 2 and 3
        + [38, 39, 40])           # 60–69 s  its end card: the film's hook and the last chord
TUNE = [  # the intro tune, its first two bars moved onto the lyric lines at 0, 1, 2 and 3 s
    [(0, 78, 2), (2, 76, 2)],
    [(0, 74, 2), (2, 71, 1), (3, 74, 1)],
    music.INTRO_TUNE[2],
    music.INTRO_TUNE[3],
]
HOOK2 = {  # the new hook over the film's groove: it starts high and climbs again at the end of the phrase
    'D': [(0, 81, 1), (1, 78, 0.5), (1.5, 76, 0.5), (2, 78, 2)],
    'A/C#': [(0, 76, 1.5), (1.5, 73, 0.5), (2, 76, 1), (3, 81, 1)],
    'Bm7': [(0, 78, 1.5), (1.5, 76, 0.5), (2, 74, 1), (3, 73, 1)],
    'Gmaj9': [(0, 74, 1), (1, 76, 1), (2, 78, 2)],
}
for i, b in enumerate(BARS):
    music.bar(b, i * BAR, hook=HOOK2 if b < 24 else music.HOOK, tune=TUNE)

# ---------- hits and interface sounds, on the update's cues (the film's sounds for the same kinds of moment) ----------
whoosh(3.9, 1.2, 0.14, 200, 900, 0, 0)                    # 现在，歌词也能一起带走
tick(8.5, 81, 0.18)                                       # the arrow drops in
click(9.5, 0.35, 3400)                                    # the lock springs open
click(9.54, 0.25, 1800)
pop(10.0, 0.22)                                           # 0.6 新增：写入歌词
riser(8.6, 3.4, 0.45)
impact(12.0, 1.0)                                         # 歌词，写进文件里
for i, m in enumerate((81, 83, 86, 88)):                  # each line lands in the song
    tick(13.0 + i, m, 0.2, -0.3 + 0.2 * i)
chime(17.0, (86, 93), 0.28)                               # 歌词已写入
swell(20.0, 0.6, 0.18)                                    # 换个播放器，照样滚动
swell(24.0, 0.6, 0.18)                                    # 外语歌，附带翻译
tick(26.0, 88, 0.16)                                      # .flac
pop(26.5, 0.22)                                           # .lrc
swoosh_down(27.4, 0.6, 0.2)                               # into the breakdown: 想要，就打开
click(34.0, 0.3, 2400)                                    # the switch
tick(34.3, 93, 0.16)
riser(34.0, 2.0, 0.35)
crash(36.0, 0.35)                                         # 它是一个 BetterNCM 插件
for i, m in enumerate((81, 83, 86, 88, 90)):              # client + BetterNCM = plugins
    tick(37.0 + i * 0.25, m, 0.16, -0.4 + 0.2 * i)
tick(38.5, 93, 0.2)                                       # BetterDownload lights up
swell(40.0, 0.6, 0.2)                                     # 第 1 步
click(41.5, 0.3, 2400)                                    # 安装
tick(41.75, 90, 0.16)
pop(43.0, 0.22)                                           # the BetterNCM button appears
swell(46.0, 0.6, 0.2)                                     # 第 2 步
click(47.0, 0.28, 2400)                                   # 开始使用 BetterNCM
click(48.0, 0.28, 2600)                                   # the magnifier
for i in range(14):                                       # searching for BetterDownload
    key(48.28 + i * 0.0694, 0.24)
whoosh(48.62, 0.5, 0.1, 900, 2600, 0.3, -0.3)             # the card moves to the front
click(52.0, 0.3, 2400)                                    # install
tick(52.5, 93, 0.18)                                      # installed
whoosh(54.5, 0.45, 0.12, 700, 2200, 0, 0)                 # 插件的更改需要重启以生效
click(56.0, 0.3, 2400)                                    # 重启
swoosh_down(56.1, 0.45, 0.18)
whoosh(56.5, 0.42, 0.18, 900, 3200, 0.8, 0.2)             # the next download
chime(58.0, (86, 93), 0.3)                                # converted
swell(60.0, 0.8, 0.25)                                    # the end card, as in the film
impact(60.0, 0.8)
tick(61.0, 93, 0.12)
for i in range(14):                                       # typing BetterDownload
    key(63.95 + i * 0.055, 0.28)
crash(64.0, 0.22, 4.0)


def fade_out(a, b, sends_early=0.6):
    """Fades everything placed so far out from a to b and silences it from then on, so no tail of the music reaches the
    teaser. The reverb sends fade a little earlier, so the reverbs have died away by the time the teaser starts."""
    for bufs, lead in ((sound.BUS, 0.0), (sound.SEND, sends_early)):
        i, j = int((a - lead) * SR), int((b - lead) * SR)
        g = np.ones(sound.N, np.float32)
        g[i:j] = np.linspace(1, 0, j - i) ** 2
        g[j:] = 0.0
        for x in bufs.values():
            x *= g[:, None]


# The music ends with the end card: its last chord fades by 69.2 s and nothing of it plays after that.
fade_out(67.6, 69.2)


# ---------- 70–78 s: one more thing, with a few soft sounds of its own ----------
def light_run(t0, seconds=1.5, vel=0.1):
    """A glassy shimmer that follows the light round the icon's edge, panned to where the light is."""
    t = tt(seconds + 0.6)
    x = sum(a * np.sin(2 * np.pi * f * t + sound.rng.random() * 6.283) for f, a in ((1175, 1), (1760, 0.6), (2349, 0.45), (3520, 0.25)))
    x = x * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * t)) * ramp(t, 0.3) * np.exp(-np.maximum(0, t - seconds) / 0.25)
    u = np.clip(t / seconds, 0, 1)
    p = np.where(u < 0.5, 2 * u * u, 1 - 2 * (1 - u) ** 2)             # the light's ease
    ang = (0.7 * np.sin(2 * np.pi * p) + 1) * np.pi / 4
    place('sfx', t0, norm(np.stack([x * np.cos(ang), x * np.sin(ang)], 1), vel), hall=0.5)


def boom(t0, vel=0.35):
    """A soft low bloom, with its octave so a phone can play it."""
    t = tt(2.0)
    ph = 2 * np.pi * np.cumsum(48 + 30 * np.exp(-t / 0.15)) / SR
    x = (np.sin(ph) * np.exp(-t / 0.6) + 0.3 * np.sin(2 * ph) * np.exp(-t / 0.3)) * ramp(t, 0.01)
    place('sfx', t0, x * vel, hall=0.3)


whoosh(69.9, 1.2, 0.1, 250, 700, 0, 0)                   # 还有一件事: only a breath under it
light_run(72.0, vel=0.32)                                 # the light runs round the edge
whoosh(72.0, 1.5, 0.1, 3500, 9000, 0.0, 0.0)
swell(74.0, 0.8, 0.2)                                     # the glow blooms
boom(74.0, 0.35)
pad(74.0, 2.6, [62, 66, 69, 73, 76], 0.5, 1500, attack=0.25, release=1.4)
whoosh(74.5, 1.1, 0.08, 2500, 9000, -0.5, 0.5)            # the sheen
tick(75.05, 93, 0.12)
chime(76.0, (86, 93), 0.2)                                # 即将到来
boom(76.0, 0.3)

finish(OUT, DUR)
