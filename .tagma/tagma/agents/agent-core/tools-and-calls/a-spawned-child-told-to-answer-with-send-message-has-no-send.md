---
id: 01a0daa2-c2b5-7c64-b53a-3f716bf0eb64
title: "A spawned child told to answer with send_message has no send_message: tool_search answers it missing, while siblings from the same spawn have it"
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "tool_search answered missing: [send_message] and later [send_message, send_task]; both runs ended without a final answer, and the child had to put a permission request into its last message",
    "command": "child regress-12-promo (thread 01a0d9e5-8f70-7797-a0d6-4f7255e5d2f4, muse-spark-1.3-contributor max): tool_search select:send_message and select:send_message,send_task",
    "expected": "send_message and send_task are in the child tool set, as its birth notice promises and as its siblings from the same parent have"
  }
---
Filed from outside every registered project.

A spawned child was told by its birth notice to send its final answer with `send_message final: true`, but `send_message` and `send_task` were not in its tool set: `tool_search` answered them as `missing`. A sibling spawned by the same parent, on the same model, with the same kind of task, had `send_message` and used it.

## Evidence (another project, 2026-09-25)

- Child `regress-12-promo`, thread `01a0d9e5-8f70-7797-a0d6-4f7255e5d2f4`, agent `tagma`, `muse-spark-1.3-contributor`, reasoning `max`, parent `01a0d552-21bb-772b-bc23-f22b95ec5951`.
- Log position 746: `tool_search {"query":"select:send_message"}` → `{"status":"revealed","tools":[],"missing":["send_message"]}`.
- Log position 4689 (second run, `01a0da4c-3c5d-79f3-b072-1267a9122c65`): `tool_search {"query":"select:send_message,send_task"}` → `missing: ["send_message","send_task"]`.
- The child's whole tool use: bash 583, write 143, edit 32, read 5, tool_search 4, load_skill 1 — no collaboration tool at all.
- Sibling `regress-14-texts` (thread `01a0d9ea-633c-73bc-87e4-8e1530bd5bf6`), same parent, spawned 5 minutes later with the same model and reasoning, called `send_message` and delivered its final answer. Siblings `regress-02`, `-04`, `-05`, `-06`, `-07`, `-08`, `-09`, `-10`, `-11`, `-13`, `-15`, `-16` did the same.

## Cost

- Both runs of the child ended without a final answer; the parent received "ended the run … without sending you its final answer" twice and had to read the last message to judge the work.
- The child needed the lead's permission to toggle backend feature flags; with no way to ask mid-run it put the request into its last message, ended the run, and the lead had to answer with a fresh `send_task` — one extra round trip and a stopped child.
- The child spent several tool calls searching for the missing tool (`tool_search` ×4).

## Why it is Tagma's

The birth notice promises a door the child's tool set does not carry. Either the child's capability set was composed differently from its siblings' (same agent definition, same parent, same spawn call shape), or the deferred-tool catalogue omitted the collaboration tools for this thread. Nothing in the spawn answer or the child's startup said its collaboration tools were absent.

## What should hold

Every child told to answer with `send_message` has `send_message` (and the parent-facing collaboration doors) in its tool set for every run; if a child's composition lacks them, the spawn refuses or the birth notice says so, and `tool_search` never answers a promised door as `missing`.