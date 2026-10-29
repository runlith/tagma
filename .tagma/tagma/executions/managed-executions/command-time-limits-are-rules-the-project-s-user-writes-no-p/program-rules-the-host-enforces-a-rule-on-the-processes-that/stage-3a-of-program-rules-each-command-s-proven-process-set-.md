---
id: 01a0d137-0ca1-7572-ae3b-6bb3e6f9bdcc
title: "Stage 3a of program rules: each command's proven process set and the one-second watcher on the host, and the stop signalling the set"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d137-9467-7eeb-83ef-7c80038f3426",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cfa1-81c1-714d-83d1-1b6713e3cf43
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRegistry.ts
  - kind: file
    ref: packages/execution-host/src/strayProcesses.ts
---
This is stage 3, part 1 of [[13e3cf43]]: the proven set and the watcher, with the stop moved onto the set. Only the host changes: no rules are matched yet and the wire does not change, so this lands through an idle replacement.

**Scope**
- **The proven set** is a per-command set in `ExecutionRegistry.ts`, beside the command's lifetime, built on the reader of [[3a6dc74e]] (`ProcessReader.ts`).
  - **Joining:** a process joins when a round first sees it as a child of the leader or of a member. It is keyed by pid plus start witness.
  - **Staying:** a member stays after the kernel re-parents it.
  - **Reused pids:** a member whose witness no longer matches its pid leaves the set and is never signalled.
  - **Lifetime:** the set starts at admission and is dropped when the command is decided.
- **The watcher** runs rounds once a second over each running command, from the leader and every live member.
  - Rounds never overlap. A round longer than the period delays the next.
  - The host's status counts rounds, their duration, and every delayed, skipped or failed round.
  - A failed round leaves the set as it stood.
- **The cap on the set** comes from the costs measured in [[a09e552a]]: the size at which one round would take half the period.
  - At the cap, new members are not proven, and the host keeps that fact for the command's read.
- **The stop** of [[f86edb6b]] signals the whole proven set, re-reading each member's witness just before its signal. This replaces the strays sampled once the stop begins. The ladder's steps and times are unchanged.
- **The residual report** names what is known of a process that left the tree before any round saw it.

**Out of scope:** matching, rules, extension revisions and the wire. These are [[13e3cf43]] stage 3 parts 2 and 3.

**Proof**
- Tests over injected readings:
  - a re-parented member is still ended;
  - a proven process whose pid is reused is never signalled;
  - rounds never overlap, and a slow round is counted as delayed;
  - at the cap, new members stay unproven.
- The real `setsid` escapee still ends through the set.
- The host suite is green for this change under the residue guard, and the typecheck is clean.

**At finish:** write the claims from the code, and re-read [[0f1ddc0b]], [[017cff32]], [[62049465]], [[69128217]], [[a5ee14db]] and [[451f849a]] against the set.

**Folded in from the stage 2 review** (commit be8f3d47be; reviewers `review-reader-opus` and `review-reader-sol`):
- **Read the whole table once per round.** Use `sysctl(KERN_PROC, KERN_PROC_ALL)`, which answers pid, parent, group and `p_starttime` for every user's process in one call. Read arguments and folder only for members.
  - This fixes `EPERM` from `PROC_PIDTBSDINFO`, which silently dropped another user's processes (`sudo`, setuid).
  - It also fixes the per-member kernel scan of `proc_listpids(PROC_PPID_ONLY)`, which made the cost tree × machine.
  - A child belongs to a parent `(pid, witness)` only if the child started at or after that witness.
- **Races:** after reading a member's fields, re-read its witness, and drop fields read from a reused pid. A reused root never lends its children.
- **Parsing:** an empty `argv[0]` is parsed correctly; the current parser returns an environment string as an argument. Bytes that are not UTF-8 make that field unread. The FFI answer is released on every path.
- **Identity by witness everywhere:**
  - a member whose identity cannot be read is named unverifiable, never dropped silently;
  - the residual sweep and `remeasured` act only on a target whose witness is proven, and a target with no witness is reported, never signalled;
  - the stop keeps reading until the command is gone, so a process that leaves the group late is caught;
  - the pty road checks the leader's birth witness.
- **Tests:**
  - pin the witness re-read before a signal, with the reading still showing the old witness;
  - clean up on every path, in Rust and TypeScript;
  - bound every wait;
  - sort pids numerically.
- **Claims:**
  - rewrite [[8093f059]];
  - re-measure [[a09e552a]] on the table road, since its crossover arithmetic does not follow from its figures;
  - correct [[31b184fb]], [[9c1db3f6]] (a zombie answers `ESRCH` while its pid is held), [[a5ee14db]] and [[451f849a]];
  - bind the narrowest sources for [[d38da5bf]] and area [[45da7add]].
