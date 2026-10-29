---
id: 01a14be0-6dbd-7c44-919a-16414bb7c333
title: Agent offers ready answers, and the operator answers by pressing a button
ord: 10
tags: ["feature"]
fields:
  {
    "state": "dormant"
  }
sources:
  - kind: file
    ref: packages/agent/src/tools/ReadyAnswers.ts
  - kind: file
    ref: packages/chat-ui/src/entries/RetiredReadyAnswersRow.svelte
---
**Value.** The operator answers the agent with one press when the natural answers are a few short options, instead of typing them.

**How.** The agent's `offer_ready_answers` tool: the agent calls it before answering, and ready-answer buttons stand under the remark.

**Behaviour.** The agent offers two to four complete answers; pressing sends the option's text as the operator's message, free input stays. Feed recording is built and the chat shows it: the buttons of the latest set under the feed while the agent is idle, earlier sets as a collapsed row with the chosen option in `/verbose` mode.

**Limits.** The tool is installed on no Tagma server agent: only the agent package's tests and conformance reference it, so neither agent nor operator ever reaches the buttons.

[[479aedfc|The agent's question with options]] solves a similar problem, but it stops the agent until answered, while ready answers do not.
