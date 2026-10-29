---
id: 01a1320b-f62f-73ae-9099-0b32e7c84a2a
title: "Loader and release channel: sh loader, feed, GitHub code sign-in, install-from, consented update, rollback, window restart, app at a stable path"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13271-3f92-76f6-b305-be3532029f37",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
  - kind: waits-on
    to: 01a1320b-f60e-77ae-8fb0-4e1e6004373e
---
Spec sections "What the user gets", "Loader and release", "Admission", "Irreversible changes and rollback", "Signature before Developer ID" (app path), "Publishing only on the operator's word". To do: `packages/release-loader` (sh script, `package.json` `@runlith/tagma`, tap formula — files, no publishing); unchanged feed contract and `install-from`; "release channel" adapter of the source port; Device Flow GitHub OAuth App (client id a setting, tested against a stub) and fine-grained token as fallback; install (`verifyInstallation`, `cp -c` bun into executions, launcher without touching profiles, `current`, space check); notify and consent in the window and `tagma release update|back|remove|path`; rollback preflight on irreversibility; working window holds its release directory lease and `app.relaunch` into the new one; `~/Applications/Tagma.app` a real directory with replacement via `.Tagma.app.next` — first the app-path trial from the spec on a second user.

Done: local archive and test feed — install, N→N+1 update with server and window restart, reversible rollback and irreversible refusal; app-path trial recorded.
