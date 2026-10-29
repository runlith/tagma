---
id: 01a15aa5-4b6e-73a5-8dd8-884da4215e69
title: A project leaves Tagma with one action in the project menu, deleting nothing on disk, and returns with its graph and threads when added again
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15aa5-75e3-7907-ae43-c06db549dea7",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/registration.ts
---
Right now a project cannot be removed: the app never calls `remove_project`, and the operation itself refuses `project-not-empty` while the project has live blocks, threads or root bindings (`RemovalHold` in `projects/registration.ts`: holders of graph, threads, workspace). The user would have to destroy the graph and threads to drop the project from the list.

The operator's decision: "remove from Tagma" works like removing a project from an IDE. The project leaves the list with no preconditions; nothing is deleted from disk — neither the repository, nor the graph (the team project's `.tagma`, the stealth project's shadow git, the plain graph), nor the thread journals. The same repository, added again, returns with its graph and threads. Threads and other machine data are currently keyed by project id (journals in `threads/<projectId>/`) — a new id on re-registration must not lose them.

To do: the removal and re-adding model in the server (what the machine database forgets, what stays, and how it is recognized on return), a "Remove from Tagma" item in the app project menu, and the `project-not-empty` refusal removed with its reason. Other projects' edges into its graph behave as they do now under `remove_project` — "not on this machine".

Proof: a test through public operations — a project with blocks and a thread is removed, files in place, re-adding the same root returns the same blocks and thread; UI check on tagma:try; landed commit.
