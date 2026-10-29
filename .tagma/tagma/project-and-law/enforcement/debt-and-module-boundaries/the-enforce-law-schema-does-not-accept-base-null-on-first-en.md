---
id: 01a13f2f-6f03-725c-bc30-ae5161e832ec
title: The enforce_law schema does not accept base null on first enablement
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "The native schema requires a string. The string \"null\" got enforcement-stale: revision none; unblock requires base null. A CLI call is needed for correct JSON.",
    "command": "enforce_law({ blockId: \"673f881b\", base: \"null\", strictness: \"gate\", inspection: { bindings: [{ runner: \"runlith-law\", id: \"effect-style\", params: { forms: [\"clock-bypass\"] } }] } })",
    "expected": "First enablement accepts JSON null as base; the native schema offers string | null."
  }
---
Filed from project `runlith`.
