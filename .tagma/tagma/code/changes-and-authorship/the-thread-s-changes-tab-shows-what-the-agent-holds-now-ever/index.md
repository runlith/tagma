---
id: 01a14c13-c481-7acc-8aa6-03b603abb142
title: The thread's Changes tab shows what the agent holds now, everything it wrote by turns with each file's fate, and in a worktree — the branch change against the base
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b329e7e083
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b58c7d795b
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cbaf2058f5
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/Changes.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesBody.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesCount.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesItem.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ChangesList.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/HistoryBody.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ScratchSection.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadChanges.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadHistory.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/changes/stream.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/wire/threadChanges.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/history.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/listing/loose.ts
---
**Value.** The operator reading a thread sees beside the conversation what this agent holds uncommitted, what it changed at all, and where it went, without hunting its edits among others' in the Git tab.

**How.** The Changes line of the "This thread" button in the thread header, the `+/−` count left of that button, or the "+" item opens the `changes` tab of the right area; the line and count are links: ⌘-click opens the Checkout Git tab, right-click the link menu; the same Git tab is the icon at the tab strip end while the Changes tab is open. The line stands while the tab would show something besides "No changes yet": the thread's paths, commits, departed lines, or a checkout that failed to read; in it, the list and the selected-file view stand side by side at any tab width by default, the seam holds the list width; while no file is selected, the view's place holds a prompt to pick a file, and for a thread without changes in Now and History that place is empty. In the narrowest area the list yields most of the width to the view so its header fits whole. Layout in the list's "…" menu switches the tab to one column: the open file covers the list, and "back" in the view header returns to it; the choice is kept in the browser, one for all threads. The view is picked by the switch in the tab header: Now, History, and, for a thread in a Tagma worktree, "vs <base>". ↑/↓ in the list walk neighbouring rows, including Scratch files, J/K in diff only over changes; a repeated click on a selected row in Now and History keeps it open, while in "vs <base>" it closes the view. The tab belongs to the screen's main thread; selection and view live in `ThreadChanges` and survive tab switching.

**Behaviour.**
- Now is on the thread changes subscription: Uncommitted — paths where the thread's lines stand, with other holders and nobody's-lines marks; Unchecked — paths whose lines couldn't be split, with cause; Outside git.
- History is the thread's commits and every path each of its turns wrote, newest on top, with the fate now: uncommitted, committed (by which commit), no longer held, or how the lines left (overwritten, reverted to HEAD, reformatted by commit steps, thread or checkout deleted). The fate filter applies to loaded rows; "Show more" reads on. While History is open, every movement of the thread's changes re-reads the loaded window in one request.
- Uncommitted carries the thread's `+/−` line sum in its header, the checkout group its own; the same sum stands in the Changes line tail, and with no lines — the file count. The same tail stands as the count in the thread header while the thread has changes and its Changes tab isn't on screen: the area closed or another tab active in it. The line's tooltip names files, the sum, and unverified-path causes. Sums are computed by the server-side stream from frame records.
- A thread that wrote into several checkouts and projects sees each as its own group; an unreadable checkout is marked with Retry, the rest stand. A group is signed when a section has more than one group or any lies outside the thread's project; in the second case the signature names the project too: "billing · main". Changes only in the thread's project don't name the project.
- "vs <base>" is the whole branch change against the base, whoever made it, and the completion strip: merge check, Merge, Update, PR.
- An orange mark on the Changes line icon says there are unverified paths.
- "Open the file at this change" in diff opens the file as a separate `file` tab.
- Scratch is the last Now section: what the thread put in its scratch, newest on top, with size and modification time. A subfolder expands in place and reads only while expanded; a file opens in the tab's view in place of diff in the same view as the right area's `file` tab (text, image, markdown), without diff or J/K steps, while PDF goes to a browser tab like any file link; ⌘-click and menu are the same as on a change row. The section isn't in change accounting: it has no `+/−` or diff and doesn't count into the Changes line, thread header, "No changes yet", or "All changes are committed" counts. A collapsed scratch section doesn't read, and an empty scratch shows no section.

**Limits.** The panel only shows: committing goes through the agent's landing or from the Git tab, rollback through turn rollback. A turn in History has no `+/−`: the record keeps the path's fate, not its weight in that turn. A scratch folder with a very large number of records shows only the newest and the count of the rest.
