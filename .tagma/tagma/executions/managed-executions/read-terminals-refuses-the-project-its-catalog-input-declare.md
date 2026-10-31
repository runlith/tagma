---
id: 01a19414-3450-7586-b2b1-a1510f6f108c
title: read_terminals refuses the project its catalog input declares, so another project's terminals cannot be listed
ord: 106
tags: ["reflection"]
fields:
  {
    "actual": "Refused body-shape \"Unexpected key project\" at both doors; `tagma op read_terminals … --project runlith` was accepted but silently listed project 5 (tagma) instead.",
    "command": "read_terminals {\"project\":\"runlith\",\"limit\":20}  (MCP tool and `tagma op read_terminals '{\"project\":\"runlith\"}'`)",
    "expected": "Lists the held terminals of project runlith, as the operation's input schema in terminalCatalog.ts:120 declares `project: projectField`."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.

Met while finding which project held two agent-started dev servers. A thread working across projects has no door to list another project's terminals; running the CLI with workdir in the runlith checkout still answered tagma's rows.