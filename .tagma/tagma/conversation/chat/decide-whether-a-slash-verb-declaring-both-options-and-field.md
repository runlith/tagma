---
id: 01a0cac4-46e3-7177-8f8d-fa3ea14d47b4
title: Decide whether a slash verb declaring both options and fields is intended or refused
ord: 76
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
A verb declaring both options and fields renders the form, but Enter in the draft field answers the options and bypasses the form (packages/chat-ui/src/ComposerMenu.svelte.ts pick() reads options only). bb560eb2 is phrased to hold either way. Decide whether a mixed verb is intended (both roads legitimate) or refused (a verb declares options or fields, never both), and either constrain the shape or claim the bypass.