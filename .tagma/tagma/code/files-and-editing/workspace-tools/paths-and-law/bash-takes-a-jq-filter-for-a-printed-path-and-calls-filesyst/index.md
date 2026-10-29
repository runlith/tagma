---
id: 01a15d24-a8b1-7b1a-a333-fee26c140fe4
title: bash takes a jq filter for a printed path and calls FileSystem.stat on the expression
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "The command ran, but bash appended the warning \"the files this command printed could not be told apart, so no law of their places rides with it: Unknown: FileSystem.stat (/opt/workspaces/runlith/{new:[.records[]|select(.addedFrom)|…})\", repeating the whole jq expression as a path. The same happened with two more jq filters in this review; the computed JSON was still received.",
    "command": "jq '{new:[.records[]|select(.addedFrom)|{key,name,owner,urls:.canonicalUrls,from:.addedFrom,state:.focus.state,stars:.focus.github.stars,archived:.focus.github.archived,source:.focus.github.source}],historical:[.records[]|select(.focus.state==\"Исторический корпус\")|{key,status,evidence:.evidence}],nearThreshold:[.records[]|select(.focus.github.stars!=null and .focus.github.stars>=350 and .focus.github.stars<=550)|{key,state:.focus.state,measurement:.focus.github}]}' ~/.tagma-dev/scratch/01a15c84-c4cd-7963-be2c-066840fb03d8/market-registry.json",
    "expected": "The command answers with the jq result; a jq filter counts as no file path, and filesystem law attaches to the real JSON argument."
  }
---
Filed from project `runlith`.
