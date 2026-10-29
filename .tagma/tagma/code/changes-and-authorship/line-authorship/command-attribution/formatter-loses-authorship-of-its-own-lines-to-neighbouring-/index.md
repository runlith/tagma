---
id: 01a14c5f-311c-7fa9-b864-cf10de82b2fc
title: Formatter loses authorship of its own lines to neighbouring commands
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "The command handled 34 files in 31 ms; Tagma counted 25 changed files as overlap/nobody, never keeping the author of their formatted lines. Read_changes requires whole for these paths, including mixed-author changes in linked server consumers.",
    "command": "bunx --no-install oxfmt --threads=3 packages/agent-tools/src/CheckoutBaselines.ts packages/agent-tools/src/bash/tool.ts packages/agent-tools/src/changed.ts packages/agent-tools/src/commandWork.stest.ts packages/agent-tools/src/delete.ts packages/agent-tools/src/localLadder.ts packages/agent-tools/src/rename.ts packages/agent-tools/src/runtimeSpawner.stest.ts packages/agent-tools/src/write.ts packages/activity/src/store/baseline.itest.ts packages/activity/src/store/bodies.ts packages/agent-sources/src/SkillDirectories.ts packages/audio-darwin/package.json packages/audio-darwin/src/channel.ts packages/audio-darwin/src/conformance.itest.ts packages/llm/src/oauth/FileTokenStore.ts packages/llm/src/oauth/flows/vendorPayload.ts packages/mcp/src/McpSession.stest.ts packages/performance/src/CpuProfiler.ts packages/performance/src/MemoryCaptures.ts packages/performance/src/PerformanceStore.itest.ts packages/performance/src/performanceBound.bench.ts packages/performance/src/performanceStore.bench.ts packages/speech-whisper/src/models/ModelStore.ts packages/speech-whisper/src/provider.itest.ts packages/tagma-adapter/kit/conformance.ts",
    "expected": "The agent's own formatter keeps authorship of previously file-tools-written code when neighbouring commands never touch these files."
  }
---
Filed from project `runlith`.

After the next same formatting FileTokenStore.ts read_changes shows +69/−233 of this session and +100/−12 nobody, listing parallel sessions working on other parts. This matches the tool's described time-window rule, but makes extra work of splitting a ready delivery from neighbouring changes; no submit_work refusal yet. Working files were not rewritten to restore authorship.
