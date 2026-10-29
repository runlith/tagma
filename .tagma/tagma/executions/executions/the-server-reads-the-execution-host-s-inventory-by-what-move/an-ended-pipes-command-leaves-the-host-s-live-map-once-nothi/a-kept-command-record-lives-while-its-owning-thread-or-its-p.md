---
id: 01a0db68-79ca-7310-b2d3-87ca5ea81585
title: A kept command record lives while its owning thread or its project stands, the host learns an owner went through a Disown act, and the only size bound is a guard derived from the records volume
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRegistry.ts
    symbol: evictOver
---
Revises the byte budget of [[7ca1d85e]]. Everything else it built still stands: release, sealed reads and the retirement writes.

## 1. Outcome

A released command's kept record lives while something can still ask for it: its owning thread, or the operator's view of its project. At most it lives until its host generation ends. When the owner goes, the host retires the record through its own retirement writes. Nobody picks a byte figure. The one size bound is a guard against running the disk out, and it is derived from the volume the records live on. A reader of an evicted or disowned command is told its output is no longer kept, never shown an empty command.

## 2. Problem and evidence

- `host.keptRecordBytes` (256 MiB) is a number the operator would have to pick. Rule 0f144655 forbids asking for it, and rule fe83acfa forbids justifying it from this machine.
- Whether a record is still wanted is a fact about ownership, and the host cannot see ownership; a byte count stands in for it badly. On a big disk it keeps records nobody can ask for. On a small or nearly full disk it can still fill the disk.
- One sample, on this machine: 2,071 records in 18 MB, largest 76 KB, on a volume with 239 GB free of 926 GB. This is not a design input.

## 3. What holds now

- The host keeps released records oldest-first under a budget handed by `Keep` (wire 33). The server holder `KeptRecords` hands the budget from the setting.
- Each command's admission carries `origin.scope = project:<id>` and `origin.owner`: `thread:<id>` for a thread's command, `operator` for the operator's and a service's (`Terminals.launchOf`).
- A thread delete stops the subtree's commands, deletes the thread row, then runs `afterDeleted` (`ThreadEnding.delete`). Thread rows are hard-deleted. Command rows keep `owner_thread`, which is not a foreign key.
- A project is removed only once nothing holds it, threads included ([[9221a929]]). Its command rows cascade away with it. `Projects.releasing` runs after removal.

## 4. Target model

- **Owners.**
  - A thread's command is wanted while the thread row stands.
  - An operator's or service's command is wanted while its project is registered.
  - Neither outlives the host generation, whose records the next generation wipes.
- **How the host learns: a `Disown` act** on the control lane, custodian only, naming an owner key, a scope key, or both.
  - The host adds the keys to a set held for its generation.
  - It retires every kept record whose admission origin matches, through the retirement writes.
  - From then on, a matching command is retired the moment it would be released, so a command that ends after its owner went is not kept.
  - It answers how many it retired. Disowning twice is one act.
- **Who sends it.** The server:
  - after a thread delete, for each deleted thread's owner key (`afterDeleted`);
  - after a project removal, for its scope (`Projects.releasing`);
  - at every host adoption (boot and after a replacement), for each owner key of a current-generation command row whose thread row no longer exists, recovering a disown lost to a crash.
- **The guard.** At each release the host reads the records volume (`statfs`).
  - While the space available is below a twentieth of the volume, it retires the oldest kept records until the deficit is covered, counting each in the disk blocks it holds.
  - A twentieth scales with the machine: a nearly full disk keeps nothing, and a large one keeps what its owners want.
  - A reading that fails evicts nothing and is reported in the status.
- **The largest record.** Each stream keeps at most `output.retainedBytes`, plus the segment being written and a landing chunk. A pipes record is at most `2 × (retainedBytes + segmentBytes + landingBytes)` plus its seal. With the server's policy that is 2 × (8 MiB + 256 KiB + landing), about 16.6 MiB. The kept total is at most the lesser of (current-generation commands whose owners stand) × that bound and what the guard allows.
- **Readers.** An evicted or disowned command's ending reads retention `lost`. `read_output` answers its header and says the output is no longer kept, without reading bytes that are gone.
- **The setting.** `host.keptRecordBytes`, the `KeptRecords` holder and the `Keep` act are removed. The status reports the kept records and bytes, the guard's reserve and the last available figure.

## 5. Owners and boundaries

- **`@runlith/executions`:** the `Disown` act and its report, the status figures, wire 34.
- **`@runlith/execution-host`:** the disowned set, retirement on disown and at release, and the volume guard.
- **Tagma server:**
  - the three `Disown` senders: thread delete, project removal and adoption;
  - `read_output`'s evicted answer;
  - removal of the setting and its holder.

## 6. Rejected alternatives

- **A server scan every disposition pass for orphaned commands:** it pays O(commands) on every pass for an event that happens when a person deletes something.
- **Retiring by execution from the server:** a command still running when its owner goes would need a second road when it ends. A disowned key held by the host covers it at release.
- **A fixed or operator figure for the guard:** it is wrong on some machine. A fraction of the volume is right on each.

## 7. Acceptance criteria

1. **Host integration tests:**
   - `Disown` by owner retires that owner's kept records and leaves others;
   - a command of a disowned owner that ends afterwards is not kept;
   - `Disown` by scope does the same for a project;
   - a guard whose reserve exceeds the space available retires oldest first.
2. **Server integration tests:**
   - deleting a thread sends `Disown` for it;
   - adoption re-sends it for a thread row that is gone;
   - `read_output` of a command whose retention is `lost` says its output is no longer kept.
3. The setting and the holder are gone. Typecheck, unit and integration pass for the touched packages.

## 8. Claims and tasks

- **Rewritten:** [[5711e3dc]] (the guard, not the budget) and [[520d9ef8]] (the holder is replaced by the disown senders).
- **New:** owners and `Disown`; the largest record.
- **Tasks:** none.

## 9. Order of building

1. Protocol.
2. Host: disown and the guard.
3. Server: senders, the evicted answer, removal of the setting.
4. Tests.
5. Claims.
6. Performance review.
7. Commit.

## 10–17

- **Contract:** wire 34 removes `Keep` and adds `Disown`. The server and host of one build speak it.
- **Stored data:** no migration. The setting's stored value, if any, is ignored once its key is gone from the catalog.
- **Who may do what:** `Disown` is the custodian's; recovery is refused it. Only the server knows ownership.
- **Long-lived things:** the disowned set lives for the generation and holds one entry per deleted thread or removed project, a person-rate population.
- **Bounded resources:**
  - one `statfs` per release;
  - `Disown` walks the kept ledger once per act, and acts come at person rate;
  - the kept total is bounded as in §4.
- **Rollout:** ships with a host replacement.
- **Failures:**
  - A lost `Disown` is re-sent at the next adoption.
  - A retirement write the store refuses keeps the record, and the record is tried again at the next release.
  - A race between a command's end and its owner's `Disown` is closed by the disowned set at release.
- **Observability:** the status carries the kept records, their bytes, the guard reserve and the last available reading. `Host.Disown` is spanned.
