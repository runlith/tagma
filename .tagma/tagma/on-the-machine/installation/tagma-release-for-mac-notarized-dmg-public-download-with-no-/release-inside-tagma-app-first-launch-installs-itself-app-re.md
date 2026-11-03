---
id: 01a135f8-f7eb-72c1-88c2-519c95ac7fc3
title: "Release inside Tagma.app: first launch installs itself, app replaced in place, \"Install tagma command\" button, DMG"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a135ff-0787-74bd-8eb8-f870c5e90b88",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
  - kind: waits-on
    to: 01a135f8-f7eb-72c1-88c2-519be2abbfcc
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
Step 2 of the spec, sections "Release is a signed `Tagma.app`" and "Channel contract". The pipeline puts the release in `Contents/Resources/release`; update archive and DMG carry one app. `install-from` clones release into `~/.tagma/install/<release>`. A window without its release's `current` installs it on first launch. Update puts `.Tagma.app.next` beside the app wherever it stands and swaps on window restart, under a lock; an unwritable directory refuses before downloading. The window button does what `tagma release path` does. First the app-place trial from the spec.

Done: under a second macOS user DMG → first launch offline → server and window; repeat launch installs nothing; N→N+1 update from a `file:` feed replaces the app in `/Applications` and moves the server; rollback works.
