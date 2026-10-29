---
id: 01a14ad8-c204-74cf-8dba-efe8621f79f0
title: publish_artifact reports a new version, but the artifact URL keeps serving the first one
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "Answered status published, version 20261017T170810884Z, versions 2, yet curl on the URL (Cache-Control: no-store) returns the first version, 18392 bytes, h1 «Писатели, до которых можно дойти»; the operator saw the old page and took it as the agent ignoring his correction",
    "command": "publish_artifact {path: \"~/.tagma-dev/scratch/01a14ac9-fd71-7bf7-86d9-805862f6ffd9/holder-links.html\"} (second publish of the same path)",
    "expected": "http://localhost:5634/a/731b9fca9a1e serves the replaced file (5727 bytes, h1 «Имена в «still editing» — ссылки на треды»)"
  }
---
Filed from project `runlith`.

Disk file checked with grep and wc after the publish: it holds the new content. The served page is the first publish (20261017T165709335Z). The artifact index lists the id. Cost: a whole operator round spent on a page he had already had redone.