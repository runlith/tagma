---
id: 01a0db11-176c-7d6f-b4d1-f6427ca1d85e
title: An ended pipes command leaves the host's live map once nothing reads it, and its sealed record is served off disk under a byte budget the operator sets
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/executions/src/RecordFiles.ts
  - kind: symbol
    ref: packages/execution-host/src/Holdings.ts
    symbol: Holdings
---
## 1. Outcome

An ended pipes command stops costing the host a live entry once nothing reads it. It leaves the live map and its sealed record stays on disk. The host serves reads of that record off the files until a byte budget the operator sets evicts it, oldest first. Inventory readings, the per-round watched set and host memory then follow live work. `read_output` keeps working on ended commands until eviction, and after eviction it is answered the way a retired record is.

## 2. Problem and evidence

- **What incarnation 52 held:** 6,664 ended commands in its live map, at 1.3–1.5 GB RSS. Nothing retires a command, because retiring deletes the record `read_output` reads.
- **What those entries cost:**
  - every whole listing reading pays about 0.3–0.5 ms per held row to build its summary (`inventoryReading.bench.ts`);
  - `watched()` walks the whole live map every sampling round, about once a second, to drop the ended rows.
- **How big the output is:** measured over the 852 records of incarnation 53 on 2026-09-26, p50 8 KiB, p90 8 KiB, max 40 KiB, 7.3 MiB in total.
- **Internal calls:** they already leave, because their callers retire them.

## 3. What holds now

- Retirement is the caller's act. It deletes the record and files retention `lost`, refusing on a store failure ([[8f8801c5]]).
- Every read resolves through the live map: `read`, `openReader`/`pull`, `summary`, `screen`, `stop`, `topology`.
- `ending`, `command`, `commandsAt`, the command inventory and `callResult` answer off the store for work the live map no longer holds.
- Records of a replaced generation are wiped at the next generation's start ([[e2910415]]).

## 4. Target model

- **Release.** A pipes execution whose lifetime is `command` or `held` is released once:
  - its phase is ended;
  - its ending is measured with the proof retirement demands: cleanup complete, or unverifiable under the unmeasurable mark;
  - no leased read stands;
  - no byte reader is open on it.

  Release closes its scope, which seals the record and gives the slot back. It keeps the directory and writes nothing to the store, because the ending already filed retention `retained`. It stamps a departure in the journal and adds the execution to the host's sealed ledger with its seal's byte size and the release time.

  Release is attempted when the ending is measured, when the last leased read settles and when the last reader closes. That is its driver, as rule a00f91b0 requires.

  `call` lifetimes stay with their callers, who read `callResult` and then retire. pty executions stay live, because a pane reads the interpreter's screen.
- **Reads of a released execution.** `Read` is answered off the sealed record, opened once through `RecordFiles` and kept in a bounded cache. The modes read `Unavailable`, as for any pipes execution.
  - A byte subscription pumps the sealed record to its end under the subscriber's credit, then ends `completed`.
  - `stop` answers the filed ending as the receipt of work that has already ended.
  - `summary`, `topology`, `processes` and `listeners` answer absent, as they do for retired work.
  - `ending`, `command`, `commandsAt` and the inventory keep answering off the store.
- **Retiring a released execution.** It removes the directory and writes record `unavailable` and retention `lost`, with the same refusal on a store failure as [[8f8801c5]]. It then leaves the ledger.
- **The budget.** The host keeps released records while their bytes stay within its budget. Past it, it evicts the oldest released first, through the retirement writes.
  - **How the host learns it:** the budget is a control-lane act, `Keep { bytes }`, answered with a report of the budget, the records kept and their bytes. The server hands it on as it hands the pace: when the terminals floor stands, on every operator change, after each replacement, and every 30 s while the host did not answer.
  - **Where the figure lives:** the operator's figure is a Tagma setting with a named default. The default is 256 MiB, provisional until the operator names a figure. At the measured p90 of 8 KiB that holds about 32,000 records, and at the measured maximum of 40 KiB it still holds 6,500.
  - **Before any `Keep` arrives:** a host uses the same default.

## 5. Owners and boundaries

