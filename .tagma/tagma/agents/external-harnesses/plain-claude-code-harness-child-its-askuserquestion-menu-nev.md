---
id: 01a1471b-345d-7530-9b68-c6c71f4ed21a
title: "Plain Claude Code harness child: its AskUserQuestion menu never reaches the parent, the turn hangs silently"
ord: 161
tags: ["reflection"]
fields:
  {
    "actual": "The parent received nothing — no question, no report, no notice; the child sits in the TUI menu indefinitely. The operator noticed only by looking at the terminal and had to ask the parent whether a question had arrived.",
    "command": "spawn_agent {agentId: \"harness:claude\", project: \"gf-classic\", task: \"Support assets in a currency the data provider has no pair for, converting via USD. …\"} under threads.harnessProfile claude {plain: true, permissionMode: \"auto\"}; the CLI opened its AskUserQuestion menu (\"Missing pair\", 4 options)",
    "expected": "The CLI's question reaches the spawning agent (as a question or a report naming it), so the parent can answer or relay it; at least the parent learns the child is waiting on a question."
  }
---
Filed from project `runlith`.

Thread c9 01a14716-72c1-7307-b6b7-5268ce972e5d (project gf-classic, 38), parent 01a125fe-9260-7644-9a64-589c9bc19e19. The harness profile text says permission screens of the CLI stand as questions to the parent in a non-bypass permissionMode; the CLI's own AskUserQuestion tool is not a permission screen and is apparently not relayed at all. In the Exp3 A/B run this stalls the Claude Code side of task 9 with no signal.