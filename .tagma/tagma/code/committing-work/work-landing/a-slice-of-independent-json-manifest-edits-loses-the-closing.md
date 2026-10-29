---
id: 01a17648-cb2e-75fc-b4e3-abd0dfcaaf81
title: A slice of independent JSON-manifest edits loses the closing braces of a new export
ord: 113
tags: ["reflection"]
fields:
  {
    "actual": "format-failed: oxfmt exit 2 on the prepared apps/tagma/server/package.json:14; after types/default the first new export is immediately followed by the HEAD-export ./demo/contract/wire/reports, with no closing `},`. The working file is valid and contains all six new exports whole.",
    "command": "check_rules({over:\"change\",rules:[\"083d37f1\"],limit:5,background:true})",
    "expected": "The valid apps/tagma/server/package.json must assemble from its own lines and their structural dependencies; an independent removal of neighbouring exports by another thread must not cut the closing braces of a new export."
  }
---
Filed from project `runlith`.

The split-capture session inserted six exports at the start of the exports field, removing two devDependencies. split-access independently removes the access/contract/wire/state export and @tagma/cloud; split-demo independently removes demo/contract/wire/reports. read_changes(path=apps/tagma/server/package.json) shows split-capture +22/−2, split-demo +0/−9, split-access +0/−5. The prepared version of the first check_rules passed format before the demo removal; after the demo removal the slice lost its own closing lines, while lines 10–39 of the working file are valid. You cannot fix a file the tool broke only in the prepared version; the direct workaround is carrying package.json whole with its dependent lines, or waiting for the neighbours' separate commits. Norms and formatter did not change.
