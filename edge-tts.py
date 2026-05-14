#!/usr/bin/env python3
"""Edge-TTS worker process - receives text via stdin, outputs audio via stdout."""
import asyncio
import sys
import json
import os
import uuid
import re

EDGE_VOICE_MAP = {
    # American female
    "af_heart": "en-US-AvaNeural",
    "af_alloy": "en-US-AnaNeural",
    "af_aoede": "en-US-AriaNeural",
    "af_bella": "en-US-JennyNeural",
    "af_jessica": "en-US-JennyNeural",
    "af_kore": "en-US-AriaNeural",
    "af_nicole": "en-US-AnaNeural",
    "af_nova": "en-US-AvaNeural",
    "af_river": "en-US-AriaNeural",
    "af_sarah": "en-US-EmmaNeural",
    "af_sky": "en-US-AnaNeural",
    # American male
    "am_adam": "en-US-GuyNeural",
    "am_echo": "en-US-DavisNeural",
    "am_eric": "en-US-GuyNeural",
    "am_fenrir": "en-US-DavisNeural",
    "am_liam": "en-US-GuyNeural",
    "am_michael": "en-US-DavisNeural",
    "am_onyx": "en-US-GuyNeural",
    "am_puck": "en-US-DavisNeural",
    "am_santa": "en-US-GuyNeural",
    # British female
    "bf_alice": "en-GB-SoniaNeural",
    "bf_emma": "en-GB-SoniaNeural",
    "bf_isabella": "en-GB-LibbyNeural",
    "bf_lily": "en-GB-SoniaNeural",
    # British male
    "bm_daniel": "en-GB-RyanNeural",
    "bm_fable": "en-GB-RyanNeural",
    "bm_george": "en-GB-RyanNeural",
    "bm_lewis": "en-GB-RyanNeural",
}

MAX_CHARS = 50000
SAFE_TTS_CHARS = 3000  # Auto-summarize if text exceeds this


def summarize_text_for_tts(text, max_chars=SAFE_TTS_CHARS):
    """
    Intelligently shorten text for TTS by keeping the first complete sentences
    that fit within max_chars. Adds a truncation notice.
    """
    if len(text) <= max_chars:
        return text
    
    # Split by sentence endings
    sentences = re.split(r"(?<=[.!?])\s+", text)
    result = []
    current_len = 0
    for s in sentences:
        add_len = len(s) + (1 if result else 0)
        if current_len + add_len <= max_chars - 50:  # leave room for notice
            result.append(s)
            current_len += add_len
        else:
            break
    
    summary = " ".join(result)
    # Strip markdown artifacts for cleaner TTS
    summary = re.sub(r"[#*_`\-\[\]\(\)\|>]+", " ", summary)
    summary = re.sub(r"\s+", " ", summary).strip()
    summary += " ... Text was too long and has been shortened for audio."
    return summary


def map_voice(voice_id):
    return EDGE_VOICE_MAP.get(voice_id, voice_id)


async def synthesize_chunk(text, voice, rate_str, out_path):
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, rate=rate_str)
    await communicate.save(out_path)


async def process_request(req):
    req_id = req.get("id")
    text = req.get("text", "")
    voice_id = req.get("voice", "af_heart")
    speed = req.get("speed", 1.0)
    output_path = req.get("output")

    if not text or not text.strip():
        return {"id": req_id, "error": "empty text"}

    # Remove surrogate Unicode characters that crash Edge-TTS
    # Surrogates are in range U+D800 to U+DFFF and cannot be encoded to UTF-8
    text = ''.join(ch for ch in text if not (0xD800 <= ord(ch) <= 0xDFFF))

    try:
        voice = map_voice(voice_id)

        # Build rate string for Edge-TTS
        pct = int((speed - 1.0) * 100)
        if pct >= 0:
            rate_str = f"+{pct}%"
        else:
            rate_str = f"-{abs(pct)}%"

        if output_path:
            out_path = output_path
        else:
            out_id = str(uuid.uuid4())
            out_path = f"./tts/{out_id}.mp3"

        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

        # Auto-shorten long text for TTS reliability
        original_len = len(text)
        text = summarize_text_for_tts(text, SAFE_TTS_CHARS)
        if original_len != len(text):
            print(f"[INFO] Text shortened from {original_len} to {len(text)} chars for TTS.", file=sys.stderr)

        if len(text) <= MAX_CHARS:
            await synthesize_chunk(text, voice, rate_str, out_path)
        else:
            # If still too long after summarization, chunk by sentences
            sentences = re.split(r"(?<=[.!?])\s+", text)
            chunks = []
            current = ""
            for s in sentences:
                if len(current) + len(s) + 1 <= MAX_CHARS:
                    current += (" " + s if current else s)
                else:
                    if current:
                        chunks.append(current)
                    current = s
            if current:
                chunks.append(current)

            try:
                from pydub import AudioSegment
                combined = AudioSegment.empty()
                for i, chunk in enumerate(chunks):
                    chunk_path = f"./tts/{uuid.uuid4()}_chunk_{i}.mp3"
                    await synthesize_chunk(chunk, voice, rate_str, chunk_path)
                    combined += AudioSegment.from_mp3(chunk_path)
                    try:
                        os.remove(chunk_path)
                    except Exception:
                        pass
                combined.export(out_path, format="mp3")
            except ImportError:
                # pydub not available. If text is too long (exceeds MAX_CHARS),
                # we must truncate to avoid Edge-TTS failures.
                if len(text) > MAX_CHARS:
                    # Truncate to a safe limit, leaving room for any Edge-TTS internal constraints
                    truncate_limit = MAX_CHARS - 1000
                    truncated = text[:truncate_limit] + "... (truncated for audio)"
                    # Log warning to stderr (won't interfere with JSON output)
                    print(f"[WARNING] Text length {len(text)} exceeds {MAX_CHARS} and pydub is not available. Truncating to {truncate_limit} characters.", file=sys.stderr)
                    await synthesize_chunk(truncated, voice, rate_str, out_path)
                else:
                    await synthesize_chunk(text, voice, rate_str, out_path)

        estimated_duration = len(text) / (13 * speed)
        return {
            "id": req_id,
            "success": True,
            "audioUrl": out_path.replace("\\", "/"),
            "duration": estimated_duration,
            "backend": "edge-tts",
        }
    except Exception as e:
        return {"id": req_id, "error": str(e)}


async def main():
    print(json.dumps({"status": "ready", "backend": "edge-tts"}))
    sys.stdout.flush()

    for line in sys.stdin:
        try:
            msg = json.loads(line)
            if msg.get("action") == "voices":
                voices = [
                    {"id": k, "name": k.replace("_", " ").title(), "lang": "en", "gender": "female" if k.startswith("af") or k.startswith("bf") else "male"}
                    for k in EDGE_VOICE_MAP.keys()
                ]
                print(json.dumps({"voices": voices, "backend": "edge-tts"}))
                sys.stdout.flush()
                continue

            result = await process_request(msg)
            print(json.dumps(result))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())