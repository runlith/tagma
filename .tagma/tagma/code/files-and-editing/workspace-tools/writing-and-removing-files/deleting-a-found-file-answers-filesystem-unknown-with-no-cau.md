---
id: 01a15ec4-b364-7b29-bbdf-7c9be2296e2b
title: Deleting a found file answers filesystem Unknown with no cause
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "After glob found the file, delete answered “Cannot resolve …: the filesystem answered Unknown. Nothing was changed.”; no cause or way forward given.",
    "command": "delete({\"path\":\"~/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/com.superset.desktop.sfl4\"})",
    "expected": "Delete the file the operator explicitly named, or give the filesystem refusal's specific cause."
  }
---
Filed from project `runlith`.
