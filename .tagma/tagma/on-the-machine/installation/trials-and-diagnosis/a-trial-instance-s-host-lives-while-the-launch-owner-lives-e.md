---
id: 01a136b1-d78a-7f67-9c39-85f61d5d6619
title: "\"A trial instance's host lives while the launch owner lives: EOF on its stdin pipe takes the host away with everything it holds\""
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13699-a210-7d07-bc71-da6f2276ac62
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/staying.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/launch.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/lifetime.ts
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/output.rs
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/boot.ts
    symbol: raiseHost
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/offer.ts
    symbol: sweepBoots
  - kind: symbol
    ref: packages/execution-host/native/holder/src/holder.rs
    symbol: end_held
---
The launch owner (`ServerLaunch` — for `tagma:try`, its terminal) holds one pipe for its whole life and hands its reading end to stdin of every server it spawns, successors and a returned predecessor too. A server under such an owner raises the holder with `stdin: inherit` and writes `lifetime: with-parent` into the boot input; the holder passes stdin to the logic, and on EOF the `with-parent` logic vacates: it stops executions, the holder leaves. EOF arrives when the writing end is closed: the owner closes it when it has no server left (a stop, `--stop`, a server death with no successor), and the kernel closes it when the owner is killed. So the host outlives Succession and leaves together with the instance, with no outside sweeper.

- **Why the owner's pipe, not the server's.** Bun closes the pipe given by `Bun.spawn({ stdin: 'pipe' })` when the child exits: the first server's host would get EOF on the very first restart. A FIFO does not fit either: on macOS Bun sees no EOF on a FIFO in either `Bun.stdin.stream()` or `process.stdin` (kqueue). So the pipe is made with `pipe(2)` through FFI, both ends close-on-exec: the writing end must reach no child process, otherwise EOF never arrives.
- **Diagnostics never pin the host to the server.** Every attempt has its own `.stderr` file and its own fd; stdout and stderr inside an attempt may share it. The holder reads the logic's output pipe in its own loop, and the writer itself bounds the file: a server leaving never breaks the channel and never leaves an unbounded log. The file limit equals the refusal tail limit; no full output history is kept. A refusal after the holder's actual exit carries that tail and path. An inherited flock keeps the file while the attempt has an owner, and the next placement removes free `.stderr` files next to stale boot entries. The short tail rewrite is serialized separately from the lease: the lease is held for the attempt's whole life and does not fit mutual exclusion of its writers, including the holder's probe launch.
- **The mark is the launch itself.** `with-parent` declares a server that has `connectLaunch`; a standalone server with no owner raises the host detached, as before: it outlives the server and the next start takes it.
- **The boot input is compared whole.** `lifetime` joins the `bootInput` of every path — raising, the successor candidate, activation — otherwise the same owner's successor would take the standing host's input for someone else's.
- **The holder finishes what the logic never released.** After vacate the `with-parent` logic always sends the holder `vacate`, even when its shutdown stayed incomplete (surviving descendants, unaccepted executions). A holder told `vacate`, once the logic is gone, kills the group and every remaining entry's leader, removes them and exits instead of raising new logic: otherwise every next logic would see EOF at once, again fail to release an entry, and the holder would restart it in circles. Logic that cannot boot at all after the owner left stays on the holder's previous restart pause: the holder never notices that case itself.
- **`tagma:try` awaits the host's departure.** `--stop` and launching over a standing instance answer only after every `executions/*` writer claim is free (`hostsStaying`) — otherwise the new server would adopt a host about to leave. While a live process holds the claim, the wait runs as long as it takes; the `host-stayed` refusal comes only when the claim release cannot be observed (`Unmeasured`), with that reason.
