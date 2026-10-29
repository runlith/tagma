---
id: 01a13c9b-dc32-7bc0-b0f3-020661930775
title: "Proving the 0.1.0 transition on real builds: own button and opening the new app, sound and terminals after it"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d05-c25f-7fb7-be3d-aa674a1f043f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
  - kind: waits-on
    to: 01a13c9b-6e47-7eb9-82e5-4f3e5e37dc34
  - kind: waits-on
    to: 01a13c9b-c2ea-7084-bac5-d3a69948840d
---
Main proof of [[1c89545b]], "Moving from 0.1.0". The archive of the issued 0.1.x release (in `~/.tagma-dev/release` now lies `tagma-0.1.1-darwin-arm64.tar.gz` — its window is the same as 0.1.0's) in a temporary HOME (own instance, free-block ports, as `installation/cut/trial.ts`) updates to the current build two ways: (a) with its own button through a `file:` feed (`install_next` with restart), (b) by opening the new app — the window's decisions over the same HOME. After each: `/health` names the new release, `current` is the new one, sound `present` with the helper's hello `--synthetic`, the terminal opened before the update alive. The trial release run (`trial.ts`) gets the same N→N+1 step and the helper hello. Frozen 0.1.x window paths run through their real functions (`settledPlace`, `successorOf`, `bringToStable` from the archive): "Update" with the 0.1.x window open and "Not Now" followed by launching the 0.1.x app — after them the copy of `install/<N>/desktop/Tagma.app` in place (or returned by the new window), sound `present`.

Done: both paths pass in a repeatable run; what could not be checked without an Electron window is named.

**Result** (`bun run tagma:transition`, HEAD slice 5e2b35fc94, 0.1.1 → 0.1.2 of this tree; commits ed1a82d4a0, 85d36e5109, 625c67aec7, 5e2b35fc94). All three worlds passed: cut trial run, "Update" with the 0.1.x window open, new app beside a 0.1.1 server and then "Not Now". After each `/health` and `current` name 0.1.2, the app copy lies in the release directory, sound `present` from the helper started from that copy. Beside the terminal on pipes a pty terminal opens printing `beat <n> <time>` five times a second. After the transition both `running`, and the pty record reads from zero with no `gap` and no skipped number through the last seconds' beats: 80, 186 and 191 beats. Right after the new server's door, terminal reads answer `terminal-host-unavailable-*` for 2–3 s while the new server has not yet taken over the execution host (one measurement), so the check first waits until the terminal reads again.
