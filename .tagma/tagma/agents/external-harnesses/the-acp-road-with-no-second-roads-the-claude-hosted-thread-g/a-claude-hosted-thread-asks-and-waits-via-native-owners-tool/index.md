---
id: 01a113ff-0d62-74ec-ae7c-e9127c54d3ed
title: "A Claude hosted thread asks and waits via native owners: tool confirmation is the native ThreadHosting question, awaiting is a run stage; the ACP loop, the facet question mirror and the second recap are deleted"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hostedOperations.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hostedQuestions.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/questions.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/permit.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
## What the operator gets

On a Claude `acp` thread, a call the thread mode asks about shows the same confirmation window as a native thread (`ToolConfirmation`): the call summary, facts, consequence, intent and the tool button signature. In its place now stands a “Claude Code asks to run …” choice row with “Allow once” and “Deny”.

Everything around the question behaves like a native thread too:

- switching the thread mode to bypass answers the open question (the switch is done by `ThreadModes` in `packages/agent`, which also calls hosting);
- the answer wait deadline (the door's `reader.withinMs`) declines the call if no answer comes;
- the thread list and agent reads see the wait as the same run stage as on a native thread.

## Now: three second roads

**Consent.** The chain now runs:

1. `ThreadHosting.executed` answers `Asks` on the `ask` verdict.
2. `call_hosted_tool` returns `status: 'asks'`.
3. The runner (`permit.ts`) sends the ACP client `session/request_permission` with `_meta['tagma/asked']`.
4. The driver (`ProtocolAsks.asked`) reads `tagma/asked`, parks a `source: 'protocol'`, `kind: 'choice'` question in the facet and writes the ACP question record.
5. The operator's answer travels back to the runner via `ProtocolDriver.answer`.
6. The runner repeats `call_hosted_tool` with a `decision`.

The road loses the confirmation presentation (`ToolConfirmationPresentation`), the wait deadline and bypass answers (`bypassAnswers`). The loop itself contradicts decision 5 of [[adb9cd5b|the transport spec]], under which `request_permission` never arrives on Claude.

**Hosted-run questions.** `ask_user` is written as a native journal record, while `hostedQuestionsOf` → `ProtocolSessions.question` also lays its trimmed mirror into `facet.question`, trimmed to a single choice. Through that mirror:

- the driver parks the run in awaiting (`HarnessTurns.waiting`);
- a hosted question shares one facet slot with vendor permission requests (the `{ question }` variant in `ProtocolRow.parked`);
- `ReportEmitter.asked` sends the parent `envelope:ask`.

**New-session history.** On `session/new` the driver computes the thread recap (`Recap`) and lays it in the row. Meanwhile the runner itself reads the journal (`read_hosted_history`). The driver drops the recap when the answer carries `_meta['tagma/history'] > 0`.

## Goal

**Confirmation is the native hosting question.**

- On the `ask` verdict `ThreadHosting` raises the same question as a native run: `toolQuestionFromCall`, a `thread.tool.confirm` record with presentation, the `threadQuestionEvent` event.
- Hosting waits for the answer the same way it waits for `ask_user` in `questioned`.
- An “allow” answer executes the call via `door.settle(..., confirmed: true)`, a refusal or expired deadline — via `door.decline`, as in `toolResultsFromQuestion`.
- The question is found by `toolCallId` among the active run's records: `recordedQuestion` widens from `ask_user` to confirmations. So a repeated call after a server restart finds the open or already-answered question, and the answer is used once ([[fe7e09a3|consent outlives the MCP call]]).
- Hosting `holds` and `answer` cover confirmations. On a hosted thread `contribution.answer` answers only via hosting.

**The ACP loop is deleted:**

- the `Asks` variant of `HostedAnswer` and the `HostedCall.decision` field;
- `decision` in the `call_hosted_tool` input and `status: 'asks'` in its answer;
- `runner/claude/permit.ts` and the `asks` branch in `Bridge.called`;
- the `_meta['tagma/asked']` read in `ProtocolAsks.asked`.

A runner process started by an older build that outlived a server update keeps working: the new server never answers `asks`.

**Awaiting is a run stage written by the ACP driver.**

- When any question opens or closes on a run, `ThreadHosting` reports it to the `HostedAwaiting` port (just as `HostedCalls.introduced` crosses the boundary), and the ACP driver writes the awaiting stage (`HostedRuns.waiting`, `THREAD_RUN_AWAITING_QUESTION_STAGE`) via `HarnessTurns.waiting`. Reason: it also holds the turn's live stream — sealing the unfinished message before awaiting publication and reopening the stream after; a stage written by hosting past it would break the stream for the question's duration, and one stage must never have two writers. Run awaiting is a vendor question or an open hosted question.
- After a server restart an awaiting run is picked up by the same `resumeAwaiting` as now.
- The `HostedQuestions` port, `hostedQuestionsOf`, `ProtocolSessions.question` and the `{ question }` variant in `ProtocolRow.parked` are deleted.
- A hosted thread never writes `facet.question`. The slot stays only with vendor questions: Devin permission requests on `acp` and terminal CLI questions. The parent's `envelope:ask` stays there too.
- The parent learns of a hosted thread's question the same way as of a native thread's: via the run stage in agent reads. This is a visible change: there is no more separate parent message for such a question.

**History is one road per profile.** The driver computes a recap only for a profile without `hosts`. On a hosted session history travels only via the runner's `read_hosted_history`. `_meta['tagma/history']` and recap dropping on it are deleted.

**Stored data.** The migration step does two things:

- drops the `{ question }` variants from protocol-row `parked`;
- clears `facet.question` with `source: 'protocol'` whose id never starts with `harness-protocol:` — those are hosted-question mirrors.

An open question stays a journal record meanwhile, and the runner's repeated call finds it.

## Architecture

The whole answer to a hosted-call question lives in `packages/agent` (`ThreadHosting` and `ToolQuestion`), next to the native loop, reusing its functions. Only the operation wire and its call stay in `external-harnesses`. The ACP driver knows nothing of hosted-thread questions.

## Verification

The performer proves:

- the **`ThreadHosting` contract** in its package:
  - a call with the `ask` verdict places one `thread.tool.confirm` record and the run awaiting stage;
  - an “allow” answer executes the call once, a refusal yields `output-denied`;
  - repeating the call with the same `toolCallId` after the answer returns the recorded result;
  - an expired deadline declines the call;
- **the same check repeated after a host rebuild:** open and answered confirmation in the journal, the deadline counted from the question time, a cancelled call;
- **bypass, an answered `ask_user`, and `ask_user` with a cancelled turn** — in the same conformance; live Claude stays one smoke: `protocolClaude.stest.ts` awaits the journal record and the run stage and answers `harness.answer` with `THREAD_TOOL_CONFIRM_VALUE`;
- **code search** finds no `tagma/asked`, `permitThrough`, `HostedQuestions` or `decision` in the hosted-operation wire.

The operator checks: on a Claude `acp` thread in review mode a `bash` call opens the native confirmation window. “Allow” executes the call, “Cancel” declines it, switching to bypass answers the open question.

Notes rewritten by the same change:

- [[8e0f35a1|thread hosting]] — the “Permissions” and “`ask_user`” paragraphs;
- [[d0810682|Claude runner]] — “Permission question”;
- [[e47bd3fc|driver step write]] — the shared hosted-question and permission-request queue.
