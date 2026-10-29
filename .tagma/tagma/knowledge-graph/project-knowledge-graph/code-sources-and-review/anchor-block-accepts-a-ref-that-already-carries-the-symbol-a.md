---
id: 01a0cb9c-f4da-719d-9adb-8cf84848d6fb
title: anchor_block accepts a ref that already carries the symbol and stores a doubled, unmeasurable source
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "Both calls answered ok and stored sources spelled `packages/llm/src/profiles/claudeCode.ts#PREVIOUS_REQUEST_ID_PLACEHOLDER#PREVIOUS_REQUEST_ID_PLACEHOLDER` and `packages/llm/src/profiles/claudeCodeModels.generated.ts#CLAUDE_CODE_MODELS#CLAUDE_CODE_MODELS` — names no symbol in either file, so nothing can ever measure them. Only the read-back of the block exposed it; each was then unanchored and re-anchored as ref=path + symbol=name (four extra calls, two malformed sources briefly written).",
    "command": "anchor_block {blockId: 0503da07, kind: \"symbol\", ref: \"packages/llm/src/profiles/claudeCode.ts#PREVIOUS_REQUEST_ID_PLACEHOLDER\", symbol: \"PREVIOUS_REQUEST_ID_PLACEHOLDER\"} — and the same shape for claudeCodeModels.generated.ts#CLAUDE_CODE_MODELS",
    "expected": "A refusal naming the argument shape (the ref already names the symbol), or a source stored as `path#Symbol` once. The door's own earlier refusal for the same call with no symbol said: \"spell the source as kind 'symbol' with the symbol set — `path#Symbol` in one spelling\", which invites this exact combination."
  }
---
Filed from project `runlith`.