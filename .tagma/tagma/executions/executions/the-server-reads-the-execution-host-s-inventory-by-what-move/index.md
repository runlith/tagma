---
id: 01a0daed-272b-7161-a432-d9dace85472c
title: The server reads the execution host's inventory by what moved since its last reading, and the host answers every listing from an ordered index
ord: 33
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/terminals/TerminalInventory.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
  - kind: symbol
    ref: packages/execution-host/src/registry/inventory.ts
    symbol: inventory
---
## 1. Outcome

The server keeps its picture of what the execution host holds by reading only what moved since its last reading, and the host answers every listing from an ordered index. The cost of an inventory reading follows the number of executions that moved, not the number the host retains. A quiet host is not read. The picture is complete: no page cap drops executions, running ones included. A command's ending reaches its waiting reader without a host backlog built by inventory walks.

The ended-execution lifecycle — ended work leaving the host's live map, with its output kept under a byte budget — is the child decision [[7ca1d85e]].

## 2. Problem and evidence

Measured on installation `01a083b0…`, 2026-09-25:
- **Server cost, 22:40–23:00 (host incarnation 52):**
  - 45,817 `TerminalInventory.walk.page` spans, p50 ≤32 ms. Their summed duration was about 1,544 s inside the 1,200 s window, so the cell walked back to back.
  - 164 disposition passes, each walking the whole host through `Terminals.hostInventory` (p50 ≤2 s, 352 s in total).
- **Host cost:** `Host.List` ran 134,543 times per hour, about 1,984 s of span time per hour. The host used about 74% of a core, with 150–200 ms stalls about once a second, and stood at 1.3–1.5 GB RSS.
- **Why a walk costs what is retained:** `ExecutionRegistry.list` copies and sorts every held execution on every page, and finds its cursor with a linear `findIndex`. Every transition — admission, spawn, exit, retirement, a deadline revision — makes the cell walk every page again. The disposition pass walks everything every 5 s whether anything moved or not.
- **What the host retains:** nothing ever retires an ended command. Its record is what `read_output` reads, so incarnation 52 kept 6,664 ended commands in its live map. Its 8,850 internal rows are stored facts of calls whose callers retired them: in incarnation 53 every ended internal row reads `record_availability = unavailable`.
- **Correctness:**
  - The page is ordered by random execution id, so past `HOST_INVENTORY_PAGES` × `INVENTORY_PAGE` (10,000) the cell keeps an arbitrary subset, running executions included.
  - A cursor whose row was retired between two pages makes `findIndex` answer −1, and the next page restarts at the first row.
  - The disposition pass stamps every current-generation row absent from the walk as retired. A command that has been accepted but whose child has not joined the live map is absent too, so a pass landing in that window discharges a waiting command as retired.

## 3. What holds now

Checked against the code:
- `TerminalInventory` walks all pages on every transition, gap or invalidation, and re-reads only the listener inventory on a sampling round ([[90662939]]). A walk that does not reach its end is not counted as whole, so the next update walks again.
- `Terminals.disposition` walks the whole host every `executionHandshakeMs` (5 s), stamps absent rows only after a whole walk, and re-measures ended rows ([[1c65a937]]).
- A terminal listing joins its stored rows to the cell at read time and never waits on the host ([[a4598f8c]]). The cell's one subscription feeds every reader of command changes ([[27d30ac6]]).
- `hostReplacement` walks the listing to its end to count running work ([[77538e54]]).
- The inventory revision moves on admission, leaving the queue, joining the live map, exit, retirement, deadline revisions and pace ([[09ac742a]]). It does not move on stream endings or cleanup grading.

## 4. Target model

**The host keeps an ordered index and a change journal.** One owner, `Holdings` (`packages/execution-host/src/Holdings.ts`), holds the live map, the ids in sorted order, and the journal.
- **Listing:** `list(after, limit)` locates its start by binary search and builds only the page's rows. A cursor whose row has left still resolves to the next id after it.
- **Stamps:** every write of an execution's projected state stamps it — joining the live map, a stream ending, the exit, the graded cleanup — and so does a deadline revision. A departure (retirement, and the child decision's release) is stamped with its id.
  - A stamp taken with an inventory transition carries the revision that transition moved to.
  - A state write that moves no revision is stamped at the next revision, so the next reading finds it whether it is taken before or after that revision moves.
