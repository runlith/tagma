---
id: 01a16554-9461-7816-a5b2-349550191a70
title: Chrome screenshot filePath loses access to an unchanged workspace mid-check
ord: 24
tags: ["reflection"]
fields:
  {
    "actual": "Tool answered Access denied: path ... is not within any of the configured workspace roots; earlier in the same thread it saved files both to the checkout and to scratch, then refused both. Without filePath the screenshot returns as an attachment, but there is no path to hand to the report.",
    "command": "mcp__chrome-devtools__take_screenshot with filePath in the working checkout",
    "expected": "Save a screenshot in the working checkout, as the earlier call of the same check did; the call roots never changed."
  }
---
Filed from project `runlith`.

A screenshot with pageId28 first saved successfully into this thread's scratch, the next one there was refused; a temporary write to /opt/workspaces/runlith/cursor-terminal.png worked and was carried into scratch via core write/fromFile. On the final pageId29 /opt/workspaces/runlith/cli-menu-final.png saved, and the next screenshot in the same directory was refused. My own try sits at 6190, Chrome isolatedContext=opencode-cursor-01a1652d; the thread never moved. A screenshot without filePath returned the image successfully with OpenCode 2.1.3 and 1MCP.
