---
id: 01a14699-07ec-7583-89e6-90a88c28050f
title: Swift inline source wrongly read as a file path
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "The command completed, then Tagma tried to stat the path `/opt/workspaces/<project>/import Foundation; let re=...` and printed `the files this command printed could not be told apart ... Unknown: FileSystem.stat`. The Swift source text wrongly entered the read-files analysis.",
    "command": "node -e 'for(const s of [\"gpt-5\\n\",\"gpt-5.٦\",\"gpt-5-chat\\u0301\",\"gpt-4\\u0301\"]) console.log(JSON.stringify(s),/^gpt-(\\d+)(?:\\.(\\d+))?(?:-(.+))?$/.exec(s)?.slice(1),s.startsWith(\"gpt-4\"),s.slice(6).startsWith(\"chat\"));'; swift -j 1 -e 'import Foundation; let re=try! NSRegularExpression(pattern:\"^gpt-(\\\\d+)(?:\\\\.(\\\\d+))?(?:-(.+))?$\"); for s in [\"gpt-5\\n\",\"gpt-5.٦\",\"gpt-5-chat\\u{301}\",\"gpt-4\\u{301}\"] { print(s.debugDescription,re.firstMatch(in:s,range:NSRange(s.startIndex...,in:s)) != nil,s.hasPrefix(\"gpt-4\"),String(s.dropFirst(6)).hasPrefix(\"chat\")) }'",
    "expected": "The command performs a read-only JavaScript-vs-Swift comparison; the inline `-e` argument is not a file name."
  }
---
Filed from another project.
