---
id: 01a13046-8cfb-7b1d-9967-8ad71e67498f
title: Chrome screenshots cannot be saved to the caller's own scratch
ord: 28
tags: ["reflection"]
fields:
  {
    "actual": "Access denied: the caller's scratch is outside the configured workspace roots. The screenshot must be saved inside the checkout instead.",
    "command": "mcp__chrome-devtools__take_screenshot({pageId:16,filePath:\"~/.tagma/scratch/01a12f43-f1e3-73f7-8303-704791a8e208/01-cli-modes.png\"})",
    "expected": "Save the screenshot to this thread's announced scratch directory."
  }
---
Filed from project `runlith`.