- **`Changes { since, limit }`** answers one of:
  - `Changed { revision, executions, left }`: the current summary of every held execution stamped after `since`, and every execution whose departure was stamped after `since`.
  - `Reset { revision, reason, detail }`, for three reasons:
    - `horizon`: `since` precedes the oldest departure kept;
    - `ahead`: `since` is past this host's revision;
    - `overflow`: more than `limit` executions moved.
- **Bounds:** departures are kept up to 4,096, and the horizon rises as older ones are dropped. The journal is read together with the revision, so no change can fall between them.

**The server keeps a mirror.** `TerminalInventory` holds every summary the host reported, keyed by execution id, and the revision the mirror stands at.
- **When it is read:**
  - At every (re)subscription of the inventory feed, the mirror is read whole by walking `List` pages to the end, with no page cap.
  - A `Moved` at another revision, a `Gap` or an invalidation costs one `Changes` read. A `Reset`, or a failed read, falls back to a whole reading.
  - A sampling round at the same revision reads only the listener inventory, and only while a project holds a cell.
- **Who reads it:** it is kept whether or not a project holds a cell, because the disposition pass reads it too. Cells are drawn from the mirror as the walk's summaries were. `walk` and `Terminals.hostInventory` are removed.

**The disposition pass never walks.**
- **Before it looks:** it reads the rows, then brings the mirror up to date with one `Changes` read, so every execution the host held when the rows were read is in it.
- **Rows the mirror holds as ended** are re-measured and discharged as today.
- **A current-generation row the mirror does not hold** is asked for its ending (`ending(ref, true)`, which the host answers off its store for work it no longer holds):
  - a receipt discharges it through the same road as an ended row;
  - no receipt on a command row is checked by reference (`commandsAt`), and a command the host reports queued, reserved, starting or running stands;
  - anything else is stamped as retired, as today.
- **When the mirror is not whole:** nothing absent is stamped, as today when the walk was not whole.

**`hostReplacement`** keeps walking `List` to its end. That road is rare, and the index makes each page cost the page.

## 5. Owners and boundaries

- **`@runlith/executions` protocol** (`protocol/wire.ts`, `protocol/runtime.ts`): the `Changes` request, the `InventoryChanges` answer, and the wire version.
- **`@runlith/executions` port** (`Executions.ts`, `ExecutionClient.ts`): the port verb `changes(since, limit)`.
- **`@runlith/execution-host`:**
  - `Holdings.ts` owns the index and the journal;
  - `ExecutionRegistry.ts` stamps at every state write and departure, and answers `list` and `changes` through `Holdings`;
  - `host.ts` dispatches `Changes`, which recovery may call.
- **Tagma server `terminals/`:**
  - `TerminalInventory.ts` owns the mirror;
  - `Terminals.ts` runs a disposition over the mirror;
  - `TerminalExecutions.ts` withholds `changes` from the managed world, as it withholds `list`.
- **Unchanged:** the command feed and `CommandReader` keep reading the admitted-command inventory. They read the cell's update stream only.

## 6. Rejected alternatives

- **Raising `HOST_INVENTORY_PAGES`, or throttling, debouncing or caching the walk at the reader:** the operator ruled these out. They move the cost without removing it.
- **By-reference state reads per listing page:** every listing would wait on the host, which [[a4598f8c]] refuses. The disposition pass would still need a whole picture to call anything retired.
- **Moving the revision on every summary change** (input frontier, stream positions): every inventory subscriber would be woken per keystroke or chunk, which is the per-byte feed [[97958aab]] exists to avoid. Stamping at the next revision gives the mirror those state writes without a wake.
- **A continuation cursor in `Changes`:** between two readings, the executions that moved number a handful. An answer past `limit` is rarer than a reset, and a whole reading of an indexed host costs its held count once.

## 7. Acceptance criteria

1. **Unit, `Holdings`:**
   - a `changes` read after k moves over 100,000 held executions costs no more than 10× the same read over 100;
   - a listing page over 100,000 costs no more than 10× one over 100;
   - a walk over 20,000 executions answers every id exactly once, including when the row a cursor names departed between pages;
   - a departure beyond the kept bound answers `Reset horizon`, and a state write that moved no revision is found by the next reading.
2. **Unit, `TerminalInventory`:**
   - after the first whole reading, each transition costs one `Changes` read and no `List` page, whatever the mirror holds;
   - rounds at the same revision read nothing from the inventory;
   - a `Reset` or a failed read walks whole once;
   - a mirror over 12,000 executions holds all of them.
