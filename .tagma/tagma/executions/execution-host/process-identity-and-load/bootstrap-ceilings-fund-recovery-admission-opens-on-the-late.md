---
id: 01a129e5-14e7-79fb-900f-1759e587c6f4
title: Bootstrap ceilings fund recovery; admission opens on the late census
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a129c7-cc4e-72b1-bd45-ffce6245984a
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionCapacity.ts
  - kind: symbol
    ref: packages/execution-host/src/host.ts
    symbol: host
  - kind: symbol
    ref: packages/execution-host/src/host.ts
    symbol: loop
---
The initial profile is capped by the grant and measured kernel limits: an execution already held cannot be refused for the remaining free-fd count before the new logic assembles. After recovery, services assembly and listener initialize replaces these ceilings with the currently measured capacity; only then does admission begin. At the first census the already open native and record handles of recovered executions are subtracted under the same projection the later recount uses: otherwise these fds would be written off twice and the ready logic would declare a profile its handshake cannot carry. fd normalization uses reservations, open record handles and the connection reserve fixed synchronously with the fd snapshot: an adoption finishing or a new connection during globals does not change the deduction retroactively. Late process and PTY globals keep the current population's own deduction. Promised spend at census application stays current; reservations that appeared after the snapshot do not yet count as observed. Initialize that got no positive guarantee for the declared transports refuses as ProfileInvalid and keeps the previous agreed profile instead of publishing an unencodable profile. An early census adds a restart window and does not define the ready profile.
