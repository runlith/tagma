---
id: 01a1516f-31a9-7a90-bc08-353d269badb2
title: Claude Code run hangs forever after Claude Code merges two queued steers into one message
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "Claude Code finished at 23:47:26 and sits idle, but the run stays running with \"Thinking\" for 5+ minutes; 8 later messages stay Unread",
    "command": "operator message + agent envelope steered into running claude-code run 01a15169-919b-79fc-bdbd-e78b4dacc03b of thread 01a15109-4b72-7dbf-b535-d208cbfa63d4",
    "expected": "After Claude Code answers the steered words the turn concludes and the run ends; later messages start the next run"
  }
---
Filed from project `runlith`.

Evidence (Claude session 2a805fea-b8f4-4d6d-82d9-709d78145ff8.jsonl, claude 2.1.303): steer A (shelf-live envelope) enqueued 23:47:16.169, steer B (operator input:reader:a530bff6…) enqueued 23:47:18.109; Claude Code wrote "[Request interrupted by user]" at 18.233 and dequeued both into ONE user message uuid 31609726-… with mergedSendUuids [1954ef07-…]. Neither steer uuid echoes as message.uuid, so Turn.echoed (runner/claude-code/turn.ts) never resolves them; Turn.finished sees steers.size > 0 and waits forever; prompt never answers. Later steers get promptRequired (inFlight 0) and pile up Unread. Also Turn.cancel with inFlight 0 only resolves `halted` and does not conclude, so Stop likely does not end such a turn either (inferred from code, not run).