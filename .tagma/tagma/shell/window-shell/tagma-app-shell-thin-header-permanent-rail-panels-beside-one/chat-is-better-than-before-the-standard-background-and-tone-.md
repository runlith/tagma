---
id: 01a1090a-24cb-7b39-b073-1ace1834d610
title: "Chat is better than before the standard: background and tone, feed, composer, empty screen, thread header"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1090a-a278-79a2-84ca-4786fa5fbaaa",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10891-853e-7f52-89f5-9e2869cfbc5c
  - kind: implements
    to: 01a10891-853e-7f52-89f5-9e27cfd75516
---
Operator, 2026-10-04: after the move to tokens the chat and composer got worse than they were. The composer mechanically received the container radius 10 px and the light `raised` fill instead of a soft large rounding and a dark framed field. The background turned greyer. The empty screen is still a huge definition-phrase. Needed: a chat plainly better than the old one, not just different; the operator judges.

Where: `packages/chat-ui/src` (Composer, ChatSurface, ChatTranscript, feed entries), the app chat section (`routes/[project]/chat`, `lib/features/threads/native/Conversation.svelte`, `Header.svelte`), tones in `apps/tagma/app/src/app.css`.

The design standard (rule [[55b5437b]]) is mandatory. Where good design needs a token that is missing (e.g. a separate radius for a large input field), it is added to the standard openly: the token, the check parameters and the rule body, with a reason.

Done when the before-token-migration, now and after snapshots stand side by side in both themes, and the operator has looked at them.
