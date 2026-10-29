---
id: 01a12905-f3e4-7ef5-a6cb-0f6470381bdd
title: Landing the phantom-held fix repeated phantom-left in a running process
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "When landing the fix itself, 18e4637f05, the tool again named driver.ts, retirement.itest.ts, submit.itest.ts and submitLines.itest.ts in left. Subsequent git status across all 20 paths is empty and this session's read_changes answers holds 0; the same four paths stay held in the turn history.",
    "command": "submit_work {\"checkout\":\"/opt/workspaces/runlith\",\"subject\":\"tagma: retire clean holdings and retain deferred commit proofs\",\"paths\":[\"apps/tagma/server/src/composition/testing/landing/submit.itest.ts\",\"apps/tagma/server/src/landing/land/submit.ts\",\"apps/tagma/server/src/change-record/holdings/judge.ts\",\"apps/tagma/server/src/composition/testing/change-record/retirement.itest.ts\",\"apps/tagma/server/src/change-record/retire/driver.ts\",\"apps/tagma/server/src/composition/testing/landing/submitLines.itest.ts\",\"apps/tagma/server/src/composition/testing/landing/submitBytes.itest.ts\",\"apps/tagma/server/src/composition/testing/landing/submitHoldings.itest.ts\",\"apps/tagma/server/src/change-record/store/retirement.ts\",\"apps/tagma/server/src/change-record/change-record.ts\",\"apps/tagma/server/drizzle/20261011025400_retirement_proof/migration.sql\",\"apps/tagma/server/drizzle/20261011025400_retirement_proof/heavy.json\",\"apps/tagma/server/src/change-record/retire/store.ts\",\"apps/tagma/server/src/composition/testing/retirementFixture.ts\",\"apps/tagma/server/src/composition/testing/change-record/retirementProofs.itest.ts\",\"apps/tagma/server/src/change-record/record/journal.ts\",\"apps/tagma/server/src/change-record/record/commands.ts\",\"apps/tagma/server/src/change-record/testing/doubles.ts\",\"apps/tagma/server/src/change-record/testing/holdings.ts\",\"apps/tagma/server/src/composition/testing/landing/submitPeers.itest.ts\"]}",
    "expected": "After landing, left names no paths where this session has no lines left relative to HEAD."
  }
---
Filed from project `runlith`.

The event happened during the landing of the fix, before the finish of [[2b7c48a9|phantom-held task]] and the answer to the original reflection. The running server was neither updated nor restarted. The fix's sources and contract tests are in commit 18e4637f05fb5f2c0f12fbc24242b3ead0a6b4f4; the observation preserves the live process's previous behavior and claims no regression of the activated fix. Adding a sighting to the already answered reflection was rejected by the door, which required a separate entry.
