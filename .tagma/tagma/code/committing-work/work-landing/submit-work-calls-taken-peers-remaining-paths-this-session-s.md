---
id: 01a18a5e-246c-7103-a64b-dce9e6690267
title: submit_work calls taken peers' remaining paths this session's uncommitted lines
ord: 156
tags: ["reflection"]
fields:
  {
    "actual": "The landed 6e028e96dd answer labelled four unrelated taken-peer paths as lines of this session, while read_changes immediately reported this session holds 0 paths.",
    "command": "submit_work({paths:[\"packages/sqlite-process/src/testing/pool.ts\"],taking:[\"reflection-hosts\",\"01a18896-d137-7309-861e-abb3774c3f22\"],tasks:[\"2e269081\"]})",
    "expected": "A narrowed landing reports remaining paths of taken holders without claiming those lines belong to the caller."
  }
---
Filed from project `tagma`.

Current landing/voice.ts:33 renders every SubmitReceipt.left path as 'lines of this session still stand uncommitted'. The submit_work contract includes remaining paths of both the caller and holders named in taking. The four paths were packages/sqlite-process/src/testing/pool.test.ts, packages/testbed/src/cli.ts, scripts/change/check.itest.ts and scripts/change/check.ts; the explicit selected commit contained only testing/pool.ts. Line attribution was preserved: this is misleading result wording, not proof that peer ownership moved.