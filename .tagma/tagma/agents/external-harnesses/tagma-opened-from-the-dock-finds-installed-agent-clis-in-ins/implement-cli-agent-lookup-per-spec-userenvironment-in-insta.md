---
id: 01a13c14-5054-78fd-b5e0-9f25782aed8c
title: "Implement CLI agent lookup per spec: UserEnvironment in installation with a macOS adapter, program resolution in InstalledHarnesses, every launch place through one place, settle with no forced write"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b8f-9bf0-7fc0-b610-34979fbff541",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13bf9-2f15-7d9a-aca2-21a02aa569ba
---
Implement [[2aa569ba]] whole. Start with `installation/process/loginPath.ts` and `composition/server.ts:183-189`, then `external-harnesses/birth/installed.ts` and the launch sites from the spec. Done: the tests from the spec's "Proven by" section pass, manual check without a server finds the operator's CLIs at the system PATH with `SHELL=/usr/bin/false`, the change is committed.
