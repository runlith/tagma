---
id: 01a146ca-49a1-756b-8020-330d35c0e724
title: "A refused call in the feed is a red collapsed row: it never expands itself and never counts into the group's failure count"
ord: 48
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
  - kind: symbol
    ref: packages/chat-ui/src/activity.ts
    symbol: toolOpensByDefault
  - kind: symbol
    ref: packages/chat-ui/src/activity.ts
    symbol: toolRefusalWord
---
A refusal (`output-refused`) is addressed to the agent: it reads the code, reason and `unblock` and changes approach on the next step. So the feed neither expands it itself nor mixes it into the failure count:
- the refusal step never expands itself. `display.opens` does not apply to it: in entries kept before this decision, every graph-operation refusal carries `opens: true`;
- the row is red like a failure (`chat-refused` token), but the step-group header never counts refusals. Otherwise `bash` with a non-zero code (`grep` with no matches, a failed test) would raise "N failed" over normal work;
- the status after the row is the refusal producer's phrase from the entry (`toolRefusal.words`); the app never assembles it from the code. An entry with no phrase (kept before it) shows the generic "Refused". When the producer's fact already names the code or phrase as label or value, there is no status;
- an expanded refusal's reason is shown by the product renderer, when it takes on that step (the tool's `renders` did not refuse it), otherwise by the kit.

Default expansion stays with run failure (`toolError`).
