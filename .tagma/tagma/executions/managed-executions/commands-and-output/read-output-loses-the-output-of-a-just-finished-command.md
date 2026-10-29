---
id: 01a16bde-97d7-7058-8005-5aa1c52e2c26
title: read_output loses the output of a just-finished command
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "Answered ended, exit 0, and \"its output is no longer kept on this host\" on the first read of a command launched about a minute earlier.",
    "command": "read_output({\"execution\":\"5386a144-f83b-4e78-b92a-65437c73cbd0\",\"incarnation\":167,\"wait\":90,\"tail\":60})",
    "expected": "Get the command's completion and the last 60 lines of its output, to keep the evidence of three checks."
  }
---
Filed from project `runlith`.

[[01a16bde-e5d5-7404-8b0b-f4a7ca547834|fix-output]] found the cause at the producer: host build `8d2094d0d6` itself evicted the 3982-byte entry via `Host.release → RecordShelf.release → relieve → evictOver` about 6.7 s after admission. Span `f9c287667e80a3b8`, trace `c750e323883c18d12c7c72521f3cd2c7`, time `1792811070992`; no explicit retire line found for that execution. The previous trace `1ca4a724adbd8552fef603f6a8252ce0` shows mass eviction under volume pressure. `packages/execution-host/src/registry/RecordShelf.ts` keeps a 1/20 volume reserve and can evict a just-freed entry: the shelf does not know the first read's state. `apps/tagma/server/src/executions/commands/output.ts:120–125` correctly relays the loss fact. The exact free volume at the loss moment is not kept; a separate plain background printf with its first read_output on the same host kept the bytes. No fix landed: a guarantee until first read needs an agreed admission contract among the host shelf and read_output, not a fix of the consumer's cursor.
