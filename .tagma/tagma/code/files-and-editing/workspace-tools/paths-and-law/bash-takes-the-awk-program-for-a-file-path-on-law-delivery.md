---
id: 01a16e95-e7a5-727a-8154-85fb685be51f
title: Bash takes the awk program for a file path on law delivery
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The command answered successfully rows=67 before=94.0 measured=30 measured_before=83.1 cold_after=138.7 unmeasured=37 unmeasured_before=10.9, then law delivery did an extra FileSystem.stat on /opt/workspaces/runlith/{n++; before+=$1; ...} and reported it could not tell the printed files apart.",
    "command": "functions.bash({\"command\":\"rg --no-filename --no-line-number --only-matching --replace '$1 $2' '^apps[^\\\\t]*\\\\t[^\\\\t]*\\\\t([0-9.]+)\\\\t([^\\\\t]+)\\\\t' ~/.tagma-dev/scratch/01a16a94-8d3a-7610-abd9-8503665bc41f/x10/x-server-rest-threads.tsv | awk '{n++; before+=$1; if ($2 == \\\"unmeasured\\\") {kept++; keptBefore+=$1} else {measured++; measuredBefore+=$1; after+=$2}} END {printf \\\"rows=%d before=%.1f measured=%d measured_before=%.1f cold_after=%.1f unmeasured=%d unmeasured_before=%.1f\\\\n\\\", n,before,measured,measuredBefore,after,kept,keptBefore}'; rg --no-filename --no-line-number --only-matching '^apps[^\\\\t]*' ~/.tagma-dev/scratch/01a16a94-8d3a-7610-abd9-8503665bc41f/x10/x-server-rest-threads.tsv | sort | uniq -d\",\"lifeMs\":60000,\"waitMs\":1000,\"description\":\"Aggregate ledger totals and detect duplicate packet paths\"})",
    "expected": "The command answers with TSV numbers and duplicates; the awk program line counts as no file name and goes to no FileSystem.stat."
  }
---
Filed from project `runlith`.

The warning blocked neither the count nor changed any files. The command output held only numbers; the awk program came from a quoted pipeline argument, not from output or a real path.
