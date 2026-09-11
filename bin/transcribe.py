#!/usr/bin/env python
"""Word-level transcription with faster-whisper, GPU when it works, CPU when it
does not. Replaces `hyperframes transcribe` on machines without whisper.cpp.

    .venv/Scripts/python bin/transcribe.py <audio-or-video> --out <dir>
        [--model large-v3] [--language vi|en|auto] [--device auto|cuda|cpu]

Writes into --out:
    transcript.json           flat word array [{text,start,end}] — the shape
                              build-video.mjs and the caption chunker read
    transcript.segments.json  whisper's sentence segments, with words and
                              avg_logprob / no_speech_prob per segment, for the
                              A-roll cleaner (false starts, repeated takes)
    transcript.srt            for a quick read in any player

Timestamps are the source's — never edited here. Correct `text` in
transcript.json by hand afterwards; leave start/end alone.
"""
import argparse, json, os, subprocess, sys, tempfile, time
from pathlib import Path


def expose_nvidia_dlls():
    """The pip CUDA wheels (nvidia-cublas-cu12, nvidia-cudnn-cu12) drop their
    DLLs under site-packages/nvidia/*/bin, where neither PATH nor the Windows
    loader looks. ctranslate2 loads cublas lazily at first encode, so without
    this the model constructs fine on cuda and then dies on transcribe()."""
    if os.name != "nt":
        return
    import site

    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        root = Path(sp) / "nvidia"
        if not root.is_dir():
            continue
        for bin_dir in root.glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


expose_nvidia_dlls()


def to_wav16k(src: Path) -> Path:
    """faster-whisper decodes via PyAV, which handles most containers, but a
    12-minute 4K MP4 is slow to demux repeatedly; a 16 kHz mono WAV is what the
    model wants anyway."""
    if src.suffix.lower() == ".wav":
        return src
    tmp = Path(tempfile.gettempdir()) / (src.stem + ".16k.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(tmp)],
        check=True,
    )
    return tmp


def load_model(name: str, device: str):
    from faster_whisper import WhisperModel

    tries = []
    if device in ("auto", "cuda"):
        tries.append(("cuda", "float16"))
    if device in ("auto", "cpu"):
        tries.append(("cpu", "int8"))
    last = None
    for dev, ct in tries:
        try:
            t0 = time.time()
            m = WhisperModel(name, device=dev, compute_type=ct)
            # Force the first encode here, inside the try: CUDA libraries load
            # lazily, so a cuda model can construct and then fail on use.
            import numpy as np

            m.detect_language(audio=np.zeros(16000, dtype=np.float32))
            print(f"model {name} on {dev}/{ct} ({time.time() - t0:.1f}s)", file=sys.stderr)
            return m, dev
        except Exception as e:  # CUDA libs missing, unsupported arch, etc.
            last = e
            print(f"  {dev}/{ct} failed: {str(e).splitlines()[0][:160]}", file=sys.stderr)
    raise SystemExit(f"could not load model: {last}")


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out", default=".")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--no-vad", action="store_true", help="disable Silero VAD pre-filter")
    ap.add_argument("--prompt", default=None, help="initial prompt: product names, spellings the ASR should prefer")
    a = ap.parse_args()

    src = Path(a.input)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    wav = to_wav16k(src)

    model, dev = load_model(a.model, a.device)
    lang = None if a.language == "auto" else a.language

    t0 = time.time()
    segments_iter, info = model.transcribe(
        str(wav),
        language=lang,
        beam_size=5,
        word_timestamps=True,
        vad_filter=not a.no_vad,
        # Pauses over ~0.7s are real phrase boundaries in a talking head; letting
        # VAD split there keeps segments aligned to what the speaker meant as a
        # sentence, which the cleaner relies on.
        vad_parameters=dict(min_silence_duration_ms=700, speech_pad_ms=200),
        # Repeated takes look like "previous text" to the decoder; conditioning on
        # it makes whisper skip or merge the repeat instead of transcribing both,
        # and the cleaner needs to SEE both to cut one.
        condition_on_previous_text=False,
        initial_prompt=a.prompt,
    )
    print(f"language: {info.language} (p={info.language_probability:.2f})  duration {info.duration:.1f}s", file=sys.stderr)

    words, segs = [], []
    for s in segments_iter:
        seg = {
            "id": s.id,
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": s.text.strip(),
            "avg_logprob": round(s.avg_logprob, 3),
            "no_speech_prob": round(s.no_speech_prob, 3),
            "words": [],
        }
        for w in s.words or []:
            ww = {"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)}
            seg["words"].append(ww)
            words.append({"text": ww["text"], "start": ww["start"], "end": ww["end"]})
        segs.append(seg)
        # progress on stderr so a long file does not look hung
        print(f"\r  {s.end:7.1f}s / {info.duration:.1f}s", end="", file=sys.stderr)
    print(f"\n{len(segs)} segments, {len(words)} words in {time.time() - t0:.0f}s on {dev}", file=sys.stderr)

    (out / "transcript.json").write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf8")
    (out / "transcript.segments.json").write_text(
        json.dumps(
            {"language": info.language, "language_probability": round(info.language_probability, 3),
             "duration": round(info.duration, 3), "model": a.model, "device": dev, "segments": segs},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf8",
    )
    with (out / "transcript.srt").open("w", encoding="utf8") as f:
        for i, s in enumerate(segs, 1):
            f.write(f"{i}\n{srt_time(s['start'])} --> {srt_time(s['end'])}\n{s['text']}\n\n")
    print(f"wrote {out / 'transcript.json'}, .segments.json, .srt", file=sys.stderr)


if __name__ == "__main__":
    main()
