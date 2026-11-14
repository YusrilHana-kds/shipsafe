"""Adds background music + UI sound effects to the silent render.

Run after `node video/render.mjs`:  python3 video/sound.py  ->  public/video/how-it-works.mp4
For a cut (`node video/render.mjs --cut short`):  python3 video/sound.py --cut short  ->  video/out/how-it-works-short.mp4
"""
import json, os, subprocess, sys, tempfile, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FFMPEG = '/opt/homebrew/bin/ffmpeg'
SR = 44100
DUR = 77.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

def t_axis(sec):
    return np.arange(int(SR * sec)) / SR

def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)

def place(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i] * gain

def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


# ---------------- MUSIC ----------------
BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4
CHORDS = [[53, 57, 60, 64], [55, 59, 62, 64], [52, 55, 59, 62], [57, 60, 64, 67]]  # Fmaj7 G6 Em7 Am7

def pad_note(freq, sec):
    tt = t_axis(sec)
    s = sum(np.sin(2 * np.pi * freq * d * tt) for d in (0.997, 1.0, 1.003))
    s += 0.25 * np.sin(2 * np.pi * freq * 2 * tt)
    return s / 3.25 * env_adsr(len(tt), 0.8, 1.2)

def pluck(freq, sec=0.45):
    tt = t_axis(sec)
    return (np.sin(2 * np.pi * freq * tt) + 0.3 * np.sin(2 * np.pi * freq * 2 * tt)) * np.exp(-tt * 9)

def kick():
    tt = t_axis(0.3)
    f = 50 + 70 * np.exp(-tt * 25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 12)

def hat():
    n = rng.standard_normal(int(0.04 * SR))
    return np.diff(n, prepend=0) * np.exp(-np.arange(len(n)) / SR * 90)

def music(arp=(6.2, 71), drums=(12.4, 70)):
    m = np.zeros(N)
    bars = int(np.ceil(DUR / BAR))
    for b in range(bars):
        t0 = b * BAR
        chord = CHORDS[(b // 2) % 4]
        if b % 2 == 0:
            for note in chord:
                place(m, pad_note(midi(note), BAR * 2 + 1.2), t0, 0.10)
        for beat in range(4):
            tb = t0 + beat * BEAT
            if arp[0] < tb < arp[1]:
                if beat in (0, 2):
                    place(m, pluck(midi(chord[0] - 12), 0.9), tb, 0.22)
                for half in (0, 1):
                    note = chord[(beat * 2 + half) % 4] + 12
                    place(m, pluck(midi(note)), tb + half * BEAT / 2, 0.06)
            if drums[0] < tb < drums[1]:
                if beat in (0, 2):
                    place(m, kick(), tb, 0.30)
                place(m, hat(), tb + BEAT / 2, 0.035)
    fade = np.ones(N)
    fi, fo = int(1.5 * SR), int(3 * SR)
    fade[:fi] = np.linspace(0, 1, fi)
    fade[-fo:] = np.linspace(1, 0, fo)
    return m * fade

# ---------------- SOUND EFFECTS ----------------
def click():
    tt = t_axis(0.05)
    return (np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt * 120) + 0.4 * rng.standard_normal(len(tt)) * np.exp(-tt * 400))

def tick():
    a = pluck(midi(84), 0.18); b = pluck(midi(91), 0.25)
    out = np.zeros(int(0.32 * SR)); out[:len(a)] += a; out[int(.06 * SR):int(.06 * SR) + len(b)] += b
    return out

def whoosh(sec=0.6):
    n = int(sec * SR)
    noise = rng.standard_normal(n)
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    spec *= np.exp(-((freqs - 1200) / 900) ** 2)
    s = np.fft.irfft(spec, n)
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return s / (np.abs(s).max() + 1e-9) * e

def alert(low=False):
    f1, f2 = (330, 262) if low else (494, 392)
    a = pluck(f1, .3); b = pluck(f2, .45)
    out = np.zeros(int(.6 * SR)); out[:len(a)] += a; out[int(.14 * SR):int(.14 * SR) + len(b)] += b
    return out

def pop(up=True):
    tt = t_axis(0.12)
    f = (500 + 700 * tt / .12) if up else (900 - 400 * tt / .12)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 30)

