---
id: 01a0cfe5-850a-709e-81f0-a2a55fbec5dd
title: A foreign CLI's own sub-agent tool and its mid-turn telling stay outside the delegation switch
ord: 11
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0cfe5-01c2-7001-8a4b-b581de1d0e99
---
[[de1d0e99]] governs the spawn tree Tagma owns: `spawn_agent` reached through the collaboration plane. A foreign CLI running as a thread of Tagma (Claude Code, Codex, Grok, Devin, Cursor, Gemini) also carries its own sub-agent tool — Claude Code's Task, for one — which starts agents outside that tree, spends the same operator's quota, and is invisible to the switch.

Two halves are open:

- **Refusing** the CLI's own sub-agent tool while delegation is off. The installed PreToolUse hook already judges permissions for a process holding a thread's grant [[ccced8df]]; it could deny the vendor's sub-agent tool by name. What is unknown: each vendor's tool name and whether its hook sees that call at all.
- **Telling** a foreign CLI mid-turn. The native road is a per-step rule in the kernel's loop, which a foreign CLI does not run; the post-tool hook speaks only when a file was touched today.

What would inform the choice: a measured list of the sub-agent tool names per harness, and whether the post-tool hook can carry a note on a call that touched no file without costing every call a server round trip.
