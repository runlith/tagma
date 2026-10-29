---
id: 01a14c37-8e13-710f-953a-8a2a61b3a58c
title: Fix the texts and junk of the "Models and providers" area
ord: 21
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
- The `read_provider_token` operation by name reads but in fact saves the credential sent: rename or fix the description.
- Card 249ce587 names a nonexistent `src/oauth/cliLogins.ts`.
- The "What is there now" section of spec 52b10a62 describes a departed state.
- Task 09f9a92a is mostly done: `remove_account` leaving a default account remains, plus refusal of rename and default choice at a deleted provider — narrow it to the remainder.
- Delete the stray `apps/tagma/server/src/providers/registry.ts.bak`.
