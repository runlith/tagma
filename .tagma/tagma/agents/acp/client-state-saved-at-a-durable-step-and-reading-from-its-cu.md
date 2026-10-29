---
id: 01a108bf-0b4c-7ba3-865a-c51cd7296684
title: Client state saved at a durable step, and reading from its cursor, replays the same result
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/acp/src/client.ts
  - kind: file
    ref: packages/acp/src/draft.ts
  - kind: file
    ref: packages/acp/src/state.ts
---
`receive`, `act`, `answer` and `checkpoint` are deterministic: no clocks, no randomness; request ids are `${incarnation}:${n}` from the state counter. `act` answers the id of the request it issued (`request`, `null` for an action without a request), and only that id keys the driver's expected answer: an id predicted from outside by the counter would diverge from the machine on any change of its numbering. Hence the driver contract:

- state is saved when `step.durable`, and before `step.frames` are written: Tagma's request and the agent's answer are recorded ahead of their bytes. A step that produced only live events (`Delta`, `ToolCallChanged`, `SessionChanged`, `Unrecognized`, `Malformed`, `Stray`) needs no saving — rereading it repeats it;
- reading after a restart goes from `state.cursor`, in `torn` mode where set; the machine skips a frame ending no further than the cursor, so rereading extra is safe;
- rereading costs no more than the bytes since the last durable step: an unclosed message and open tool calls accumulate in `state.turn` and go to the record at the boundary — call start and end, question, turn end;
- `checkpoint` seals only the unfinished message ahead of the driver's outer boundary, keeping prompt and cursor; the continuation arrives as a new part of the same turn. `kept` saves state without sealing the message: it is called by a driver line change that is not a turn boundary (a cancellation mark), so the open text survives to the turn's end as its tail;
- a finished call leaves the state, so the state does not grow with the turn: its late `tool_call_update` arrives as a `ToolCallAmended` event with the current turn's id. The driver reads this turn's standing record of the call and merges into it only the fields the update brought; an update to a call with no record in this turn (a past turn's call) is not written, rather than giving birth to an empty stub record over history.

The machine records uncertainty and never heals it by retry. `Recovered` marks Tagma requests without an acceptance receipt (`Admitted`) as uncertain, and drops agent answers without one from the state with an `Uncertain` event; `Unknown` does the same with one lost receipt; `Gap` marks every pending request on both sides and puts the cursor at `resume` in `torn` mode. A line over the ceiling (`Oversized`) ends the running turn with a size failure, sends the agent `session/cancel`, and puts the cursor past its start in `torn` mode. A late answer to an uncertain id closes the request normally. The machine does not answer an uncertain agent request: `answer` refuses `uncertain`, `Cancel` skips it. An answer the machine writes itself (`cancelled`, invalid params) is recorded in `state.asks` ahead of the bytes, like any other. A new agent process is a new state `start(incarnation)`; `Exited` closes everything pending on the old one.
