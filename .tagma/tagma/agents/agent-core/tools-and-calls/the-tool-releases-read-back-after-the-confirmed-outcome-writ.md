---
id: 01a12798-3009-749e-8a58-5fb32522c65f
title: The tool releases read-back after the confirmed outcome write
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12784-6b8f-74be-b7cf-dda49845fa3a
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/tool.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
  - kind: file
    ref: packages/agent/src/agent/ToolSettlements.ts
  - kind: file
    ref: packages/agent/src/thread/ToolSettlements.ts
---
`settleEffect` reads the outcome, and `Tool.settled` confirms it is already written: a write after read-back can fail, so the read itself releases no resources. When the running call is cancelled, the door reads the tool-declared read-back after its cleanup while still holding the call's resources; the result preserves that answer and the linked execution/operation. The journal confirms the terminal entry via `afterCommit`; on recovery an already-written terminal entry gives the same confirmation. A detached call's confirmation waits for the body to finish and the outcome to be delivered, because the receipt and the run end do not yet close its work. The body's return does not release read-back either: a parallel handoff of the call into the background may still request its receipt while the door keeps and projects the outcome. A call without a thread is confirmed by its own owner after receiving the outcome. Confirmation also releases the door's execution and cost tracking, including calls without a tool-declared read-back. Hosted calls discard their preparation and in-memory outcome at that boundary: the thread's journal owns replay, while a native door keeps its replay memo until the run ends. A harness's `ToolSettlements` exists only in the context caught at its assembly, while a call's body may run in the operator request's fiber — approval, backgrounding during preparation, or from parking. So the door takes the registry where its turn opened it, and execution uses it, and the surroundings only when the door is open without a registry; a door opened from a request (parking a call into the background) receives the registry from the transfer owner. Without a registry `retain` silently takes nothing and `settled` never arrives.

On cancellation read-back goes through the same full-output preservation mechanism as an ordinary response. A mutation interrupted mid-execution gets `cancelled` only when its owner explicitly confirms that ending after cleanup; without such confirmation `unknown` is preserved. A successfully returned response is preserved until its delivery begins: stopping output projection or later rules does not destroy the established result and does not turn completed work into unknown. Thus a known partial result is not lost, and the stop itself does not become proof of execution.
