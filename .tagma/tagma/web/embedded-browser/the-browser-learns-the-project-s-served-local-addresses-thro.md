---
id: 01a182f9-ab52-7cc8-bff6-40f0da9536d3
title: The browser learns the project's served local addresses through a port the executions layer fills
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/served.ts
---
The executions module already imports the browser (terminal links open as pages), so the browser reading `CommandActivity` itself would close an import cycle. The browser declares `ServedAddresses` with only what the address bar needs, and the executions layer fills it from its live process lines. Only sockets of held terminals carry ports, and only loopback binds become addresses (`portUrl`): a port bound to a LAN address has no URL the panel can open on this machine.
