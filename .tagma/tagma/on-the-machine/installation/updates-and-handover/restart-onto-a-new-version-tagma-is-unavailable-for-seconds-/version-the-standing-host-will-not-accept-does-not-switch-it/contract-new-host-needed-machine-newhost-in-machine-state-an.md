---
id: 01a17d4e-5eb8-77f0-b5a7-c405c1c02c1c
title: "Contract \"new host needed\": `machine.newHost` in machine state and `restart_server {\"host\": \"replace\"}` consent"
ord: 4
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/machineHost.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/machine.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/source.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/machine.ts
---
The window and desktop learn that a new host is needed from `read_machine_state`, and the window also from the `installation.next` feed frame, giving consent with a single `restart_server` act. A server with nothing to say omits the field; the old server does not know it, so it is optional.

The feed frame carries the same `newHost` (one `newHostOf` function) and arrives again whenever it appears, changes, or goes away: on the host's verdict (`MachineHost.staying`), on a refusal remembered by `Succession` (`refusals`), and on every installation frame. `ends` in the frame is measured when `newHost` changed; on such a frame the window shows the card at once and re-reads the machine state for a fresh price. That is how the `standing` card after an attempt where the host is taken past the door ([[9e8adf53]]) arrives without window focus.

**`machine.newHost`** — present only while a new host is needed:

- `cause: 'update'` — a finished installation next to this server (`server.waiting`) was not accepted by the standing host. Appears after a restart refusal onto it (`restart_server` refused `host-unprepared`) or after a `check_successor` refusal asked by the `install-from` of a published release. Lasts while `current` is the same installation, and for a release while `current` still stands where it stood at the refusal, or is already on that release; the refusal and the waiting release survive a server restart in the installation's pending record while the same baseline or that release remains current; pruning keeps the waiting release. `build` is the build of the finished installation.
- `cause: 'standing'` — this server came up under a host of another build that refused its bundle offer (refusal on concession by signal, logic witness gone, signal undeliverable). Registration without a witness before the offer does not lead here: that is also what a host that is only starting looks like. The server has no custody and no terminals: terminal or command start refuses `terminal-host-incompatible`, and the window shows this same card instead of a toast. `build` is this server's build.
- `host` — the build of the standing host (from its registration), `detail` — the reason for the refusal in the server's words, for agents and reports, not for the card.
- `ends` — everything the new host will end, or `null` if the standing host did not answer. Row: `execution`, `incarnation`, `activity`, `title`, `projectId`, `thread`.
  - `activity: 'program'` — a terminal whose foreground program; `title` is its command line from the process table, unless it is the program the terminal was started with — then the terminal's label or command line.
  - `'shell'` — a terminal started by a login shell (`<shell> -l`) whose foreground process is that shell itself: empty, waiting at the prompt.
  - `'command'` — an agent or operator command, and pipe executions the server has no record of.
  - `'unread'` — a terminal whose foreground was not read, or a pty execution without a record; this is how every terminal arrives at `standing`: a server on someone else's host does not speak, and rows come from its store. Live host execution without a record stays in `ends` rather than being lost: the price is never less than what the host will finish. Unread store rows give `ends: null`.
  - `projectId` — the project; the window takes the name from its project list. `thread` — the thread holding the execution or for which it was started; `null` for operator executions.
- `back` (`standing` only) — the id of the `server.next.back` offer: the past installation still lying nearby; `null` when there is none.

**Acts.**

- `Update and end N` (`update`) and `Restart host and end N` (`standing`) — `restart_server {"host": "replace"}`. This is consent to finish the standing host, only if it will not accept the successor: an accepting host is handed over as usual and nothing ends. Otherwise the successor finishes the standing host by the recovery program of its bundle, raises the host of its own bundle, and opens a replacement notification (`host-replaced`) for every thread that held a terminal. A release waiting nearby first becomes current through its own `install-from --new-host`, and only then restarts. N is the length of `ends`.
- `Open <version>` — `install_next {"offer": back, "then": "restart"}`.
- `Later` and the cross send nothing; the state stays in `newHost` until a restart or a `current` change clears it.
- A plain `restart_server {}` at `update` refuses `host-unprepared`: its `unblock` names `restart_server {"host":"replace"}` and the price.
- A terminal that ended with the replaced host: `read_terminal` answers `endedWithHost: true`, and the tab says it ended together with its execution host.

**Published release.** It is installed by an attempt ([[9e8adf53]]), and release `to` does not touch the host before its door. So the `from` side judges the attempt: `install-from` asks its `check_successor` before writing the attempt, and the refusal yields `update` with a release waiting nearby. `standing` with `back` remains where there was nobody to ask: the release's server has no such operation, or the installation ran without a working server.

**Desktop** ([[64da4231]]): when a new application version opens, the window opens on the working release; this same `newHost` asks the question after the failed restart onto it, and `Update and end N` is the same `restart_server {"host": "replace"}`.
