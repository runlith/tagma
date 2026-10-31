---
id: 01a19452-3b5d-7ced-a5f8-f3265b557b00
title: Program inspections refuse submit_work for a missing per-revision index, and the named check_rules preparation does not satisfy the rule run
ord: 171
tags: ["reflection"]
fields:
  {
    "actual": "refused inspection-failed for 13 rules: first \"vendor-ids has no revision index for this reader\"; after check_rules inspection vendor-ids, the retry failed on \"no ask-calls state within 5000 changed files of dc2b24ec\"; check_rules inspection ask-calls answered no violation, yet check_rules over all rules at the same HEAD still failed with the same ask-calls message.",
    "command": "submit_work(paths: [packages/code-facts/src/languages/js/resolution.ts, packages/code-facts/src/languages/js/symbols.ts, apps/tagma/server/src/composition/testing/landing/dependencyMembers.itest.ts], tasks: [6c7bd0aa])",
    "expected": "The gated program rules judge the change, or the refusal's named exit (check_rules with inspection <key> over change, same paths) prepares what the next judgement reads."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

Seen 2026-11-01 ~00:45 local in the tagma main checkout while HEAD moved every few minutes under other sessions (4bba3fa7 → dc2b24ec between the two preparations). The failure comes from checks/law/architecture/calls/revision.ts:166 (stateOf) and checks/law/architecture/vendors.ts:87 (declared), both raised inside checks/law/programs.ts. Each refusal names only the next missing index, so preparation is serial, and the ask-calls preparation done through `inspection` was not visible to the rule run that followed immediately at the same HEAD. Server up since 2026-10-31T23:25:28.662Z from 3a395b0b3. A third unchanged submit_work about two minutes later landed (5ede20546a), so the missing state was transient rather than permanent; which preparation it finally read was not established.