---
id: 01a168ef-841f-737e-9105-9467464d805b
title: An answer cut by the output limit is continued by the core under the provider policy, and a cut after it runs out ends the run with a typed failure
ord: 16
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14743-437b-7fd2-9482-3351cc910981
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: packages/agent/src/agent/finish.ts
  - kind: file
    ref: packages/agent/src/agent/turn/continuation.ts
---
An answer cut by the output limit is continued by the core under the provider policy; a cut after its exhaustion ends the run with a typed failure. An answer without calls that the provider ended with `length` never ends the run: the loop puts the partial answer into the same step, appends a continuation request, and takes the next step. The request is a `user` message with `guidance` origin inside the step's `response.messages`, so the step journal keeps it and later runs of the history repeat it with no separate event kind. A stop said on that step writes no request.

How many times to continue and with which words is the provider's decision: `ModelProfile.continuation` (`limit`, `prompt`) arrives through model resolution in `ModelRequest`. A provider without a policy gets the core default (`STEP_CONTINUATION`), as a transport retry gets `stepRetry`. The count of back-to-back continuations resets on any step that did not end in a cut; a run raised after the driver died takes the already-spent count from its history tail (requests are marked `continuation`), otherwise every recovery would grant the limit again. A cut after exhaustion ends the run with a typed `AgentResponseUnfinished` carrying the count and limit. Agent stop conditions (`stopWhen`) outrank the policy: a cut on a step where they hold ends the run with the same failure and no continuation. In failure diagnostics that is `stage: model.finish`, `modelStarted: true`, `retryable: false`: the model answered, and the same request will cut again. A transport retry (`AgentRetryFailed`) and a turn continuation are different outcomes: the first repeats a request that never happened, the second continues a finished answer.

An answer cut on calls follows the ordinary tool step, as with Claude Code: finished calls execute, a call with unparsed input (`unparsed`) is answered with an error and never executes, no continuation request follows. That is how an answer whose thinking ate nearly the whole limit and whose last `send_message` cut through reaches the model as a call error instead of killing the run.

At Claude on ACP, Claude Code itself continues; it reports exhaustion as an assistant `max_output_tokens` error, the runner translates it into a `max_tokens` stop, and the turn end reaches the same `AgentResponseUnfinished` rather than a repeatable transport failure.

An answer of reasoning alone continues the same way; without a reasoning signature nothing goes to the Anthropic wire, and then history carries only the request.
