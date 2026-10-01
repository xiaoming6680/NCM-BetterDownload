"""Synthesizes the soundtrack of the BetterDownload film: an original, royalty-free track.

120 BPM, so a bar lasts two seconds and the scenes in promo/index.html change on bars.
Hits and interface sounds sit on the film's own cue times.

    python promo/music.py [out.wav] [seconds]

music_update.py plays bars of this arrangement, through bar(), for the 0.6 update video.
"""
import sys

from sound import *  # noqa: F401,F403  instruments, BAR/BEAT/STEP and the mix

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


def bar(b, t0=None, hook=HOOK, tune=INTRO_TUNE):
    """Plays bar b of the arrangement at t0, by default where it falls in the film. hook and tune replace the melodies."""
    name = PLAN[b]
    t0, sec = (b * BAR if t0 is None else t0), SECTION[b]
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
        for beat, m, length in tune[b]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.62, 0.9, 0.1)
        piano(t0, root % 12 + 48, BAR, 0.35, 0.7, -0.2)
    elif sec == 'groove' and b >= 7:
        for s in (0, 6):
            for m in sorted(voicing)[1:4]:
                piano(t0 + s * STEP, m, 0.9, 0.38, 0.8, 0.1)
    elif sec in ('feature', 'finale') and name in hook:
        for beat, m, length in hook[name]:
            piano(t0 + beat * BEAT, m, length * BEAT, 0.7, 0.8, 0.15)
    elif sec == 'break':
        tones = sorted(voicing) + [sorted(voicing)[1] + 12]
        for i in range(8):
            piano(t0 + i * BEAT / 2, tones[[0, 2, 4, 5, 3, 4, 2, 1][i] % len(tones)] + 12, BEAT, 0.5, 0.8, [-0.25, 0.25][i % 2])
    elif last:
        for i, m in enumerate(sorted(voicing + [root + 24])):
            piano(t0 + i * 0.03, m + 12, 4.0, 0.55, 0.8, -0.3 + 0.12 * i, hall=0.45)


def cues():
    """Hits and interface sounds, on the film's cues."""
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


if __name__ == '__main__':
    OUT = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
    DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 85.0
    start(DUR)
    for b in range(len(PLAN)):
        bar(b)
    cues()
    finish(OUT, DUR)
