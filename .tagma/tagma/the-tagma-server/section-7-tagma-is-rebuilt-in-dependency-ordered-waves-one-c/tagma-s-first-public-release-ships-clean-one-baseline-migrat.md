---
id: 01a0e945-3c0d-7dd6-867c-7215173580c0
title: "Tagma's first public release ships clean: one baseline migration per store, no legacy readers or compatibility windows, no transitional bindings, no standing debt"
ord: 17
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The first public release of Tagma ships clean: no migration history, no legacy compatibility, no transitional layer and no standing debt. Its only user until then is the operator, so every compatibility window the restructure opened collapses at that point instead of being carried to thousands of installations.

## Why

The restructure adds migrations (D0, D4, D6, D7 and others), one-release compatibility windows (wire v34, `operation` shadows, legacy JSON and directory readers), §7.2.7 transitional bindings and debt entries owned by open tasks. Each of these is cheap to remove while one installation exists, and a permanent obligation to every user once the product is released.

## Target

1. **One baseline migration per store.** The machine store's chain and the graph store's chain are each squashed into one baseline. A new installation starts from the baseline. The operator's store, standing at the last pre-squash migration, has its ledger marked as standing on the baseline after a D0 snapshot, and nothing is rewritten. A store older than that point refuses with "upgrade through release N first".
2. **No legacy readers or compatibility windows.** Every item under "Legacy to remove before first release" in the merge list [[4a9013bf]] is gone. That covers old wire versions and frames, shadow rows and read-throughs, old-form data readers, old directory layouts and the legacy pid claim.
3. **No transitional bindings.** Every §7.2.7 binding is replaced by its owner's real one. That covers `composition/start.ts`'s temporary bindings, the `WorkingOwners` wrapper, the projected-operation bridge, the `CurrentProject` → `projectId` binding and any bare write arm.
4. **No standing debt.** Every `checks/*.debt.json` file is empty, or holds only entries the operator has explicitly accepted as exemptions through `enforce_rule`, each with its reason.
5. **No dead code or stale data.** No unused exports and no files or directories only an old binary wrote, and every claim in the graph verifies against the released code.

## Acceptance

- `drizzle/` holds exactly one baseline per store plus nothing after it; a fresh install and the operator's migrated store produce the same schema.
- The merge list's legacy section is empty, and a repository search for each removed identifier returns nothing.
- `modules`, `names`, `platforms` and the E0/K0 builtins run at gate over the whole region with empty debt.
- The integration and system suites pass on the released tree.

## Order

After every restructure wave has landed and been merged into main, and before the first public release is tagged. It is one change set, reviewed once by a Muse lens pack with a performance lens.

## Owners

The migration squash belongs to platform, which owns the store chains. Each legacy item belongs to the module that added it, and the merge-list line names it. This decision's task coordinates them.
