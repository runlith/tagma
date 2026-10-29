---
id: 01a11e8d-ee79-7708-8065-6ea38180548b
title: Prove parity of native, ACP, and terminal public acts on scripted transports
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60ae0f8d8726
---
Done: `78f9c0e230`, `bc23d989c6`, `a5fe025f97` — a shared scripted parity world for native, Claude ACP, Devin ACP, and terminal, 72 variants with crash/handover; the earlier report states three runs of 72/72 and a clean server typecheck, which the revision did not re-run.

Remainder on the [[0f8d8726|parity spec]] for native, Claude ACP, and terminal: in `composition/testing/threads/parity.stest.ts` compare stage, questions by id, inbox fates, each run's journal, and the count/kind/content of reports; add the interrupt task, committed-steer recall, question deadline, continue, rewind, and keyed replay of every door. In `terminalTakeUp.itest.ts` set a fresh foreign resource lease before the take-up check. The production Stop/launch race stays in the [[b133508a|launch-time Stop task]]; harness cleanup bounds do not prove it.

Anything Devin is deferred as outside the operator's priority; work on it is out of the current remainder.

Proof of completion: the shared suite compares every listed observation and code by public act on the existing scripted fixtures, including recovery and the Stop race; server typecheck is clean. Live vendor probes are out of this task.
