---
id: 01a13d6d-49c3-79bf-8f19-d6ccc4b5b460
title: enforce_law refuses a modules `built` entry naming a directory as an unknown `inspection.builtin` field
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "body-shape: \"The running server does not know the input field `inspection.builtin`\" (and `inspection.bindings[0].builtin` for the bindings form), with an unblock telling the operator to restart the server with a newer build. Two wasted calls and a grep through the inspection source to find the real cause.",
    "command": "enforce_law blockId=083d37f1 inspection={builtin:\"modules\", params:{…, built:[{output:\"packages/window-behavior/dist/\", source:\"packages/window-behavior/src/\", why}]}}",
    "expected": "A refusal naming `inspection.params.built[0].output` and the declaration's own words: \"a built output names one file\"."
  }
---
Filed from project `runlith`.

The declaration in apps/tagma/inspection/src/packs/architecture/modules/declaration.ts filters `built` entries ending in `/`. The union decode failure is reported against the discriminant instead of the failing nested filter, and the unblock points at a server restart that would not help.