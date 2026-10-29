---
id: 01a13292-a115-76da-af84-5bd91b4a6f2a
title: Block birth takes its edges as an `edges` list through one check on all birth doors
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## What changes

Birth of a block takes its edges as `edges: [{kind, to}]` on `create_block`, in the create-op of `apply_batch`, and in the create-op of `#proposal`. `kind` is an edge the new node's tag declares, or core provenance from [[26568d3b]]; `to` is a block in the same project, in batch and proposals also `$handle`. `implementsId` and `discoveredFromId` leave every birth door in the same change. `amendsId` stays: it is the birthplace of a proposal and the `amends` provenance, which only its operation writes.

## Design

- **One birth form** with a reference-type parameter: a number in the service, a `blockRef` at the door, `$handle` in batch and proposals. Today's four copies (`operations/shared.ts` `AGENT_CREATE_CORE`, `contract/wire/batch.ts` three times) and the dead `BLOCK_CREATE_DOOR_CORE`/`BATCH_REF_KEYS` go away. `APPLY_GRAMMAR` lists create fields from this form, not by hand.
- **One check before writing.** `Edges.assertEdge` judges the edge over the future node's form `{tags, projectId, uuid}` before `act.unit` — the uuid is already minted ahead; the `waits-on` cycle for a new node is empty, so there is no need to split the check into "before" and "inside". Any edge refusal refuses the whole birth. `provenanceEdges` is removed.
- **Reference resolution.** Each edge's `to` resolves through the same `resolvePeer` (`operations/blocks.ts`) as parent; an edge to another project refuses with `cross-project`, like `link_blocks`.
- **Proposals.** `payloadNames` and `inScope` (`work/proposals/filing.ts`) check each create-op's `to` for falling inside the subtree, as they check `implementsId` and link-op targets today.
- A repeated edge in the list is one row: `(kind, to)` is unique, as in the block file.
- **Stored proposals** with `implementsId`/`discoveredFromId` in create-ops are translated to `edges` by a graph step, once; reading code knows only `edges`.

## Why an edge list at birth, not just `link_blocks`

An edge at birth is part of the node's meaning, and its refusal rolls the birth back: a task never appears without the spec it implements. Two calls leave the node edgeless if the second refuses. Birth and `link_blocks` are one check at different moments, not two roads to one act.

## Verification

Integration on a custom tag with `relates` and `waits-on`: birth with three edges (`relates`, `waits-on`, `discovered-from`) sets three; an undeclared edge rolls the birth back with `edge-undeclared`; an edge to another project — `cross-project`; batch with `$handle` in `to` and accepting a proposal with a create-op set edges the same way; a proposal create-op with an edge outside the subtree refuses on filing. Graph step: a proposal with `implementsId` in ops is accepted after the step and births a node with the `implements` edge.
