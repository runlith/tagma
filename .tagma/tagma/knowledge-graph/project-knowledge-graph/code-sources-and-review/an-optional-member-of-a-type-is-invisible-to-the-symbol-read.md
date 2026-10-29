---
id: 01a0c704-6ede-778b-9f3b-7096befe43f0
title: An optional member of a type is invisible to the symbol reader
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "undefined for both. isMember in measure/sources/regions.ts reads a member as a name followed by `:`, `=`, `<` or `{`; an optional member writes its `?` before the colon, so the whole field is invisible and no symbol anchor can be attached to it.",
    "command": "bun -e \"import { symbolSite } from 'apps/tagma/server/src/graph/measure/sources/symbol.ts'; console.log(symbolSite('/opt/workspaces/runlith', 'packages/package-boundary/src/index.ts', 'browserEntrypoints'))\" — the reader a zone builder confirms every symbol anchor with, run 2026-09-22 over packages/package-boundary/src/index.ts",
    "expected": "defined: the file declares `readonly browserEntrypoints?: readonly string[];` and `readonly browserConsumers?: readonly string[];` as members of PackageBoundaryInput, each at the head of its own line."
  }
---
Filed from project `runlith`.

Two anchors planned for this zone (`browserEntrypoints`, `browserConsumers`) had to become coarser ones — the type and the function that reads them — and a claim whose narrowest evidence is an optional field has no narrow anchor available at all. The reader's own rule says a member written at the head of its line is a definition site; an optional member is one, and the same scan finds `skip` only through the parameter of another function that happens to spell it.