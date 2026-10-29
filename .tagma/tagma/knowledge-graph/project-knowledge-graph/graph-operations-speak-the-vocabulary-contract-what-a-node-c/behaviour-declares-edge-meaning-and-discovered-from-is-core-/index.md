---
id: 01a13292-a115-76da-af84-5bd826568d3b
title: Behaviour declares edge meaning, and `discovered-from` is core provenance on any node
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What changes

The meaning of the edge the core reads is declared by a behaviour, not by code keyed on the edge name:

- `core/work` declares `waits-on` (work → work, no cycles; the only edge affecting readiness) and `implements` (work → spec, the target stands). The rules that `blocks/linking.ts` and `acts/measurement.ts` derive by name today come from this declaration.
- A tag that declares a meaningful edge but does not bind the contract providing it (`waits-on` without `core/work`) refuses at declaration time with `tag-incoherent`, not at first binding.

## `discovered-from` — core provenance

`discovered-from` ("found while working on X") makes sense for any node, including an untagged note; `accept_proposal` already sets it on every born node, bypassing the check (`work/proposals/verdicts.ts`), and every shipped and system tag declares it. Therefore:

- `discovered-from` is a core edge, allowed on any node without declaration, like `supersedes`/`amends`, but set and removed in the ordinary way (`link_blocks`, birth), not only by an operation.
- `accept_proposal` writes it through the same check as any edge.
- `discovered-from` leaves the `edges` of the shipped catalogs in code and the stored declarations of `#tag` in every graph — via a graph step (`graph/tree/steps/`), once.
- The journal and briefs read it as today.

## Verification

Integration: an untagged note is born with `discovered-from` and links with it; a custom tag without `core/work` that declares `waits-on` refuses at declaration with `tag-incoherent`; `implements` from work to a spec passes, to a non-spec refuses with `edge-shape`; an accepted proposal births nodes with `discovered-from`. Graph step: a declaration with `discovered-from` in `edges` no longer contains it after the step, while the tag's nodes keep the edge.
