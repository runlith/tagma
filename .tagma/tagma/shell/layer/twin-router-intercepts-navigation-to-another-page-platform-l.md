---
id: 01a130d4-622e-7783-8bab-80b79d04c9cc
title: "Twin: Router intercepts navigation to another page, Platform.leave reports the leave outcome"
ord: 41
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: packages/layer/src
---
Twin of the twin package's mechanisms, carried into `@runlith/layer` in its names and model (twin rule):
- `Router.intercept(take)`: the owner gets every client navigation to another path (link, "back", `goto`); a `router.replace` of the same page is not intercepted. Leaving is separated from arriving: kit navigation is cancelled, for `popstate` the leave waits for kit's compensating `history.go` and then runs once. Registries live on the Router instance, the `beforeNavigate` hook lives with the mount.
- `Platform.leave` returns the leave's outcome (`left`/`stayed`): `pagehide` → left; `navigateerror` or the document in place after a timeout → stayed; on `stayed` what leave listeners wrote is rolled back.
Done: tests — intercept to another path but not `replace`; Back with history compensation; mount→unmount→mount; rollback only on `stayed`.
