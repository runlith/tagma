---
id: 01a14c57-bff7-77ed-972c-939abced94cc
title: A harness:claude turn refused account-required stays running at "starting" with no entry and no failure
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "serve.log records \"an external session became uncertain … account-required: Choose a signed-in directory account for claude-code\", but read_thread shows the thread running, the run running at progress \"starting — Thread run started.\", 0 entries, failureReason null, still so 3+ minutes later",
    "command": "POST /api/op/start_turn on a fresh harness:claude thread of a tagma:try instance whose world has no signed-in Claude account",
    "expected": "The run settles failed with the account-required refusal (choose or sign in to a directory account), as a native thread without credentials settles failed at once"
  }
---
Filed from project `runlith`.

Thread 01a14c51-54fc-7e0f-add2-0adce3bf8360, run 01a14c51-69ee-7076-85f3-fc0bac2eb486 on my own tagma:try (root ~/.tagma-try-fsf, port 47391), build from runlith 2026-10-18 ~00:00 UTC. The operator reading the feed sees a turn that never ends instead of the refusal that names the way out; the cause was found only in serve.log. The refusal comes from providers/accounts/harnessAccounts.ts launch().