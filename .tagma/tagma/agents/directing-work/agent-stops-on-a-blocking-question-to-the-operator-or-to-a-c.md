---
id: 01a14be4-2437-75af-92bd-b426479aedfc
title: Agent stops on a blocking question — to the operator, or to a child's parent — with choices, a question bundle, or a secret
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927ef2dc414b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: packages/agent/src/tools/UserQuestion.ts
    symbol: threadUserQuestionTool
---
**Value.** An agent that needs the operator's choice or secret does not guess or ask for a password in the correspondence: it asks and waits for the answer.

**How.** The native agent's `ask_user` tool; the answer — right in the feed, via the `answer_question` operation or `tagma answer`.

**Behaviour.** A question comes with choices and multiple selection, with a bundle of several questions, or with a secret value. The run pauses at the question, and the answer starts a new run to continue from it. A child's question goes to its parent, which answers with `answer_approval`; a question with a secret always goes to the operator. The agent asks a simple single-choice question as plain text, not with this tool. A feed answer is delivered as a sent message: under its own key, exactly once, with resend on a broken connection and after a reload; until the server confirms it, the card shows the answer is being sent.

**Limits.** Native agents only: another CLI's own questions are read from its screen and answered under the approval rules.
