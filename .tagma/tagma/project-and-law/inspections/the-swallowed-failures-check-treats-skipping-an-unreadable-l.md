---
id: 01a1513d-881d-70a4-ae4a-4b47be10a251
title: The swallowed-failures check treats skipping an unreadable line's SchemaResult as arbitrary swallowing
ord: 39
tags: ["reflection"]
fields:
  {
    "actual": "submit_work refused law-violated ea465bed on packages/ripgrep/src/run.ts:256 contentReading.line failureReturn 32ed1a45, where Schema.decodeUnknownResult checks exactly the input's JSON/schema.",
    "command": "submit_work({subject:\"Validate external JSON at reader boundaries\",paths:[\"apps/tagma/server/src/threads/list/wire.ts\",\"apps/tagma/server/src/threads/list/wire.test.ts\",\"packages/ripgrep/src/run.ts\",\"packages/ripgrep/src/run.itest.ts\",\"packages/tsconfig/package.json\",\"packages/tsconfig/src/workspace.ts\",\"packages/tsconfig/src/workspace.test.ts\",\"bun.lock\"]})",
    "expected": "The check tells apart a Result with a single SchemaError from arbitrary failure: the stdout reader skips a line undecodable into the consumed form under the existing contract."
  }
---
The public searchContent already skips syntactically broken lines and unknown events; task 77445f9b explicitly requires keeping the skip, not adding SearchFailed. The new decoder limits the refusal to SchemaError. Independent process failures still go through SearchFailed/PlatformError. The direct way to express a partial parser is Schema.decodeUnknownOption; the infrastructure remark concerns failureReturn classification, not lifting the rule.
