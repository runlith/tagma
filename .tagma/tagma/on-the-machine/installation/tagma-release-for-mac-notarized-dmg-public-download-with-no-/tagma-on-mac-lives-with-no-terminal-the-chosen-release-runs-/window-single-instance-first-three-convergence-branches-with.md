---
id: 01a13c9b-c2ea-7084-bac5-d3a69948840d
title: "Window: single instance first, three convergence branches with the chosen release, replacing its own app, \"Move to Applications\", only its own server, \"Quit\" and \"Stop Tagma\", waiting page in words and actions"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae1-7403-aa53-de9c6abb6761",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
---
Window half of [[1c89545b]]: rule 2, "Application" section, waiting page from the "Words" section, "Report a problem" without a server to the extent [[0a20e25b]] gives it.

- `apps/tagma/desktop/src/main.ts`: `requestSingleInstanceLock(additionalData)` — first action after `setName` and `setPath('userData')`; second instance hands its app path over and exits writing nothing; the first applies rule 2 to it.
- Convergence on every connect — three branches by its own app release, `current` and `/health`: older than `current` — replace its app with the copy from `install/<current>/desktop` (directory writable) or open from it (not writable); newer or not installed — `install-from` of its release, human question from its answer, then `restart_server {}`; equal — server not on `current` → `restart_server {}`. One request per divergence, refusal shown; while installing or restarting the window waits. Tagma Dev without a release number — as now. The "older" branch works even when the window's release is already cleaned.
- The window raises the server only if the address is silent and nobody holds the data directory; it opens only a server whose `/health` names its data directory.
- "Move to Applications": copy from `install/<v>/desktop` to `/Applications` (no rights — `~/Applications`), open from there, leave the original alone.
- The window stops calling `settledPlace`, `successorOf`, `bringToStable`, `recordPlace` and the rest from `mac-applications/placement.ts` going away with the server task [[5e37dc34]], and deletes functions nobody else uses. In-place bundle replacement — shared `mac-applications` function.
- "Quit": with no work (agents, terminals, calls — by `read_machine_state`) — server and executions stop with a clean exit; with work running only the window closes. "Stop Tagma" in the app and Dock menus names what will stop, and stops it. Exit on system command — no questions.
- `waitingPage.ts`: states in words and actions with no paths, commands, addresses or "Open http://…" button.

Done: itests of window decisions in a temporary HOME over real functions (first launch from a writable and a read-only place; repeat; move, rename, delete; two copies and second instance; old app, including a cleaned release; new app with an old-release server running — `/health` stub; return and then a copy of the new); "Quit" with no work stops the server, with a running terminal leaves it.
