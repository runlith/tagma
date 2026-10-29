---
id: 01a16ec6-1438-7cae-bd2c-33f17eff1d60
title: "A fork of a loaded thread misses the source's prompt cache past the system prompt: history is rewritten into the cache anew"
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The fork read 55,674 from cache and wrote 28,783 (the whole copied history with the read files); the same question to the source itself read 83,916 and wrote 683",
    "command": "spawn_agent forkFrom=cache-base (01a16ec4-13e9-7a10-988a-0d8f3aa94f55) fork=all, the same claude-haiku-5-5 low and account, 15 s after the source's last call",
    "expected": "The fork's first call reads the source's whole prefix from cache (~84k), as a continuation of the source itself: the fork inherits cacheGroup, systemPrompt, model, and account for a shared cache"
  }
---
Filed from project `runlith`.

Measurements (measurement records, 2026-10-24):
- source, step 0: in 60 117, read 0, write 60 115;
- source, step 1: in 83 918, read 60 115, write 23 801;
- fork, first call (at 27): in 84 459, read 55 674, write 28 783;
- source, the same question via send_task (at 27): in 84 601, read 83 916, write 683.

The fork and the source share the same `promptDigest` (88e901b5…) and all 27 `toolDigests`, and the fork's history entries are inherited copies of the source's entries 1–21 in the same order. So the system prompt and tools match, and the divergence starts in the messages. The fork did not even reach 60 115 — the source's first cache point — so the first message after the system prompt and tools (~55.7k) already diverged.

Hypothesis, unverified: when assembling the fork's request, the first message (the task signal or the workspace context) is rendered for the new thread — its name, id, or scratch — rather than taken byte-for-byte from the copied entry.

Consequence: "load the specialist once and fork per question" saves nothing on Anthropic — each fork rewrites everything loaded into the cache.
