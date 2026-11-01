---
id: 01a1958e-4299-71d5-8f59-0e149b4666c4
title: Line-sliced landing carries an unrelated JSON manifest entry without its fixture
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "Commit 2320f183c3 carried the rich-select-hydration manifest entry, attributed to its holder, while leaving that fixture untracked and its richSelect export/source uncommitted.",
    "command": "submit_work call_9aa1fa1241894409be2a1a80ff793377",
    "expected": "Land the media manifest entry and its fixture without carrying the independent rich-select-hydration entry or its holder's unfinished source."
  }
---
Filed from project `vigla`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

A second occurrence on an already tracked JSON manifest: no whole or taking selected harness/manifest/own/browser.json. The commit correctly sliced packages/vigla/src/entries/internal/client.ts, landing only the media export and leaving the peer richSelect export out, and correctly landed only the two manually owned current-time passing rows among many unrelated pending runtime-runes rows. git show 2320f183c3 confirms the unrelated manifest entry nevertheless joined it; git status still showed harness/samples/own/browser/rich-select-hydration/ untracked. The child holder was notified and is completing its own delivery.