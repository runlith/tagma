---
id: 01a13f68-37a3-7dc7-9f0c-5315796e06f5
title: A finished bash prints an internal background-mode refusal
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "The command returned output and exit 0, but shell_metadata said: \"Its wait passed and this call could not move it to the background: This installation owes nothing for c86599b1-86c2-48e2-8ed4-8df2e8364b54; a mode moves only while its obligation stands.; it was held here until it ended.\" No execution handle; no command repeat was needed.",
    "command": "bash({command:\"for file in packages/agent/src/thread/run/RunExecution.test.ts packages/agent/src/thread/run/lifecycle/RunLifecycle.test.ts packages/agent/src/thread/run/ThreadRunReaper.test.ts; do printf '\\\\n%s\\\\n' \\\"$file\\\"; printf 'nonempty '; rg -c '\\\\S' \\\"$file\\\"; printf 'test sites '; rg -c '^\\\\s*test(\\\\(|\\\\.each)' \\\"$file\\\"; printf 'static expects '; rg -o 'expect\\\\(' \\\"$file\\\" | wc -l; done\",waitMs:1000,lifeMs:120000,description:\"Measure remaining execution lifecycle and reaper contract suites\"})",
    "expected": "A finished command returns exit 0 and output; on a background move, a callable execution handle returns with no internal mode error."
  }
---
Filed from project `runlith`.
