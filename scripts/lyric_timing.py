"""Word-timed transcription of a song with faster-whisper (runs on our server).

Usage: python3 lyric_timing.py <16 kHz mono 16-bit WAV> <prompt file>
(ffmpeg prepares the WAV, so no audio decoder library is needed here.)
Prints a JSON array of {"word", "start", "end"} (seconds) to stdout.
"""
import json
import os
import sys
import wave

import numpy as np

from faster_whisper import WhisperModel

MODEL_DIR = os.environ.get("LYRIC_TIMING_MODEL_DIR", "/opt/whisper/small")


def read_wav(path):
    with wave.open(path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getframerate() != 16000:
            raise SystemExit("expected 16 kHz mono 16-bit WAV")
        pcm = wf.readframes(wf.getnframes())
    return np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0


def main():
    audio = read_wav(sys.argv[1])
    prompt_file = sys.argv[2]
    with open(prompt_file, encoding="utf-8") as fh:
        prompt = fh.read()[:800]
    threads = max(1, min(8, os.cpu_count() or 2))
    model = WhisperModel(MODEL_DIR, device="cpu", compute_type="int8", cpu_threads=threads)
    segments, _ = model.transcribe(
        audio,
        language="en",
        word_timestamps=True,
        initial_prompt=prompt or None,
        beam_size=5,
    )
    words = [
        {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
        for s in segments
        for w in (s.words or [])
    ]
    json.dump(words, sys.stdout)


if __name__ == "__main__":
    main()
