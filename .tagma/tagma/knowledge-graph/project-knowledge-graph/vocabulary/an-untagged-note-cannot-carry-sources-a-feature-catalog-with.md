---
id: 01a14b51-91dc-77d8-a0fb-219f35412724
title: "An untagged note cannot carry sources: a feature catalog with exact code owners not recorded"
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Batch atomically refused on ops[0]: refused[not-measurable]: b5f01150 is an untagged node, which declares no source. Unblock requires adding a tag with declared sources, which contradicts the records' specified type; the catalog not recorded.",
    "command": "apply_batch({project:\"runlith\",file:\"~/.tagma-dev/scratch/01a14b4c-b8f2-7a20-8b20-ac229999b864/catalog.json\"})",
    "expected": "Create 33 untagged feature notes with file sources under the given parent, as instructed for the catalog."
  }
---
Filed from project `runlith`.

The create input allows optional tags and sources, but the graph model allows sources only through a tag. That is missing expressiveness for an ordinary feature note, not a plea to soften the gate: either a declared sourced-note concept, or an explicit decision on another record type. Catalog preparation finished in one batch; after the refusal the parent got a choice between untagged with paths in the body and an allowed tag with sources.
