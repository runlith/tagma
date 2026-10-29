---
id: 01a14b6d-b285-7ec1-b63c-ce8d5e5b32c5
title: "Operator orders the thread list: pins trees on top, files into folders, gives names"
ord: 34
---
The operator keeps the thread list in their own order: pins important teams on top, files them into folders, and gives threads names to recognize them by.

**Pinning.** `pin_thread` pins the birth tree's root (an id from inside the tree pins its root): pinned trees stand above all rows in pin order, and nothing reorders them; repeated pinning keeps the place, unpinning returns the row to its place by read time. Asks from the trust mode.

**Folders.** `list_thread_folders`, `create_thread_folder` (with trees inside at once), `rename_thread_folder`, `move_thread_folder`, `delete_thread_folder` (trees from deleted folders return to the list, threads are untouched), `file_threads` — put trees into a folder or take them out.

**Names.** `set_thread_title` — any thread of the project, a born one too (its row still prints the address the team writes to); a manual name is never replaced by auto-naming; an agent renames a thread outside its own subtree only on the operator's word; empty — `title-empty`. An automatic name (`threads.autoTitle`, model `threads.titleModel`) goes to threads that still carry a random birth name; `generate_thread_title` names a root on demand (a born thread — `not-a-root`; nothing to name with — `title-model-missing`). A CLI thread takes its CLI's name while `threads.harnessTitle` is on.

Code: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts#THREAD_OPERATIONS, apps/tagma/server/src/threads/contract/wire/operations/folders.ts, apps/tagma/server/src/threads/contract/wire/settings.ts#autoTitle, apps/tagma/app/src/lib/features/threads/PinnedBand.svelte, apps/tagma/app/src/lib/features/threads/FolderRow.svelte
