---
id: 01a174e5-d332-773a-a66f-f2fac03e05cb
title: Local Svelte instance declarations are not importer dependencies at landing
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a174e4-d3b2-7ddc-b75a-72e48eddf713",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a174d7-3e29-7dd9-ad0c-fedbf3abefbe
---
Fix Svelte symbol reading at the fact producer: local instance declarations are invisible to the component's importer and must not raise a false lines-held. Prove with a scenario through native submit_work: the importer changes only the import line while a neighbor holds a same-named local const in the imported component; keep the existing checks for genuine dependencies.
