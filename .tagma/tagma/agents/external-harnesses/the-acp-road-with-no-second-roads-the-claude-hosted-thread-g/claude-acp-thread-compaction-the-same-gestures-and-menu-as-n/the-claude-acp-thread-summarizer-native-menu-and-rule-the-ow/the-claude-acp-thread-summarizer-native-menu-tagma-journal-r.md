---
id: 01a118df-7dd7-7b8b-af1c-240ddae02f90
title: "The Claude ACP thread summarizer: native menu, Tagma journal recap by a foreign model via the ThreadCompaction port, and a new session from the folded journal"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118db-5778-76bc-8936-4437b63f02e2
  - kind: waits-on
    to: 01a118df-7dd7-7b8b-af1c-240c49b24903
---
Build [[b63f02e2|summarizer choice]]: `read_compaction_choices` for an `acp` thread, the own/foreign decision in `ProtocolCompactions`, the recap port in `threads/contract/service/compaction.ts` and its native-harness fill, the Tagma recap run with the vendor session cut, the app menu, the tests from the “What proves it” section, note [[92391518]] and the `compact_thread` `grammar`. Start at `native-harness/compaction/choice.ts` and `protocol/compaction.ts`. Done when the menu integration test, driver system test and live smoke pass.
