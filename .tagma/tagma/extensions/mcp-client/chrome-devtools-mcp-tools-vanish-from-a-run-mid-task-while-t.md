---
id: 01a15063-6fba-7825-b987-3cf539796dd6
title: chrome-devtools MCP tools vanish from a run mid-task while the server reads connected
ord: 25
tags: ["reflection"]
fields:
  {
    "actual": "Refused: No tool named \"mcp__chrome-devtools__navigate_page\" exists in this run; tool_search select: answers it as missing; read_mcp_servers still says connected, 32 tools",
    "command": "mcp__tagma__mcp__chrome-devtools__navigate_page {pageId:5, type:\"url\", url:\"http://localhost:48251/...\"} (after a bash call ended \"The agent harness was disposed\")",
    "expected": "The chrome-devtools tools used earlier in the same task stay callable while read_mcp_servers reports chrome-devtools connected with 32 tools"
  }
---
Filed from project `runlith`.

Earlier in the same thread new_page, navigate_page (with initScript), evaluate_script, take_screenshot and list_console_messages all worked. Then a `bun run typecheck` call came back `cancelled` with reason "The agent harness was disposed"; from the following run on, every chrome-devtools tool is unknown to the run and ToolSearch lists them under `missing` (names without the `mcp__tagma__` prefix). The browser check of the built demo had to be redone by a hand-written CDP script over a headless Chrome.