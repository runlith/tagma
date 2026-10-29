---
id: 01a172fb-3dc5-7b11-9d21-eb2f5212221e
title: Check the lost landed commit in read_changes under format and an open command
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172fa-4013-7347-9163-c51a14fbefb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e30-3d13-7864-94ce-e633a29b1817
---
Check the lost landed commit in read_changes under format and an open command.

A temporary projection defect is confirmed: the public read_changes contract promises a known landing, but commits and turns only read the durable stamp and hid the committed proof under an open command of the same holder. The original 03a2cbe73e was never permanently lost; the old-build hypothesis is unproven. The fix is a single known line outcome at change-record for commits and turns, with holder, digest and proof-reachability checks from the read HEAD. One KnownOutcomes snapshot feeds both projections; an unreadable checkout stays stale, and a history without such a side answers record-unread. The open commandWindow guard and the actual Holdings holding stay independent. Fixed in f68589d480: pending proof notifies the open feed; SQL joins proof lines with verified commit keys over the checkout/commit index, without serializing all lines. The main native red received cleared/commits=[], and the review reds confirmed the missing live notification and the whole-read failure on a stale root. Both touched test files are green on standalone seeds 1/2/3; extra proof/guard, query-plan and checkout-feed checks are green. One runtime review: P2 live invalidation, P2 stale checkout and P3 Git diagnostics confirmed and fixed; no second review. The final shared server `bun run typecheck` 916ca0eb-2c2f-4287-b830-ceecb291049e:167 finished exit 0 after independent Cancel and ProtocolRows edits; the auth-terminal result is reused without a rerun.
