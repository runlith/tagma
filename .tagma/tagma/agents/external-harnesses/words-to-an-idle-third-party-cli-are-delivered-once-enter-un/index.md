---
id: 01a10482-425d-73da-8cef-d68ca6cf58e6
title: "Words to an idle third-party CLI are delivered once: Enter under a fresh input profile, unconfirmed delivery is neither reported as a refusal nor lost"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/keyboard.ts
  - kind: file
    ref: packages/execution-host/src/refusals.ts
---
## What the operator gets

A message sent to an idling Claude Code or other CLI thread reaches it exactly once. If acceptance is unconfirmed, the sender learns this honestly and does not duplicate words by resending.

## What stands now (measured 2026-10-04)

- At 01:08:33Z `send_message` to an idling Claude Code thread returned `harness-refused: screen-unavailable: The interpreter of d7c2887c… is not standing yet, so this CLI admits no typed input: this execution has no interpreted screen`. The text was already standing in Claude Code's input field, unsent: the screen read 6 and 15 s later showed it.
- `typeHarnessWords` (`external-harnesses/sessions/keyboard.ts`) reads the input profile once, pastes the text and sends Enter with the same revision. `packages/execution-host/src/InputModes.ts` raises the revision on mode control sequences, and `Execution.ts` checks every record's revision (`requireProfile`). Most likely cause: the revision changed between paste and Enter. The revision pair can no longer be checked.
- `Interpretation.ts` turns the profile conflict into `InterpretationUnavailable` with the "revision A while B stands" detail. `refusals.ts` erases it into `UnsupportedCapability: this execution has no interpreted screen`. `keyboard.ts` (`admits`) appends "not standing yet" and advises sending the words again, and a repeat would paste the text a second time.
- `sessions/drive.ts` marks the envelope delivered after partial typing and writes `submit-unconfirmed`, but the caller gets a refusal.
- At 01:11:05Z the CLI execution changed: generation 108 became 109. The unsent text vanished, and the envelope counts as delivered. Who replaced the execution is not established.

## Target model

1. **Fresh profile on every record.** Every record into the CLI terminal is encoded under the current input-profile revision, and Enter after pasting reads the profile again. If Enter hits a revision conflict, only Enter repeats under the new revision, a bounded number of times. The text is never pasted twice.
2. **The host keeps the reason type.**
   - A profile conflict reaches the caller with its own refusal, with expected and actual revisions.
   - `UnsupportedCapability` remains only for an execution with no interpreter.
   - No door appends a reason the host did not name, or advises repeating a record whose bytes were already admitted.
3. **Admitted bytes are delivery.** Once the terminal admitted even one word byte, the operation answers "delivered, acceptance unconfirmed", not a refusal. The answer says not to repeat. The envelope state, the operation answer and the advice in the answer agree.
4. **Acceptance confirmation is the CLI's own prompt-sent hook.** On Claude Code it is `UserPromptSubmit`: it carries the text with the envelope id. Confirmation proves the whole block arrived, not just its start. The hook admits a prompt of any size Tagma can deliver. Where the CLI declares no such hook, the screen remains the confirmation: the check reconciles what is actually visible in the multiline input field.
5. **Unconfirmed is neither lost nor run twice.** If the execution ended or changed before confirmation, delivery returns to the queue only where a witness shows the CLI never got the words: a hook, the CLI transcript, or the screen. Then it is delivered once on the next boundary — at session launch or via the turn-end follow-up hook. With no witness either way, delivery stays unconfirmed, and the sender sees that. There is no automatic repeat in this case. A lost host answer about acceptance also counts as uncertainty, not a refusal.
6. **Execution replacement.** Establish who replaced execution 108 with 109 at 01:11:05Z. If it is Tagma, fix at the owner; if the CLI itself, record the finding.

## Outside this work

- The CLI thread working alongside other agents — [[c4782e2d3]].
- The channel choice for an idling Claude Code, typing into TUI vs `stream-json`, is a separate idea: it hinges on `claude -p` billing.

## Check

1. If the profile revision changes between paste and Enter, the words are sent, and the text is pasted once.
2. A profile conflict reaches the door with its own code and revisions. "Not standing yet" appears only where the host named exactly that.
3. Partial delivery answers "delivered, acceptance unconfirmed", not a refusal.
4. The `UserPromptSubmit` hook with the envelope id confirms delivery.
5. Unconfirmed delivery on execution change is delivered exactly once on the next boundary.
6. After a server restart by the operator: `send_message` to an idling Claude Code thread arrives, and Claude Code answers it.
