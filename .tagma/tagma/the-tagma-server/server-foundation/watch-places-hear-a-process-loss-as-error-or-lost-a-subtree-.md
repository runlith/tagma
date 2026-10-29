---
id: 01a14c8b-1ab4-7c7a-a077-61b56b77ed62
title: Watch places hear a process loss as error or lost, a subtree reset as their rename with the directory path, a root reset as unnamed, and a checkout's tree does not watch what git ignores whole
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/folders.ts
  - kind: file
    ref: apps/tagma/server/src/platform/watch/ignored.ts
  - kind: file
    ref: apps/tagma/server/src/platform/watch/subscriptions.ts
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
---
The platform speaks to the watch process only through the `FileWatcher` port; composition binds it to the `@runlith/watch` client. Places with the same path, recursiveness and exclusions share one subscription, the last departed closing it.

- **Loss.** A subscription that ended after opening (the watch process died, the root was deleted or renamed, a new directory got no watch for the inotify limit) gives its places `error`; an opening that never got an answer gives `lost`. Owners reopen watching as on any loss (a checkout row with a pause; an off-checkout document directory falls back to polling), the next opening raises a new process. The server keeps running.
- **Reset** of a subscription reaches only its own places; neighbouring roots learn nothing, because each stream is its own. A subtree reset arrives as `rename` with that directory's path: places already read the named directory with a status on it, and that covers the subtree. A whole-root reset is `unnamed`. A checkout's tree finds one `rename` too little: a reset inside `.git` it turns into movements of every git mark under that directory (a mark cannot be told by the directory path), and a working-subtree reset re-reads the exclusion list — an edit to `.gitignore` may have been missed in the gap.
- **No port** (a world that never bound `FileWatcher`) — a place answers `polling`. The server always binds the port — composition checks it at build — so in it `polling` means only ticket refusal. The port is taken from the context of the fiber opening the watch: an owner opening it from a runtime-less fiber's context must hand the service over itself.
- **Events.** `create` and `delete` go as `rename` with a path (membership changed), `update` as a named path; one path per event — the checkout tree's git-mark parse stands on that.
- **A checkout tree's exclusions.** A recursive tree subscription excludes `.git/objects` (when the git directory is inside the tree) and directories that `git ls-files --others --ignored --exclude-standard --directory` names wholly ignored and `git check-ignore` confirms, only the topmost, the shallowest depth first. Confirmation is needed because ls-files also names a non-ignored directory holding only ignored content so far (`package/` with a single `node_modules`): excluded, it would hide the first real file. The list reads at open and anew on an `ignore` or `config` movement, on a named `.gitignore`, and on any `unnamed` of the tree — the rule may have changed in the missed gap; a changed list reopens the group, and its places get `unnamed`. That `unnamed` calls one more list read, which changes nothing more. When the list fails to read, the tree watches with no exclusions: costlier, but no event is lost.
- **A directory created after the list read** (the first `node_modules` or `dist` in a fresh worktree). The process marks a created directory; the tree asks `git check-ignore` about created directories outside exclusions — all of them, not the top ones: a non-ignored new parent says nothing about an ignored child — and adds the topmost ignored ones to the list and reopens the group the same as on a rule change. Events arriving before reopening go as usual. The explorer does not live-update inside an excluded directory: it re-reads such a directory when opened.
- **An external excludes file.** The tree resolves `core.excludesFile` with the same git that reads exclusions; without the setting it takes the stock `git/ignore` from XDG or the home directory. The parent directory is watched, so an atomic file swap never loses the watch; when the directory does not exist yet, the nearest existing ancestor down to the path's appearance. The path re-checks on file events; `polling`, `lost` and `error` report the subscription's state, not the directory's arrival — otherwise an opening without a port would reopen itself forever. An edit arrives as an `ignore` movement, a git config change rebinds the watch. The subscription goes through the same shared process and lives with the checkout's tree.
- **`withholding`.** Holding closes the touched groups' subscriptions and waits for the process to confirm closing before letting mass work through; the hold's end opens them again with `unnamed`, and a vanished root answers `lost`.
