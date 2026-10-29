---
id: 01a1205b-eb84-7eac-af15-ef0da2afe539
title: Inspection queues where a silent worker doesn't stop all commits — with no request term
ord: 24
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a1205b-eb84-7eac-af15-ef0cd9aef9cf
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/judge.worker.ts
---
**Question.** How to arrange inspection queues so a silent worker doesn't turn one rule check into a refusal of all commits — with no request term.

**What it looked like.** After a server start (check cache wiped, fresh workers) the first `submit_work` never returned: six rules answered in 20 s, the seventh never. Following `submit_work` and `check_rules` hung until restart; some commits passed when none of their rules hit the hung queue.

**Evidence.**
- Main-isolate heap snapshot: queue "landing inspection worker 2" holds an unanswered `waiting` and a live `Worker`. The `once` closure holds the request itself: `judge`, rule `call-services`, root — a worktree, `base` — a commit, `built` — the prepared-change tree, eight paths in `apps/tagma/server`, job `landing:<uuid>`.
- Process `sample` ten minutes later: all `Worker` threads idle in `kevent`; no child processes launched after that request.
- No line from inspection workers in the server log; the main loop didn't freeze longer than 1.3 s in that time.
- By code `pick` (by reading, not observation): a `facts` request of a program rule left for queue 1, the first rule went to a fresh worker of queue 2 and answered, `call-services` queued behind it in the same queue.

**Why all commits refuse.** The queue lets one request through at a time; everything `pick` sent to it waits behind the never-answered one. Each commit runs seven rules over three queues and spreads rules across both landing queues at equal load, so almost every commit touches the hung one.

**What was checked outside the server.** The same queues from sources with an empty cache: 60 cold passes of eight rules on a 29-file change; that same commit (23 paths, shared `job`) — 6 passes; workers from the installed build — 3 passes; that same `call-services` request alone — 3 passes in 0.4 s. No hangs. Bun probes in [[d9aef9cf]], the suspected process-launch layer in [[533303ef]].

**Rejected.** A request term after which the worker stops: an honest check of a large project takes longer than any pre-picked number and would become every such project's commit refusal.

**What could work.**
- Routing: a request doesn't queue behind a busy queue while a free one exists, and when all queues are busy another worker rises. This removes the all-commits refusal, but not the hung request itself.
- An idleness signal: the worker reports what it's busy with — whether it computes and which of its own external waits (git processes, parsing, import) it waits on. The queue stops it only when an unanswered request stands behind it while it does nothing and waits for nothing. Project size doesn't affect such a signal.
- How to get it. The worker keeps a journal: the last received question id and last sent answer (it holds the answer itself until the next one), each launched process (pid, command, whether exit seen, whether stdout ended), each parse batch; the message handler, the wrapper over the worker's spawner and the parse call site write the journal. On a quieted request the queue asks for state, and the answer distinguishes cases. The request never reached the worker — a message there lost: the queue sends it again. The answer is sent but the queue never got it — a message back lost: the worker sends it again. The question wakes the worker loop: if the request answer comes right after — the wakeup was lost. Counters grew since the last question — the worker works, wait as long as it takes. The journal shows a wait that can't end: no process with that pid exists or it's a zombie, and the exit is unseen; the exit is seen but stdout never ended — the request fails with a typed refusal with this evidence and repeats once in a fresh worker, because the condition is proved, not guessed. Time only sets when to look, and fails nothing by itself. Each such case writes the journal to log and telemetry — so the next hang names the lost event, and the cause can be carried to its owner (Bun) with a reproduction. A journal-with-poll sketch was tried in the [[d9aef9cf]] probes: it named the unfinished operation, the live pid and its state.

**Not established.** What the silenced worker waited for.

**The same case in telemetry (October 9, UTC).** The server started at 01:23:02. `submit_work` at 01:23:35 and a second one from another thread at 01:29:35 waited in `enforcement.judgement`: of 2388 s of that span, child steps cover 0.56 s, the rest is waiting for a worker answer. Tree preparation through the execution host (`prepared.prepare`) took 3.7 s and completed. The operator moved both calls to background at 01:34–01:35: background by construction immediately answers the model with a receipt, while the operation itself hung until a restart around 02:03 and was interrupted, committing nothing. The next `submit_work` of the same thread at 01:38 landed a commit, because its rules went to the live queue. Over the day to October 10 — 174 `submit_work` calls, only those two longer than 45 s.

**Why after a restart.** A restart wipes the inspection cache, and the first landing goes the cold path a warmed server never takes: `call-services` calibration (`prefetch: false`, calibratable) reads a probe through a `cat-file` session and parses it with async oxc `parse`, while both workers open a fresh cache file in a race ([[360184df]]). It was `call-services` that hung. A code swap with a fresh build has nothing to do with it: Bun resolves `install/current` to the real release path, workers load from it, and a new build lands in a new directory.

**Distinguishing check at the next hang.** A lost exit notification leaves a zombie git child of the server (`ps -axo pid,ppid,stat,etime,command`, state `Z`). A live `git cat-file --batch` with no CPU points at reading from the stream; neither points at waiting inside the process (parsing, promise).

**Operator requirement.** The cure can't be a request term or a cut at minute N: Tagma must judge a project of any size, up to millions of lines. A term or an auto-backgrounding stays an open question of where they belong, but doesn't replace the found cause. Waiting in `once` (`inspectionLanes.ts`) breaks [[a3cdb701]]: worker silence is indistinguishable from work.
