---
id: 01a121e1-8304-7f20-b17b-924043b04b32
title: "An ordinary message's inReplyTo is written but seen by neither model nor app: show it to the recipient or drop it from the input"
ord: 2
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentSignal.ts
---
Observation from code:
- the `send_message` description ("For a reply, pass the received envelope id as inReplyTo") and the collaboration voice ("pass `envelope` as `inReplyTo`") tell every answering agent to copy the envelope id into the call — about 30–50 tokens;
- `ThreadEnvelopes.send` writes it into `thread_inbox.body.inReplyTo`;
- `agentSignalMarkup` renders only `from`, `thread`, and `envelope`, and neither the app nor `chat-ui` reads the field.

For ordinary messages the field enters only the call-key digest, so a repeat with a different `inReplyTo` refuses `key-reused`. Reports genuinely use it: `final` and the automatic report write the closed request's id into it.

Question: whether to show an ordinary message's `inReplyTo` to the recipient or remove it from the input and the voice.
- **Show** it as an attribute in the envelope markup. A broadcast sender will see which of its envelopes each of ten recipients answers.
- **Remove** it from `sendMessageInput` and the voice. Every answer gets cheaper, and the "answer → question" link is held by the model from `from` and the text, as now.

One question will decide the choice: whether the sending model uses the link to its envelope when answers are many, or `from` is enough for it.
