---
id: 01a106dc-88ad-7fae-8672-342df822adad
title: "Recognition first checks the clip via Silero: a speechless clip answers with an empty result and never reaches Whisper"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech-whisper/native/src/recognizer.cpp
---
Whisper invents text on silence: on a second of zeros the tiny model answered " You", and the `no_speech_thold` threshold did not filter that segment (smoke measurement, one sample). The Silero check makes empty text on silence a legitimate outcome, and the language in such an answer is `null` because no detection happened; only a detection failure on speech becomes a "language undefined" refusal.

The check answers only the question "is there speech": speech is at least one window with probability 0.5 or above. Default Silero segments don't fit this: their 250 ms minimum would drop short speech, and duration policy belongs to the core `Segmenter`. A cancelled clip is checked after this check too.

Without a given language, Whisper detects the language and recognizes the same clip whole (`language = "auto"`, `detect_language = false`); the "detect only" mode is not used.
