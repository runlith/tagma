---
id: 01a14c38-51a1-79f0-a6e6-0a6d3c8bfdcd
title: chrome-devtools MCP tools vanished from the running thread's catalog while the MCP server is connected
ord: 29
tags: ["reflection"]
fields:
  {
    "actual": "«No tool named \"mcp__chrome-devtools__navigate_page\" exists in this run»; ToolSearch answers missing/empty, while read_mcp_servers at the same moment: chrome-devtools [user] [connected, 32 tools]. The browser measurement after the fix had to run as a raw CDP script.",
    "command": "mcp__tagma__mcp__chrome-devtools__navigate_page {pageId: 25, url: …} (this same tool worked in this thread an hour ago); then ToolSearch \"select:mcp__tagma__mcp__chrome-devtools__navigate_page\" and \"+chrome-devtools navigate_page\"",
    "expected": "The call goes to the connected chrome-devtools server; deferred-tool search finds its 32 tools"
  }
---
Filed from project `runlith`.

Thread 01a14bf1-c8af-7caa-9840-1e1ee231c4b7 (graph-open-latency), 2026-10-17 ~23:35Z. Earlier in the same run new_page/navigate_page/evaluate_script/take_snapshot answered normally. The name in the failure lost the `mcp__tagma__` prefix — possibly the run's tool catalog rebuilt after the MCP server reconnected and did not return its tools to the deferred list.