3. **Integration, disposition:** a pass makes no `List` call. It discharges an ended row whose execution left the mirror, through its filed ending. It leaves a command the host reports queued standing, and stamps a row the host holds nothing under.
4. **Integration, real registry:** `changes` answers an execution that joined and one that ended, names a retired one in `left`, and answers `Reset` below the horizon, within the integration budget.
5. **Wire:** the wire test's version and frame fingerprint move together.
6. **Checks:** typecheck, unit and integration pass for `@runlith/executions`, `@runlith/execution-host` and the Tagma server.
7. **Measured before and after:** a bench over a host holding 10,000 ended executions reports the cost of the inventory reads one transition triggers under the old walk and the new `Changes` read. The live installation's readings — `Host.List` rate and total, host CPU and stalls, `TerminalInventory.walk.page` rate, `CommandReader.batched`, and host ending → `read_output` latency — are re-read after deployment.

## 8. Claims and tasks

- **Rewritten from the code:**
  - [[90662939]]: the cell reads changes, not walks;
  - [[1c65a937]]: the disposition reads the mirror, filed endings and command rows by reference;
  - [[27d30ac6]]: one subscription, and the mirror is kept whether or not a cell exists;
  - [[09ac742a]]: the stamping, where it names what the revision moves on.
- **Re-read:** [[0d9a2607]] (the cursor still names the last row carried) and [[77538e54]] (the walk to the end stands).
- **New claims:** the ordered listing and its cursor; the journal's stamps, horizon and `Reset`; the mirror's reading rule.
- **Tasks:** none opened, and no open task names this code.

## 9. Order of building

1. Protocol: request, answer, port verb and wire version.
2. `Holdings`, with its unit tests.
3. The registry's stamps, `list` and `changes`, and the host dispatch, with the integration test.
4. The client verb, and the port stubs in the server's suites.
5. The mirror in `TerminalInventory`.
6. The disposition over the mirror.
7. Bench, claims, review, commit.
8. The child decision on ended executions.

## 10. Contract

- **Version:** the wire moves from 30 to 31, adding `Changes` / `InventoryChanges`, and the port gains `changes`.
- **Compatibility:** there is none across the bump. A server at 31 does not adopt a standing host at 30, and a host at 31 refuses a client at 30.
- **Unchanged:** `List`'s shape and its exclusive cursor stay as they are.

## 11. Stored data

out: the index, the journal and the mirror live in process memory and are rebuilt with each host generation and server start. Nothing is migrated.

## 12. Who may do what

- `Changes` is an observation, admitted to the custodian and recovery roles like `List`. It starts, ends and grants nothing (61e25fce).
- The managed world's product port withholds it as it withholds `list`.

## 13. Long-lived things

- **The journal** lives with the registry. It holds one entry per held execution and at most 4,096 departures, and an entry leaves when its execution departs.
- **The mirror** lives with the server's terminals floor. It is re-read whole at every feed (re)start, and a departed id leaves it at the reading that names it.

## 14. Bounded resources

- A `Changes` answer carries at most `limit` summaries; the server asks with `INVENTORY_PAGE` (200). Past that, the answer is `Reset overflow`.
- `List` pages stay at 200 rows.
- Journal memory follows held executions plus 4,096 departures, and mirror memory follows held executions. The child decision bounds the latter by live work.

## 15. Rollout

- **Deployment:** the new server and the new host ship together. A standing host at wire 30 is not adopted, so the operator replaces the execution host, which ends the terminals and commands it holds.
- **What running work sees:** nothing beyond that replacement. Readers of the terminal listing and command changes see the same updates.

## 16. Failures

- **Connection or feed lost:** the feed ends, the mirror stops counting as whole, and it is read whole at resubscription. Until then the disposition pass stamps nothing absent.
- **A failed `Changes` or page read:** it leaves the mirror behind. The next `Moved`, `Gap`, invalidation or sampling round reads again, as a walk that failed did before.
- **Concurrent acts:** a move landing while an answer is built is stamped past the answered revision and is found by the next reading.
- **Host replacement:** a new generation starts a new feed, so a whole reading follows.

## 17. Observability

- **Server spans:** `TerminalInventory.changes` per reading, and `TerminalInventory.walk.page` only on whole readings.
- **Host span:** `Host.Changes`.
- **After deployment:** `walk.page` falls to near zero, and `Host.List` falls to whole readings, host replacements and reports.
- **Bench:** it states the before and after cost of one transition over a host holding 10,000 ended executions.
