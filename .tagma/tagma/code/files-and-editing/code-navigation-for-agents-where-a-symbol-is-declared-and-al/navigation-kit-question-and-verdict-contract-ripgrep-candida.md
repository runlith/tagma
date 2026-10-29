---
id: 01a16160-10e4-70a6-b29a-fe8035b3ac59
title: "Navigation kit: question and verdict contract, ripgrep candidates, summary, and pages"
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16160-74f6-7898-b321-ee5ce0efd8fb",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
New kit `packages/navigation` in the spec sections "What the agent gets", "Layout", and "Modules and question flow". First the contract, as a separate commit: questions (`definition`, `uses`; input path+line+name or `Owner.member`), verdicts per occurrence (this symbol with kind and function, alias, another symbol, in a string or comment, unverified with a reason), revision and lag, engine state, adapter capability declaration and the adapter port filled in by composition. The TypeScript adapter and the engine holder are written against it in parallel, so the contract is the first thing the rest see. Then: candidate sweep through the ripgrep kit, "changed after snapshot" verdicts over current text, merging, summaries, pages with a cursor onto the finished answer; checks on a fake adapter.
