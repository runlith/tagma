---
id: 01a1a201-d2ee-7b6f-801e-376329b527ca
title: An update from a checkout first runs the steps its project's apps declare, and a step that cannot finish stops it with its reason
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/runner.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/offers.ts
---
## Outcome

An update from a checkout (the installation chip's **Latest commit** and **Working tree**, `tagma update`, `tagma build` through the server, `install_next`) first runs the steps the apps of that checkout's project declare, and only then cuts the source. A repository that must bring something up to date before it is built — a submodule pin moved to its upstream, a generated file regenerated, a lockfile refreshed — does it as part of the same press of Update, and a step that cannot finish stops the update with its reason instead of building a stale source.

Today the update builds HEAD with every submodule at the commit HEAD pins, and nothing can run before that: a pin left behind is built as it stands, and the card shows no sign of it.

## Who declares a step

An app declares it in `tagma-app.json`:

```json
"contributes": { "beforeBuild": [{ "tool": "<tool>", "title": "<what the card shows while it runs>" }] }
```

The server calls the tool itself; it need not be offered to agents in `contributes.tools`. The steps that run are those of the apps enabled in the project whose canonical checkout is the build's source checkout, in the order the apps are listed, each step of one app in declaration order. With no such step the update behaves exactly as today.

Tagma knows nothing of pins or of any particular repository: what a step does is the app's.

## The step's answer

The tool is called with `{ offer: "head" | "tree", checkout: <absolute path> }` and answers one JSON object:

- `{ "verdict": "go" }` — done; the next step runs, then the build.
- `{ "verdict": "pending" }` — still working; the runner asks again. While the app's process lives there is no deadline: the verdict comes from the app, never from a timer.
- `{ "verdict": "stop", "reason": "<one line>", "thread": "<thread id>"? }` — the update ends with nothing built; the card shows the reason and, when named, the thread as a link (for an app that handed the problem to an agent).

A tool error, an answer outside this shape, or the app's process ending before a verdict stops the update with that cause, named as the app's.

## Runner and card

- `checkout-builds` declares a port in its own contract (the steps before a cut, by checkout and offer); composition fills it from enabled apps' `beforeBuild` in every build, so an app declaring the point is accepted by a release server too, where no checkout build ever asks it.
- An enabled app still starting is waited for; one whose process failed stops the update, since whether it declares a step cannot be told; a stopped app has none.
- An ask the MCP request window cut short counts as `pending`.
- A new step `prepare` stands before `worktree` and `build` for `head` and `tree`; `back` runs no steps. The record carries the running step's title; `stop` during `prepare` ends the update with nothing landed, as at any step before the swap.
- The revision the record names, and the HEAD a `head` build cuts, are read after the steps: a commit a step lands is the commit built.
- The card shows the running step's title in place of the build stage while it runs, and a stopped update's reason and thread under the offer that was pressed.
- The direct `bun run tagma:build` stays the bare build entry and runs no steps: there is no server and no app behind it.

## Acceptance

Through the server's install door, with a test app whose step tool is scripted:

1. A step that commits a file answers `go`: the update builds, and the installed revision is the step's commit.
2. A step answering `pending` twice and then `go` is asked three times, and the build follows.
3. A step answering `stop` with a reason and a thread: the update ends without building, and its ended record carries both.
4. The app's process ends before a verdict: the update stops naming the app.
5. No app declares a step: the update's steps and outcome are as today; `back` never calls a step.
