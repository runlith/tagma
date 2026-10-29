---
id: 01a0d039-0057-715c-a575-801b09fbed62
title: A delegated request stays open until the child sends its final answer; a woken run that changed something without one is reminded once, and the run the request opened keeps the last-message fallback
ord: 121
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d037-444f-799c-bc50-8ac64c006546
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentTurn.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
    symbol: completeRun
---
## 1. Outcome

A parent learns that the work it delegated is finished, whichever of the child's runs finished it, and learns it once. It is not woken by the child's intermediate runs: acknowledging a peer, fixing a review finding, waiting. The child sends that answer itself with `send_message` and `final: true`. The kernel reminds a child that is about to end a run in which it changed something without sending one. The run the request opened keeps today's last-message report as its fallback.

## 2. Problem and evidence

[[4c006546]] measured it on `build-server-lanes` (thread `01a0cfc0-4519-73aa-b2c4-c0c1d73526f5`). Of its 15 runs, only the first, which the spawn task opened, reported to the parent. The run that committed `c22990ea65` and finished task 52d67932 had been opened by a peer's message. Its final answer reached nobody, and the operator had to wake the parent by hand. `build-host-lanes` closed task 930e0cfb the same way. [[bcbc65ec]] is the same road seen from a message sender's side.

## 3. What holds now

- `ThreadEnvelopes.completeRun` reports only to `task` items delivered to the settling run ([[20d110c3]]). `send_message` and agent reports are `envelope` items: they wake an idle recipient, and the run they open owes nobody an answer ([[3f8fabc6]]).
- A request is acknowledged when the run it was delivered to completes. After that, no later run owes the requester anything.
- A woken run that fails or is cut reports to nobody.
- The loop ends at a text-only step (`AgentTurn`, [[f08fd98b]]). Stop conditions are asked only when the run would otherwise continue ([[c333b134]]). Nothing is asked before a run ends.
- The collaboration voices promise delivery without condition. `collaborationBirth` and `spawnedVoice` say "your final message is delivered to it as a report". `rootCollaborationPrompt` says "an agent's final answer arrives to you automatically as a report". `spawn_agent` says "its final answer arrives automatically as a report".
- `waitForReports` (workflow members) takes any arrival from a member as its report.
- `HarnessReports` reports every finished CLI turn to the newest request of each requester.

## 4. Target model

1. **An obligation belongs to the request, not the run.**
   - A `task` item sent by a thread opens an obligation of its recipient toward that thread. Such items are the spawn birth task and `send_task`.
   - `interrupt` items, reader turns and host items open none.
   - The obligation is closed in two ways: the recipient sends that thread its final answer, which closes every open request of that sender; or the sending thread is deleted.
   - The delivery states (`queued`, `delivered`, `acknowledged`) keep their meaning. Closure is a separate durable fact of the request.
2. **The final answer.** `send_message` takes an optional `final: true`.
   - It is accepted only while the addressee holds open requests on the sender.
   - It rides as an `envelope` item with intent `report`. Its `inReplyTo` is that sender's newest open request, and its id is derived from that request, so a request is answered finally once.
   - Accepting the envelope and closing the requests happen in one unit.
   - Refusals:
     - `no-open-request` when nothing is owed to the addressee; unblock: send without `final`.
     - `final` together with `inReplyTo` refuses; unblock: drop `inReplyTo`.
   - A message without `final` keeps today's meaning: it wakes an idle recipient and touches no obligation.
3. **The run the request opened keeps the fallback.** This applies when a run that a request was delivered to completes while the request is still open. That run's last message goes to the requester as today's report, and the request stays open. If the child sent a final answer during that run, no fallback is sent.
4. **The reminder.** A run takes exactly one more step, carrying a host guide, when all of these hold:
   - it is about to end at a text-only step;
   - it is not a run the request was delivered to;
   - the child holds an open request from a thread that still exists;
   - the run executed a tool that declares `mutates`, other than the messaging verbs `send_message`, `send_task` and `interrupt_agent`;
   - the run sent that thread no final answer.

   The guide names:
   - the request: its sender, when it arrived, and the task's opening line;
   - the exact call, `send_message(to, message, final: true)`;
   - the other way out: if the work continues, end the turn and nothing is sent.

   The reminder fires at most once per run. The guide is journaled, so a re-entered run reads that it was already reminded. After the reminder, a text-only end ends the run and sends nothing. That choice is the child's word that the work continues.
