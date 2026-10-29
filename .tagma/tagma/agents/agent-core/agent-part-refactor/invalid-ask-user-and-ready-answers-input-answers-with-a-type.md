---
id: 01a12770-9ebf-7aae-bb52-2db7106d8606
title: Invalid ask_user and ready_answers input answers with a typed refusal, not a silent "not a question"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1278a-0c5f-7fd1-948b-8d339489136a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a118eb-3e7e-7085-8f2e-2cd669dafa08
sources:
  - kind: symbol
    ref: packages/agent/src/tools/ReadyAnswers.ts
    symbol: readyAnswersFromToolCall
  - kind: symbol
    ref: packages/agent/src/tools/UserQuestion.ts
    symbol: userQuestionFromToolCall
---
`userQuestionFromToolCall` and `readyAnswersFromToolCall` answer `null` both when the tool name is foreign and when the input does not decode against the schema. Callers (`ThreadQuestion.questionFromToolCall(s)`, `hostedAsks`, `ThreadToolRecords`, `ThreadStreamSink`) do not distinguish the cases: an invalid `ask_user` in an interactive run turns into an "unresolved non-interactive call" (`ThreadCallBroke`) or simply is not parked, and the model never learns the input is invalid. The `swallowed-failures` check ([[ea465bed]]) holds both places as this task's debt (`failureReturn 9b841535`).

Do: parse the input into a typed outcome (not our tool / a question / an input refusal with the decoder cause) and let the refusal reach the model as the call answer. Done when both places leave the debt and a test through the run's public operation shows an invalid `ask_user` gets an answer-refusal, not a broken run.
