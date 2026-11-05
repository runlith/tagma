---
id: 01a1a201-d2ee-7b6f-801e-376329b527ca
title: An update from a checkout first runs the steps its project's plugins declare, and a step that cannot finish stops it with its reason
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/offers.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/runner.ts
---
## Outcome

An update from a checkout (the installation chip's **Latest commit** and **Working tree**, `tagma update`, `tagma build` through the server, `install_next`) first runs the steps the plugins of that checkout's project declare, and only then cuts the source. A repository that must bring something up to date before it is built — a submodule pin moved to its upstream, a generated file regenerated, a lockfile refreshed — does it as part of the same press of Update, and a step that cannot finish stops the update with its reason instead of building a stale source.

Today the update builds HEAD with every submodule at the commit HEAD pins, and nothing can run before that: a pin left behind is built as it stands, and the card shows no sign of it.

## Who declares a step

A plugin in Tagma's format declares it in `tagma-plugin.json`:

```json
"contributes": { "beforeBuild": [{ "tool": "<tool>", "title": "<what the card shows while it runs>" }] }
```

The server calls the tool itself: it stands in `contributes.tools` with audience `tagma`, which offers it to no agent or view. The steps that run are those of the plugins enabled in the project whose canonical checkout is the build's source checkout, in the order the plugins are listed, each step of one plugin in declaration order. With no such step the update behaves exactly as today.

Tagma knows nothing of pins or of any particular repository: what a step does is the plugin's.

## The step's answer

The tool is called with `{ offer: "head" | "tree", checkout: <absolute path> }` and answers one JSON object:

- `{ "verdict": "go" }` — done; the next step runs, then the build.
- `{ "verdict": "pending" }` — still working; the runner asks again. While the plugin's process lives there is no deadline: the verdict comes from the plugin, never from a timer.
- `{ "verdict": "stop", "reason": "<one line>", "thread": "<thread id>"? }` — the update ends with nothing built; the card shows the reason and, when named, the thread as a link (for a plugin that handed the problem to an agent).

A tool error, an answer outside this shape, or the plugin's process ending before a verdict stops the update with that cause, named as the plugin's.

## Runner and card

- `checkout-builds` declares a port in its own contract (the steps before a cut, by checkout and offer); composition fills it from enabled plugins' `beforeBuild` in every build, so a plugin declaring the point is accepted by a release server too, where no checkout build ever asks it.
- An enabled plugin not yet taken up or still starting is waited for; one whose process failed stops the update, since whether it declares a step cannot be told; an idle plugin's step opens its process; a stopped plugin has none.
- An ask the MCP request window cut short counts as `pending`.
- A new step `prepare` stands before `worktree` and `build` for `head` and `tree`; `back` runs no steps. The record carries the running step's title; `stop` during `prepare` ends the update with nothing landed, as at any step before the swap.
- The revision the record names, and the HEAD a `head` build cuts, are read after the steps: a commit a step lands is the commit built.
- The card shows the running step's title in place of the build stage while it runs, and a stopped update's reason and thread under the offer that was pressed.
- The direct `bun run tagma:build` stays the bare build entry and runs no steps: there is no server and no plugin behind it.

## Acceptance

Through the server's install door, with a test plugin whose step tool is scripted:

1. A step that commits a file answers `go`: the update builds, and the installed revision is the step's commit.
2. A step answering `pending` twice and then `go` is asked three times, and the build follows.
3. A step answering `stop` with a reason and a thread: the update ends without building, and its ended record carries both.
4. The plugin's process ends before a verdict: the update stops naming the plugin.
5. No plugin declares a step: the update's steps and outcome are as today; `back` never calls a step.
