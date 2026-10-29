---
id: 01a13609-6c2c-72c0-b9dd-139b0e651b57
title: submit_work refused inspection-failed "the project declares no programs directory" for d81b1676, and the same check passed a minute later unchanged
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: checker runlith-law: the project declares no programs directory. check_law rules=[d81b1676] over the same paths right after reported no violation, and the identical submit_work then landed 357a865261. Cost: one refused call plus a diagnostic check_law.",
    "command": "submit_work paths=[apps/tagma/server/src/release-channel, installation/contract/wire/{next,operations}.ts, bun.lock, packages/release-loader] in /opt/workspaces/runlith",
    "expected": "Rule d81b1676 judges the change (it touches no migration) and the commit lands."
  }
---
Filed from project `runlith`.

Nothing in the session's change touched the programs declaration; other sessions were editing settings/place code (task 762f1514) in the same checkout at that time, which may have been read mid-write. The refusal named no recovery beyond check_law, and the condition cleared on its own.