---
id: 01a13cca-55a0-7b12-a0d5-c78c1fe1ff84
title: The window converges on the chosen release along three branches; install-from of the new release asks about installing, the server card about a new host
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
sources:
  - kind: file
    ref: apps/tagma/desktop/src/placing.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: symbol
    ref: apps/tagma/desktop/src/release.ts
    symbol: branchOf
---
Every issued copy of the window decides for good: the rule it carries cannot be fixed at the person who already has it. So the window has three branches, and the question to the person — whether they came back from this release, whether the move is irreversible, whether the last attempt rolled back — is asked by the new release's `install-from` with its `ask` reply; the window only shows its `said` and repeats the call with `--agreed`. A person's refusal stands until the app is next opened.

- **Branches compare release numbers**, not search the installed releases: an old app whose release was already cleaned out still becomes the app of the chosen one.
- **A window that already ran on the chosen release follows the choice on any divergence.** After “Return”, the open window is newer than `current`, and the “newer installs its own” rule would ask “update again?” right after the press; instead the window becomes the app of the previous release. A just-opened copy newer than `current` installs itself.
- **Becoming the app of the chosen release** means replacing your own app with a copy of `install/<v>/desktop/<name>.app` and reopening in the same place where the person keeps it; where the directory is not writable (DMG disk, translocation, “Applications” without rights) or the app lies inside the release directory, the window opens from the copy. With no copy, the window stays as is. Before replacing, the window verifies the copy's signature (`codesign --verify --deep --strict` of the clone next to the target); on failure the app is untouched, the window speaks in words and offers a report. An interrupted replacement returns from `.outgoing` on the next replacement of the same target.
- **A copy arriving mid-decision** (install, question, server wait) is remembered as the latest and handled after it.
- **Restart** is requested once per “server → `current`” pair and only when the window itself equals `current`; it is not requested during install or handover of the place, a refusal is shown.
- **A new host asks the server, not the window and not `install-from`**: only the running server and its host know whether to accept the candidate. The new release's `install-from` asks that server before switching and answers `held` if the host will not take the release: `current` is not moved, the window shows no refusal, does not install the release again until the next opening, and opens on the working release, where the card asks. If after the refusal the server names the `current` build in `newHost` (`cause: update`), the window shows no refusal and opens on the working release, while the card of that server's surface asks. The window does not ask a server that already names `current` that way for a restart: the decision is handed to the card, its `restart_server {"host": "replace"}` rechecks the host, and an accepting host is handed over without loss, while a repeat from the window would raise a successor while the window waits on the launch page. A server without `newHost` (a release before this contract, whose surface does not know the card) gets the previous refusal display. A window of a release without this branch shows the refusal as a system dialog, including with a server that has `newHost`.
- **A rolled-back attempt** (`install/attempt.json` ended, `current` back on `from`) is reported to the previous release's window once: the attempt key lies in `userData`, otherwise the phrase would pop up on every opening while the record stands. “Retry” installs release `to` from its copy with `--agreed`, and the window follows it. To the window of `to` itself the rollback names the `install-from` question (`reason: failed`). An attempt that left no data keeps `current` on `to`, and only `to` opens the database; the window does not raise a server and offers “Retry” (`to` again with `--agreed`) and “Report a problem”. If its own raised server exited while `current` moved in the meantime (a cold-start rollback), the window decides anew from `current` and raises its server.
- **While the server is busy installing or handing over the place**, the window does not ask for a restart, waits for the end, and decides again.
- **A build with no release number** (Tagma Dev from a checkout) follows the server it reached, opening from a copy without replacing its own app (the operator's fresh build is not overwritten by an old one), and asks for no restart: an agent build without a restart moves `current`, and the window does not restart the operator's server for them.
