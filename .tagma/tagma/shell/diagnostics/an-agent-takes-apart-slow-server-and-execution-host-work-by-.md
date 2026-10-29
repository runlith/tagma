---
id: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
title: An agent takes apart slow server and execution-host work by a local record of traces, stops and load
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a136c1-4ec1-7395-bc66-acdb0a20e25b
  - kind: relates
    to: 01a14bc0-768b-7e96-9c80-5cff98b2fb74
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/telemetry/TelemetrySection.svelte
  - kind: file
    ref: apps/tagma/server/src/performance/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/performance/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/performance/layer.ts
  - kind: file
    ref: apps/tagma/server/src/performance/operations.ts
  - kind: file
    ref: apps/tagma/server/src/performance/reads.ts
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
  - kind: file
    ref: packages/performance/src/protocol/records.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
    symbol: builtInSkills
---
**Value.** An agent takes apart slow calls, stops and load by the server's and execution host's local evidence, instead of guessing from one symptom.

**How.** `read_performance`, `read_host_performance`; recording is on in the working server. Settings → Telemetry sets storage, sampling and measurement rate.

**Behaviour.** Selected traces, slow and failed spans, event-loop stalls with CPU profiles, process readings and metrics are kept. Readings give the trace tree, covered-time analysis, load rows and command cost. The host reads from its own ring, including another host's kept catalog, without starting it. No data is sent automatically.

**Limits.** This is a kept sample, not a full history and not a CPU measure by elapsed/self. Live memory and losses of another host are unavailable. The short-spans threshold is taken at tracer build, so changing this key does not apply at once, unlike dynamic settings. The promised split of diagnostic operations into a developer-only module and a per-channel spans switch are not done yet: the module now joins the server's shared composition. There is no built-in `performance` skill in the checked set. A separate failure record with a stack in the ring is also not implemented: a failed span keeps cause tags, and the stack may stay in the server log.
