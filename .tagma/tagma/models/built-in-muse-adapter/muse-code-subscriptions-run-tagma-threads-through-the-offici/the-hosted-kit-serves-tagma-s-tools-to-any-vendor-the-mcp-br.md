---
id: 01a19561-5d97-7ccf-ad30-634933d2f866
title: "The hosted kit serves Tagma's tools to any vendor: the MCP bridge moves out of the Claude runner and also serves over loopback HTTP"
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19560-3243-79c3-b6f8-cebb2a6213d4
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/runner/bridge.ts
  - kind: file
    ref: packages/mcp/src/sdkServer.ts
  - kind: dir
    ref: packages/hosted-runner/src
---
The Claude runner's `Bridge` (`packages/adapter-anthropic/src/runner/bridge.ts`) serves the hosted catalog over MCP and hands each call to the shared `Relay`; only its call-id key (`claudecode/toolUseId`), served-name prefix and relisting are Claude's. Muse Code needs the same bridge reached over `streamableHttp` on 127.0.0.1 (MCP `tools/call` carries `_meta.callId`; Muse lists tools once per host process and ignores `tools/list_changed`). Move the bridge into `@runlith/hosted-runner` with the vendor's call-id reader, prefix and relist behaviour as parameters (a vendor that never relists gets no notification wait), keep Claude's behaviour and tests unchanged, and add serving an `McpServer` over streamable HTTP on loopback with a bearer header to `@runlith/mcp` beside `serveMcpOverStdio`.