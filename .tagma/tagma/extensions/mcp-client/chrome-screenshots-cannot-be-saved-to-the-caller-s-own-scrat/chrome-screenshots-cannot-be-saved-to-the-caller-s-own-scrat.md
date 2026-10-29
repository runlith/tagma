---
id: 01a13049-4770-7082-b68b-b82111ab143e
title: Chrome screenshots cannot be saved to the caller's own scratch
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The checkout root is refused too. Omitting filePath returns an image pinned in the thread's attachments; write(fromFile) can copy that image to scratch.",
    "command": "mcp__chrome-devtools__take_screenshot({pageId:16,filePath:\"/opt/workspaces/runlith/.tmp/account-modes-01-cli.png\"})",
    "expected": "Save the screenshot inside the configured checkout root."
  }
---
Filed from project `runlith`.