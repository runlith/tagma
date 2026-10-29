---
id: 01a14d00-abe1-7b98-b2e3-bc989622c241
title: The server's watcher under ServerLaunch holds the launch owner's stdin and survives a server swap
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c68-7623-7729-b5a2-06de5b5f4e6b
sources:
  - kind: file
    ref: packages/watch/src/client.ts
---
Every server under ServerLaunch, installed or tagma:try, took a `with-parent` watcher with a pipe from the server itself. Such a watcher died on every restart, and the root-change record never survived a server swap. Now `with-parent` inherits the server's stdin — the launch owner's pipe, as the execution host does — and leaves with the owner; `with-client` (tests) keeps its own pipe. Proof: on tagma:try the watcher pid is the same before and after `restart_server`.