def chime():
    out = np.zeros(int(2.2 * SR))
    for k, m in enumerate((72, 76, 79, 84)):
        tt = t_axis(1.6)
        bell = (np.sin(2 * np.pi * midi(m) * tt) + .35 * np.sin(2 * np.pi * midi(m) * 2.76 * tt)) * np.exp(-tt * 3)
        i = int(k * .12 * SR); out[i:i + len(bell)] += bell
    return out

def scan(sec=2.0):
    tt = t_axis(sec)
    f = 300 + 500 * tt / sec
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / sec) ** 2

def sfx(at=lambda t: t, joins=(6.4, 12.4, 24.2, 34.2, 43.0, 51.4, 62.4, 70.4)):
    """`at` maps a source time to output time (None = cut out); `joins` are output times for transitions.
    Times follow walkthrough.html (CLICKS and scene timings)."""
    s = np.zeros(N)
    def put(sig, t, gain):
        o = at(t)
        if o is not None:
            place(s, sig, o, gain)
    for t in joins:
        place(s, whoosh(), t - .25, .18)
    for i in range(5):
        put(tick(), 3.8 + i * .45, .14)                      # journey chips light up
    for t in (10.05, 13.65, 14.9, 15.8, 16.6, 17.6, 18.8, 19.9, 21.55, 26.85, 27.45, 29.95, 35.4, 39.45, 49.45, 53.65, 56.45, 67.45):
        put(click(), t, .22)
    for i in range(4):
        put(pop(), 13.75 + i * .14, .05)                     # typing "1801"
    for i in range(6):
        put(pop(), 35.5 + i * .17, .05)                      # typing "60,000"
    put(tick(), 54.6, .2)                                    # invoice passes
    put(alert(), 57.4, .18)                                  # packing list warning
    put(scan(1.6), 63.2, .07)                                # L/C scan
    for i in range(6):
        put(pop(), 65.0 + i * .18, .06)                      # findings appear
    put(tick(), 67.5, .2)
    put(chime(), 71.4, .22)
    return s

def write_wav(path, mono):
    stereo = np.clip(np.stack([mono, mono], axis=1), -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())

def normalize(x, peak=0.89):
    return x / (np.abs(x).max() + 1e-9) * peak

def mux(video, audio, out):
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], check=True)

def time_map(segments):
    def at(t):
        for g in segments:
            if g['a'] <= t < g['b']:
                return g['o'] + (t - g['a']) / g['sp']
        return None
    return at

if __name__ == '__main__':
    cut = sys.argv[sys.argv.index('--cut') + 1] if '--cut' in sys.argv else None
    out_dir = os.path.join(HERE, 'out')
    if cut:
        segs = json.load(open(os.path.join(out_dir, f'cut-{cut}.json')))
        DUR = segs[-1]['o'] + segs[-1]['d']
        N = int(SR * DUR)
        at = time_map(segs)
        mus = music(arp=(segs[0]['d'] - .2, DUR - 3.5), drums=(segs[2]['o'] - .2, DUR - 4.5))
        fx = sfx(at, joins=[g['o'] for g in segs[1:]])
        silent, target = os.path.join(out_dir, f'how-it-works-{cut}-silent.mp4'), os.path.join(out_dir, f'how-it-works-{cut}.mp4')
    else:
        mus, fx = music(), sfx()
        lang = sys.argv[sys.argv.index('--lang') + 1] if '--lang' in sys.argv else None
        suf = f'-{lang}' if lang else ''
        silent, target = os.path.join(out_dir, f'how-it-works{suf}-silent.mp4'), os.path.join(ROOT, 'public', 'video', f'how-it-works{suf}.mp4')
    with tempfile.TemporaryDirectory() as tmp:
        mix = normalize(0.75 * mus / (np.abs(mus).max() + 1e-9) + 0.9 * fx)
        audio = os.path.join(tmp, 'mix.wav')
        write_wav(audio, mix)
        mux(silent, audio, target)
    print('wrote', os.path.relpath(target, ROOT))