- **`@runlith/executions` protocol:** the `Keep` act and report, the default constant, and the wire version.
- **`@runlith/executions` port:** the `Executions.keep` verb.
- **`@runlith/execution-host`:**
  - the registry releases, keeps the sealed ledger, evicts, and serves released reads, stops and retirements;
  - `host.ts` pumps a sealed record for a byte subscription.
- **Tagma server:**
  - the setting;
  - a holder in `terminals/` that hands the budget on, beside the pace holder;
  - `TerminalExecutions` forwards nothing new.

The server's readers stay unchanged, because every read still goes through the host.

## 6. Rejected alternatives

- **The server reads sealed records itself:** that needs a second read road for `read_output`, the ending notice's tail and the feed. It also collides with work in flight in those files. Asking the host keeps one road.
- **A retirement window counted in live entries:** it keeps output and memory coupled, so host memory still grows with the window.
- **Budget in the execution policy:** a moved figure would make a host replacement due, which ends terminals. An act moves it on the host that stands.
- **Surviving host replacement:** out: its own later decision, because it needs an owner outside the host generation.

## 7. Acceptance criteria

1. **Integration, real registry:**
   - an ended, measured, unread pipes command leaves `list` and is named in `changes` `left`;
   - `read` of it answers the bytes it wrote;
   - a byte subscription delivers them and ends `completed`;
   - `stop` answers its ending;
   - a pty terminal and a `call` stay held;
   - one with an open reader stays until that reader closes.
2. **Eviction:** with a budget smaller than two records, releasing a second record evicts the first. Its `read` then answers as a retired record, and its retention reads `lost`.
3. **`Keep`:** it moves the budget on a standing host and evicts at once when the budget fell below what is kept.
4. **Server:** the holder hands the setting at boot and on change. A unit test covers the report, and an integration test covers a changed setting.
5. **Measured:** after N ended commands on a host, its live map holds only the live ones, and a whole reading costs what is live.
6. **Checks:** typecheck, unit and integration pass for the touched packages.

## 8. Claims and tasks

- **Rewritten:**
  - [[c6d1268a]]: the registry counts live and not-yet-released work;
  - [[77538e54]]: records are no longer held by the registry;
  - [[087640b7]]: a byte read of a released execution is answered;
  - [[e2910415]]: a released record outlives its live entry until eviction;
  - the registry's retirement claims;
  - [[a61e55b1]] and [[d1678b12]], only if the departure wording changes.
- **New claims:** release and its proof, sealed reads, eviction and `Keep`.
- **Tasks:** none opened.

## 9. Order of building

1. The protocol: `Keep`, the default, and the wire version.
2. The sealed ledger, release and its driver in the registry.
3. Sealed reads, stop and retirement of released executions.
4. Eviction.
5. The host dispatch and the sealed pump.
6. The client verb and the port stubs.
7. The server setting and its holder.
8. Tests, claims, review, commit.

## 10. Contract

The wire version moves. It adds `Keep` and its report, and the port gains `keep`. Nothing else in the wire changes shape.

## 11. Stored data

No migration. The ledger is rebuilt at no point, because a host generation starts with no released records. Rows keep their existing columns: a released record reads `available` until it is evicted or retired.

## 12. Who may do what

- `Keep` is the custodian's act, like `Pace`, and recovery is refused it.
- Eviction and release are the host's own and need no caller.
- Retirement keeps its existing authority.

## 13. Long-lived things

- **A released record** lives in the ledger until it is evicted, retired or its generation ends.
- **An open sealed reader** lives in a bounded cache, and eviction closes it.

## 14. Bounded resources

- The sealed bytes stay at or under the budget.
- The ledger holds one entry per released record.
- The sealed-reader cache holds at most a fixed number of open records.

## 15. Rollout

This ships with the parent decision's host replacement. Commands already ended in the replaced generation are gone with it, as today.

## 16. Failures

- **Scope close fails, or the seal is not written:** the execution stays live and is attempted again at its next trigger.
- **A sealed read fails as corrupt or unreadable:** it answers `ReadFailed`, and nothing is evicted by it.
- **An eviction's store write is refused:** the record stays and is tried again at the next release.
- **Concurrency:** release and retirement take the same read fence, so a read admitted before either finishes first.

## 17. Observability

- The `Keep` report names the budget, the records kept and their bytes, and the host status carries the same.
- Host spans: `Host.Keep` and a span per release and per eviction.