5. **Failures reach the requester from any run.** A run that fails or is cut sends its diagnosis (today's `completionReport`) to the sender of every open request the child holds, not only from the run the request was delivered to. A run the operator stopped answers nobody, as now.
6. **Words.**
   - **Child** (`spawnedVoice` and `collaborationBirth`): an agent that started you, or gave you work with `send_task`, is owed a final answer. When that work is done or cannot go on, send it with `send_message` and `final: true`, from whichever run you are in. If the run your work arrived in ends without one, its last message is sent instead. Any other run's ending sends nothing.
   - **Parent** (`rootCollaborationPrompt`, and the matching line of `spawnedVoice`): a child's final answer arrives as a report and opens a turn, from whichever of its runs sends it. The run your request opened reports its last message if the child sent no final answer. A run that fails or is cut reports its diagnosis. The child's other runs tell you nothing, so a child idle after a first report may still be working.
   - **`send_message`**: describes `final`, and says an ordinary message is owed no answer. Whoever needs an answer sends `send_task`.
   - **`spawn_agent`**: says which runs report, in the parent's words above.
   - **The fallback report** (`completionReport`): says the child sent no final answer, and that what follows is that run's last message.
   - **The reminder** text itself.
7. **Workflow wait.** `waitForReports` counts a member's `report` arrivals and ignores its ordinary messages.
8. **Harness road.** `HarnessReports` sends nothing for a request that is already closed. A CLI that sends `final` through the same catalog closes the request exactly as a native agent does.

## 5. Owners and boundaries

- **Collaboration plane** (`packages/agent/src/collaboration`) owns:
  - what an obligation is, and the final answer on `send_message` (`CollaborationTools.ts`, `ThreadEnvelopes.ts`);
  - the fallback and the diagnosis (`ThreadEnvelopes.completeRun`);
  - the words (`CollaborationVoice.ts`);
  - the workflow wait (`collaborationWorkflowMembers.ts`).
- **The loop** (`packages/agent/src/agent/AgentTurn.ts`) gains one optional closing port. It is asked only when a run would end at a text-only step and answers guides or nothing. When it answers guides, the loop takes one more step with them. The loop knows nothing about requests.
- **The thread run machine** (`ThreadRunStarter.ts`) fills that port. It reads the obligations from the inbox. The loop hands the port the run's steps, as it hands them to stop conditions, and the run machine reads the tools they executed and each tool's `mutates` from the catalog.
- **The inbox storage port**: `packages/agent/src/thread/storage/inbox.ts`, `InMemoryInboxStorage`, and the conformance suite in `thread/conformance/storagePort.ts`. **Tagma's adapter**: `apps/tagma/server/src/thread/ThreadInboxStore.ts`, `db/thread.ts`, and a drizzle migration.
- **Tagma's harness** (`apps/tagma/server/src/harness/HarnessReports.ts`) skips closed requests.
- None of Tagma's domain enters the kernel. "Changed something" is each tool's own `mutates` declaration; tasks and commits play no part.

## 6. Rejected alternatives

- **Report every run's end to the parent.** On the measured thread that is 14 more parent turns, most of them for acknowledgements that took a few seconds.
- **A non-waking progress message.** Words stored for an idle agent are read by nobody until something wakes it ([[a29c482e]]), and a third kind of message is one more choice to get wrong. A parent that needs progress reads the child's thread when asked.
- **Send the last message even after an ignored reminder in a woken run.** On the measured thread about seven runs fixed review findings, and each would have woken the parent with "fixed, waiting for the next reviewer".
- **Remind at every run end.** That costs a step in every acknowledgement run.
- **Trigger on `submit_work` or `finish_block`.** That puts Tagma's domain inside the kernel.
- **Fix the words alone.** Forgetting would have no net.

## 7. Acceptance criteria

1. The measured scenario passes on the floor:
   - the spawned child's first run ends in text: exactly one fallback report reaches the parent, and the request stays open;
   - a peer's message wakes the child, and that run executes a mutating tool and ends in text: the run takes one more step carrying the reminder;
   - the child sends `final`: the parent receives exactly one report, is woken once, and the request is closed.
2. A woken run that executes no mutating tool (the messaging verbs do not count) and sends no final answer ends with no reminder and sends nothing.
3. A final answer sent inside the run the request opened suppresses that run's fallback: the parent receives exactly one envelope for the request.
4. These refuse with `no-open-request`: a second `final` to the same requester, and `final` to an agent holding no request of the sender. `final` together with `inReplyTo` also refuses.
5. After the reminder, a text-only end ends the run and delivers nothing. A re-entered run does not remind again.
6. A woken run that fails or is cut while a request is open delivers its diagnosis to the requester. One the operator stopped delivers nothing.
7. `waitForReports` takes a member's `report` and ignores its ordinary messages.
8. A harness turn answer is not reported for a request that is already closed.
9. After the migration, requests acknowledged before it read as closed, and no child is reminded about them.
10. None of the texts in 4.6 promises that every final message reaches the parent.
11. Typecheck passes, along with the agent package suites (envelopes, turn, storage conformance) and Tagma's store and harness suites.

## 8. Standing claims and tasks this touches

- [[20d110c3]]: rewritten. A settled run's fallback goes only to requests still open; diagnoses go to every open request.
- [[9611fcff]]: the final answer's id is per request. The fallback's id is unchanged.
- [[24d97004]]: the fallback words.
- [[3f8fabc6]]: "owed a report" becomes the obligation.
- [[a29c482e]]: already drifted; re-read and reconciled.
- [[26fd5bb9]]: the wait keeps a member's last `report`.
- [[38616a33]]: the voices.
- [[f08fd98b]] and [[c333b134]]: the loop also takes another step when the closing port answers.
- [[19d4d179]]: the harness skips closed requests.
- [[b32b7a64]]: a receipt names the requests a `final` closed.
- New claims: the obligation, the final answer, the reminder, and failure diagnosis from any run.
- [[4c006546]] and [[bcbc65ec]] are answered by the finishing task. [[5a1aa153]] is another road (a report never published) and is not touched.
- Files other sessions are building in right now: the compaction core (`ThreadRunStarter.ts`, `inbox.ts`, `inboxItems.ts`, `ThreadEnvelopes.ts`) and the delegation switch (`CollaborationVoice.ts`). The builder coordinates by `read_changes` before wide edits to them.

## 9. Order of building

1. Storage: the closure fact, the port methods, the migration with its backfill, conformance.
2. Envelopes: `final` on `send_message`, closure, the refusals, and the fallback and diagnosis rules in `completeRun`.
3. The loop's closing port and its wiring in the thread run machine.
4. The workflow wait and the harness road.
5. The words.
6. Claims written from the built code, then doctor over the touched paths.

## 10. Contract

- **`send_message`** gains an optional `final: boolean` at every door that carries the collaboration catalog: native, and Tagma's MCP. Absent means today's message.
- **Envelope intents** are unchanged. A final answer is intent `report` with `inReplyTo`, so thread records, the socket and the chat carry it as they carry a report now. No wire version rises.
- **The receipt** gains the ids of the requests a `final` closed.

## 11. Stored data

- **New columns.** `thread_inbox` gains `closed_at` (timestamp, null) and `closed_by` (text, null). `closed_by` holds the final answer's envelope id, `requester-gone`, or `migrated`. An index serves a thread's open `task` rows.
- **Migration.** It backfills `closed_at` and `closed_by = migrated` on every `task` row whose state is `acknowledged`, so no child owes a final answer for work it reported before the change. `queued` and `delivered` rows stay open.
- **Rollback.** The old server ignores the columns. Rolling back and then forward leaves requests acknowledged under the old server open. At worst that costs one reminder in a later woken run that changes something.

## 12. Who may do what

- Only an obligation's holder closes it, and only toward its sender. The permission subject stays `send_message`'s write subject on the addressee.
- The open-request check and the closure read the same rows in one unit. If that check were wrong, a parent would be handed a report nothing asked for.
- A sender's thread being deleted closes its requests when they are read.

## 13. Long-lived things

- An obligation's life is open → closed.
- A child that never sends a final answer keeps it open for the thread's life. That costs one row, plus eligibility for a reminder in woken runs that change something.
- Deleting the child's thread deletes its rows (the foreign key cascades).
- An archived sender is still a sender, because archive is reversible. A deleted one is not.

## 14. Bounded resources

- The reminder costs at most one model step per run, on a warm cache.
- There is one final answer per request.
- The open-request read at a run's settlement and at its closing check is indexed. It is bounded by the requests the thread received.

## 15. Rollout

- A server restart applies the migration.
- A run going across the restart is adopted or cut as today, and settles under the new rules.
- Threads keep their frozen prompts until refreshed ([[a272d3bc]]), so an old child still reads the unconditional promise. The tool catalog is assembled per run, though, so `final` appears at its next run, and the reminder names the call itself.

## 16. Failures

- A final answer's closure and its envelope's acceptance are one unit. Its wake replays like any accepted envelope ([[a9a74a2d]]).
- A process lost after the reminder step began: the re-entered run finds the journaled reminder and does not remind twice.
- The final answer is written inside the run, before it settles, so `completeRun` always sees the closure.
- A `send_task` from the same parent after a final answer opens a new request, which gets its own fallback.
- A `final` to a sender whose thread is gone refuses `no-open-request`.

## 17. Observability

- **Trace facts:**
  - `request-closed` (request id, by);
  - `closing-reminder` (run id, the requests named);
  - `run-reporting` gains counts for fallbacks, diagnoses, and requests skipped because they were closed.
- **In the transcripts:** the reminder is a guidance entry in the child's transcript, and the final answer is a report row in the parent's.
- **Checking it in operation:** rerun the scenario of [[4c006546]] on the floor.
