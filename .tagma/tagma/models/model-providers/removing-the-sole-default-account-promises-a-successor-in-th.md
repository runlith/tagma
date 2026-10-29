---
id: 01a0cac3-363d-7d41-b5a6-bcf8ff0ea648
title: Removing the sole default account promises a successor in the removal dialog
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/accounts/AccountRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/RemoveAccountDialog.svelte
---
Removing the default account shows "Another stored account takes that place, and the list will show which" (`RemoveAccountDialog.svelte:28-34`) whenever `isDefault` is passed — and `AccountRow.svelte:68-73` passes it with no sibling check. Removing the SOLE default account therefore promises a successor that does not exist, in the destructive dialog where a false promise costs the most.

Pass whether a stored sibling stands (or read it in the dialog) and say what actually follows the removal when none does. Done when the sole-default removal names no successor.