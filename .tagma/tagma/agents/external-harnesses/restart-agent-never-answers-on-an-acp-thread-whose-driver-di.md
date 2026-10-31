---
id: 01a19298-4fa4-74c7-be00-c13de8b1ef43
title: Restart agent never answers on an ACP thread whose driver died; it must replace the process from any state
ord: 208
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
Seen 2026-10-31 on thread 01a191db after its ACP drive died with `WireUnavailable` (session `stopping`, runner execution 8bccf3e3 still running, row failure set, no turns): the operator pressed Restart agent and the menu stays "Restarting agent…" — `restart_thread` never returns, no HTTP response was logged. Restart (`ThreadAggregate.restart`, release = `ProtocolAttendance.stop` on ACP) exists exactly to recover an agent from an unknown breakage, so it must end the old process and stand up a new one whatever state the driver, session facet or row are in; a stop step that cannot settle is already bounded by `RESTART_PATIENCE`, so the hang is in a later step.