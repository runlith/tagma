---
id: 01a0e43e-11da-750f-af26-e197fd0dc325
title: Performance architecture corrections
ord: 14
---
# §3.13 v10 — four local closure obligations from Sol's v9 review

Keep the v9 architecture that now holds. Do not redesign unrelated mechanisms. No new agents; no graph/code changes, tests/typechecks, DB reads, probes/captures/load. Commands <=60000 ms. The absence of implemented benchmarks is not the blocker. Return an internally consistent spec-03-perf.md v10 plus four concrete traces.

## 1. One admission arbiter for the shared H slots

The pure eight-turn cycle cannot ensure progress if a separate impure queue can grab H=1 every time a git/inspection ends. Define the policy at the actual shared-slot release: cap consecutive impure grants when pure work is waiting, and require a pure grant (scheduled through the existing held/recovery/call/background rotation) before another impure grant. Include a finite bound for recovery/held with both pools continuously nonempty. Stopping an impure ask at its ceiling must not require recovery work waiting for its own occupied slot. Preserve memory/process/reader/recovery-memory reservations independently. H=2/3 retain the at-least-one pure-slot condition, but external I/O/lock waiting stays classified honestly as impure.

Trace H=1 with an unlimited sequence of impure asks plus held and recovery waiting; do not show only one impure ask ending.

## 2. Compare the object actually read, not only the symlink

The portable incremental SHA state is now sufficiently described, but unchanged lstat of a symlink says nothing about mutations of its target. Open one fd for an attempt; take fstat of the opened/dereferenced object and lstat of the pathname before/after, and validate path-to-fd identity. A changed/unsupported/unproven reading is unpublished, not a manufactured conflict. Keep the acknowledged limitation of non-cooperating same-tick edits explicit; do not claim metadata proves more than it does.

State SHA-state format version, endian, total byte count, pending-block/finalization and ordinal semantics, including cancellation of an in-flight chunk and worker failure restarting from byte zero. Global residency accounting is already correct; preserve it.

Trace an unchanged symlink whose target is rewritten during reading.

## 3. Distinguish encoded-byte writes from path-only moves

V9 requires touched set == plan set. proj_rev triggers cover encoded columns, not block.path, while the plan contains siblings moved without re-encoding. A valid move is therefore rejected forever.

Define two explicit sets: codec-write set and file-move set. Record path writes independently and validate the union against plan actions; do not compare unlike sets. A move-only entry is legal only if every codec input remains unchanged (proj_rev, including ord/verification/edges/source stamps). Otherwise prepare J5 for that block too. Preserve proof of actual post-write codec input/target hash before commit for each planned write and full rollback on missing/extra effects.

Trace one renamed sibling with unchanged content, and one move that also changes ord/source data.

## 4. Complete the receipt domain, signatures and retention

control(threadId,decide) presently has no key, although take-back/inbox/envelopes participate in C2. Birth must also carry the canonical call key explicitly. Give the full signatures and a table for each C2 kind: coordinator owner, physical authoritative receipt row/store, key/digest, first lookup, same-commit participants, result and replay behavior. Reuse existing inbox/command-delivery evidence where it already is authoritative; do not introduce an independent generic receipt that can disagree with it.

Flush keys are runId+sequence (or a genuinely globally increasing thread sequence), not bare flush #1. Include every internal transition that can be retried. Every participant executes only after the authoritative lookup establishes a new act.

Archive/delete must not erase key evidence and make an old act appear new. Declare the replay horizon and retained identity/tombstone/result policy. If full results expire, an old call must receive the specified unavailable/uncertain outcome and never rerun participants. A horizon without a retained tombstone or rejectable epoch cannot distinguish a forgotten arbitrary caller key from a new one: explicitly close that case. Coordinate this with accepted canonical call identity and storage-retention policy, and list any exact required amendment. Do not silently claim generic receipts exist in today's schema.

Trace control with a lost answer, two runs each at flush #1, and a replay after archive/result expiration. SQLite/Postgres/in-memory conformance requires these same outcomes in one C2 unit.

## Self-check

Check the invariants, scenario table, scheduling examples, port signatures, storage/migration rows, recovery drivers and §1/2/3/6 amendment list against the same decisions. No new 'closing' or performance-achieved claim. State any unclosed case rather than replacing it with a future calibration task.
