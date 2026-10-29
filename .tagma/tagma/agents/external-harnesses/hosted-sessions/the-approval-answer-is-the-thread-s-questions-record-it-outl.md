---
id: 01a112a7-e98a-72db-9a72-5fadfe7e09a3
title: "The approval answer is the thread's `Questions` record: it outlives the call and is read once by a retry"
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/decision.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/harness/session.ts
---
The door deadline (50 s) belongs to the machine; the answer time belongs to the approver: finishing the `tagma op` call or the CLI process does not lift the question. A question is a `Questions` record in the thread journal keyed by the act (thread, operation, input, call site, raised conditions); a retry of the same act after the answer reads the answer and spends it once, and the next retry asks again. Different input, site, or fact is a new question — otherwise the short deadline would lose the human's decision, and a leftover permission could apply to a different act. A question lives until answered, until its deadline (then it is `lapsed`), or until the thread ends; the end of a call or run does not lift it. The `pendingInteraction` slot projects it for the attention list and the confirmation window.

Only a thread with a mode has questions. A caller with no thread — the operator, `tagma op` from the shell, a CLI with no thread — is judged in no mode: the absence of a thread never becomes a default mode.
