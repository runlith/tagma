---
id: 01a108bf-0b59-769e-b350-1d5697328281
title: "A turn's end names the fate of its words separately from the outcome: accepted, refused or unconfirmed"
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/acp/src/client.ts
    symbol: exited
  - kind: symbol
    ref: packages/acp/src/client.ts
    symbol: promptSettled
---
`TurnEnded.delivery` decides what the driver does with a prompt's envelopes, and does not match the turn's outcome (`outcome`):

- `accepted` — the agent answered with a result to the prompt's id, or the turn ended with an agent error or process death when this turn's updates had already arrived: the agent worked on the words, they are accepted, the turn itself may have failed;
- `refused` — an error before the first update on a specific prompt, or a host write refusal (`Unwritten`): the envelopes return to the queue;
- `unconfirmed` — an error without updates on an unspecified prompt, or process death after the host accepted a prompt but before the turn's first update: the agent may have read the words, so they must not be repeated. Process death before the acceptance receipt of a specific prompt, without updates, is `refused`.

`unconfirmed` words stay in the inbox unread and, when the session ends, are closed with a "not read" report to the sender. That is why a turn in which the agent already worked and the process then died (including after a `Cancel` the agent never answered) ends as `accepted`: otherwise the parent would get "task not read" about a task the agent worked on.

Any `session/update` arriving while its prompt is the oldest pending one opens its turn, even if the schema never read it: that is evidence of work, not confirmation. A permission request arriving after `Cancel` or `Stop` is answered `cancelled` by the machine itself and never goes out as a question. A turn sent `Cancel` or `Stop` before process death ends `Stopped` with `cancelled`; without one, `Failed`. Unanswered questions of an ended turn leave as a `Withdrawn` event.
