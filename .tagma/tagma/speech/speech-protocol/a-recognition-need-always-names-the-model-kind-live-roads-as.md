---
id: 01a13818-1459-7d90-bf1c-87f042cba28f
title: "A recognition need always names the model kind: live roads ask for `stream | batch`, recordings for `file | batch`, so a file model never becomes a live-choice candidate"
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/choose.ts
  - kind: file
    ref: packages/speech/src/wire/requests.ts
---
Previously the model kind was checked only when the need named it, and live callers never named it: a file model declared by an adapter would become a candidate for listenings, dictation, the probe run and continuation after handover — a model that cannot hear a stream. So `RecognitionNeed.kinds` is required, and callers take one of two sets: `LIVE` (`stream | batch`) or `RECORDED` (`file | batch`). The default recognizer-choice lists take only live models (`live`) from the catalog.

A file model has a single turn mode — `none`: the core itself cuts utterances (`Assembler` by speaker change, pause and length), so `offeredTurns` answers `none`, and its status carries no turns or handles.
