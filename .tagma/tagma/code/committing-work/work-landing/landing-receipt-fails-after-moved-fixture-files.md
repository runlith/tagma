---
id: 01a195a6-d838-7b18-8d95-36920405a8c7
title: Landing receipt fails after moved fixture files
ord: 186
tags: ["reflection"]
fields:
  {
    "actual": "Commit 6d43154941 landed, but the tool reported that its landing receipt could not be written and could not judge two former fixture paths until the next boot.",
    "command": "submit_work(subject=\"fix(dom): measure outgoing rows before pinning\", paths=[\"packages/vigla/src/runtime/dom/list.ts\",\"harness/manifest/own/browser.json\",\"harness/samples/own/browser/issue-10252-initial-flip\",\"targets/vigla/passing/own/browser.txt\",\"targets/vigla/passing/svelte/runtime-runes.txt\"])",
    "expected": "The commit lands and its receipt judges the old and new fixture paths."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.