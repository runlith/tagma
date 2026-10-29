---
id: 01a140eb-0a34-75f6-93a0-7beb49ca1849
title: A terminal CLI receives footnotes in one guide_harness response on the prompt-submit hook — only after its envelope is probed
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adapter/hookFormat.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
---
A terminal CLI (Claude Code, Codex, Devin, Cursor, and others) assembles the model request itself; a footnote reaches it through the `RunGuidance` `hook` channel on the prompt-submit hook Tagma already installs for every CLI (`UserPromptSubmit`; for Cursor, `beforeSubmitPrompt`).

## What stands today

- On the prompt-submit hook, dispatch already answers with orientation: `orientPrompt` (`external-harnesses/hooks/dispatch.ts:235,239-282`).
- A model-text response is allowed only for Cursor: `promptSupported` (`adapter/hookFormat.ts:93-98`) is deliberately limited to it — other CLIs' response form is unmeasured, and printing into an unmeasured envelope is guessing (commit `0bc1b847a9`).
- All of one hook's calls to the server share the `HOOK_ROAD_BUDGET_MS` = 500 ms budget (`hooks/delivery.ts:108-159`); the first cold delivery measured 736 ms — defect [[e057eae7]].

## Decision

- **One call, one response.** On the prompt-submit hook, dispatch makes one `guide_harness` call with the new `prompt` kind (`external-harnesses/contract/wire/hooks.ts:97`): the server answers orientation and the footnote tail in one text, `RunGuidance.hook` writes a `runtime-guidance` frame, a repeat on the same event answers the same text. No second JSON on the hook's stdout: the orientation-and-footnotes response is one adapter-form document.
- **Only measured CLIs.** Footnotes go to CLIs whose prompt-submit hook response is measured: `promptSupported` extends to one after probing. A probe per CLI is `#research`, as it was for Cursor: whether it accepts text, where it places it relative to the operator's words, whether it keeps it in its history. Where a CLI places text before the words, the vendor decides the order, and the probe records it; the single "after the words" semantics holds on this road only where the vendor allows it.
- **Budget.** Footnotes come from the owner's memory ([[f4702e26]]), but that does not remove the cold-first-hook price: until [[e057eae7]] is fixed, a session's first prompt may leave without a footnote. The hook does not hold the prompt: missed the budget — the prompt leaves without it.
- An adapter with no measured response gets no footnotes, and the thread's `read_operator_notes` says so.

## What shows it works

- Performer: a research probe of each CLI getting footnotes; a hook system test — prompt-kind `guide_harness` answers with one orientation-and-footnote document, a repeat on the same event with the same text, the thread journal carries one frame; a CLI with no measured response prints nothing.
- Operator: in terminal Claude Code their message leaves with the footnote — visible in the vendor transcript. This is not a completion condition.
