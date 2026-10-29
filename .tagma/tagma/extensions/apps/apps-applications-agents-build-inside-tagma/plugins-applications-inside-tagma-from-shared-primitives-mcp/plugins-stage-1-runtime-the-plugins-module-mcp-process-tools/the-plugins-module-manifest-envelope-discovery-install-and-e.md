---
id: 01a12306-efba-7a0e-94d7-05ecc0602266
title: "The plugins module: manifest envelope, discovery, install and enable, process supervisor, the tools point"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-3158-7283-b07a-914aca49841c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: dir
    ref: apps/tagma/server/src/plugins
---
On the spec's “Manifest”, “Process”, “Where it lies and what it stores”, “Tools and agents” (audience) sections.

- A new server module `plugins` with a #module card: the `plugin.json` envelope in Effect Schema with JSON Schema generation; the contribution-point protocol the points' owners declare (schema, collisions, registration, teardown with disposer); an unknown point is a refusal naming it.
- Two-floor discovery `<project>/.plugins/<id>/` and `~/.tagma/plugins/<id>/`, a machine install record `{id, source, enabled}`, per-project enable, a data folder `~/.tagma/plugin-data/<id>/`.
- Supervisor: one `openMcpSession` per plugin in its own `Scope`, starting at boot and on enable, backoff, typed status and launch diagnostics, restart on a six-step file revision of the spec with no two writers; the process env carries the server address and the `plugin:<id>` caller.
- The `tools` point with `agents`/`own`/`view` audiences; plugin tools do not enter the project's MCP palette.

Done when integration tests show: enabling registers, disabling removes everything, re-enabling after an edit does not duplicate, a crashed process rises, the old process is closed before the new one starts, `own` is invisible to an ordinary agent, `view` to no agent at all.
