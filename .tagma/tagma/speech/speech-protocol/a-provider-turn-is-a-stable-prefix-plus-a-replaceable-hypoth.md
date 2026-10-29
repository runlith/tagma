---
id: 01a106df-ccbf-7d98-b266-0f089a8900c5
title: A provider turn is a stable prefix plus a replaceable hypothesis; only `TurnEnd` and `TurnFailed` close an utterance
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/speech/src/engine/turns.ts
  - kind: file
    ref: packages/speech/src/wire/events.ts
---
The adapter converts any vendor finality shape (by token, segment, turn; delta or cumulative) into one model: `Final` appends units to the turn's prefix and drops the hypothesis, `Partial` replaces the hypothesis whole. There is no `isFinal` flag, because stable text does not mean a finished turn: at Soniox final tokens run until `<end>`, at OpenAI `completed` events for different `item_id`s arrive out of order.

The `Assembler` holds several of the segment's turns open at once under the opaque `turn` key; `seq` comes from the session counter when a turn opens (the first event with a new key; in `client` mode that is `Committed`), so utterance order is turn order, not the order of their endings, and it does not reset between segments. `TurnFailed` closes the utterance and reports a `recognition-failed` gap over the turn's range. A turn with no text yields no utterance but spends its number: gaps in `seq` are legal, repeats are not.

An utterance's time comes from the text units, otherwise from `SpeechStart`/`SpeechEnd`, otherwise from the commit's range (for a clip, from its range). The core itself cuts an utterance at the length limit in any mode, and on speaker change and pauses between words only in `none` mode, including inside a single `Final`. Every cut stands only before a unit starting a word: a token with no leading space continues the word, and punctuation joins the previous one, so an utterance never starts with ", …" or mid-word. A length cut does not wait for words already arrived and seeks a boundary backwards: the last sentence end, otherwise the last mark inside a sentence, otherwise the longest pause between words — among boundaries after which the tail plus the new word fits the limit. The tail leaves into a new utterance with the next `seq`, while the old one is rewritten under its identity; there too an utterance closes when more than the pause plus the provider-latency margin passed after its last word, and in `none` mode with a detector the end of speech sends `finalize`, and `Finalized` closes the current utterances.

A segment closed by other than its own `Finished` (a break, an overflow, the drain deadline) seals its turns: open utterances close with stable text, and late events of that connection open no turns again. Such a forced close counts as no confirmation and does not move the frontier a gap starts from.
