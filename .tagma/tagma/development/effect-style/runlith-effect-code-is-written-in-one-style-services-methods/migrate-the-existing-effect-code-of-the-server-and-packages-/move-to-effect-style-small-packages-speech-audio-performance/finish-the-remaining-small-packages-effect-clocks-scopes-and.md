---
id: 01a14c4e-f844-73aa-99b7-2c5f20dd1e64
title: Finish the remaining small packages' Effect clocks, scopes and honest failures
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: file
    ref: packages/activity/src/store/baseline.itest.ts
  - kind: file
    ref: packages/activity/src/store/bodies.ts
  - kind: file
    ref: packages/agent-sources/src/SkillDirectories.ts
  - kind: file
    ref: packages/audio-darwin/package.json
  - kind: file
    ref: packages/audio-darwin/src/channel.ts
  - kind: file
    ref: packages/audio-darwin/src/conformance.itest.ts
  - kind: file
    ref: packages/llm/src/oauth/FileTokenStore.ts
  - kind: file
    ref: packages/llm/src/oauth/flows/vendorPayload.ts
  - kind: file
    ref: packages/mcp/src/McpSession.stest.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
  - kind: file
    ref: packages/performance/src/MemoryCaptures.ts
  - kind: file
    ref: packages/performance/src/performanceBound.bench.ts
  - kind: file
    ref: packages/performance/src/performanceStore.bench.ts
  - kind: file
    ref: packages/performance/src/PerformanceStore.itest.ts
  - kind: file
    ref: packages/speech-whisper/src/models/ModelStore.ts
  - kind: file
    ref: packages/speech-whisper/src/provider.itest.ts
  - kind: file
    ref: packages/tagma/kit/conformance.ts
---
Finish the remaining manual changes to small packages: Clock, Effect functions, owner scopes of test resources and honest partial-read diagnostics. Verify CPU capture chains to the typed refusal, unwritten activity to coverage and retained output to the source view; targeted best-effort allowances change neither gate nor triggers. Proof is narrow types, owner tests, scoped inspections, one independent review and a commit; paid captures and heavy measuring benchmarks are out of the delivery.
