"""Regenerate original test audio. Requires numpy, soundfile, Pillow and ffmpeg (FFMPEG or PATH); not needed for tests."""
import os
import shutil
import subprocess
from pathlib import Path
import numpy as np
import soundfile as sf
from PIL import Image

root = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
root.mkdir(parents=True, exist_ok=True)
t = np.arange(44100) / 44100
audio = np.stack([0.25 * np.sin(2 * np.pi * 440 * t), 0.2 * np.sin(2 * np.pi * 660 * t)], axis=1)
sf.write(root / "tone.flac", audio, 44100, subtype="PCM_16")
sf.write(root / "tone.mp3", audio, 44100, format="MP3", subtype="MPEG_LAYER_III")
# AAC in MP4 with moov first, laid out like NetEase's 臻音全景声 downloads.
ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(root / "tone.flac"), "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                str(root / "tone.m4a")], check=True)
Image.new("RGB", (24, 24), (92, 118, 104)).save(root / "cover.png")
