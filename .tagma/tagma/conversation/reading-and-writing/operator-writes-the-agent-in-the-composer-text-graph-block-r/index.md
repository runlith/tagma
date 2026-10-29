---
id: 01a14bc0-7595-7388-9467-c90f6d8a1c85
title: "Operator writes the agent in the composer: text, graph-block references, thread-feature commands, and earlier messages from history"
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: relates
    to: 01a14bc0-75bb-73fc-8d6e-9df22504cfd8
  - kind: relates
    to: 01a14bc0-75fb-7fcc-8d33-a734ed6ae602
  - kind: supersedes
    to: 01a14bc0-75a6-714a-8bc7-d49c33647573
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/MentionDrops.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/MentionSlot.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ComposerFeeds.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/declared.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/draft.composer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PromptStore.ts
  - kind: file
    ref: packages/chat-ui/src/Composer.svelte
  - kind: file
    ref: packages/chat-ui/src/ComposerContributions.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/composerKeys.ts
  - kind: file
    ref: packages/chat-ui/src/PromptHistory.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/Draft.svelte.ts
    symbol: ThreadDraft
---
**Value.** In one field the operator writes the agent text, references graph blocks, calls thread-feature commands, and brings back his earlier messages without retyping them.

**How.** The field under the thread feed and on the new-thread page; `@` finds graph blocks, `/` opens commands, `$` substitutes a skill; up arrow at the field's start browses message history.

**Behaviour.**
- Sending is held back only by an empty draft: an open question, a running command, or a recap never block it; only the server can refuse, and then the words return to the draft.
- The chosen block stands as a chip and leaves on send as a `[[name|title]]` link, through which the agent reads the block; turn rollback returns such links as chips again.
- A thread or team agent dragged from the column onto the composer stands as the same chip — with a live state mark and a project label when its home project differs — and leaves as a `[[id|title]]` link through which the agent reads the thread. While it is carried, the accepting composer shows the chip's place with dashes, under the cursor a blue frame and preview; its own thread is not accepted by its own composer, a repeated chip is not duplicated. A project moves the same way — from the projects strip, from project tabs, and from the projects popup: it stands as a chip with a project label and leaves as a `[[project:<id>|name]]` link, which the agent knows from its instructions, and the feed draws as a project link. In a thread running the CLI's own TUI (Claude Code and others) there is no composer: a thread dropped onto the live terminal is pasted into the CLI input as the same link with a trailing space, and the terminal is framed with the same preview for the drag. A file from the system — any file — is dropped there as into an ordinary terminal: it is pasted as a path, and the CLI attaches the image by the path itself. On desktop, where the server is on the same machine, that is the file's own path; in the browser, with a remote server, and for a macOS screenshot thumbnail, which only the accepting app may open, the file is copied unchanged into the thread's folder on the server and leaves with the thread. Several files dropped in a row are pasted in drop order; a file that failed is named in the terminal message, the rest are still pasted. An image from the clipboard is pasted there the same way on Cmd+V (or right-click, when it pastes): when the clipboard holds no text, it is likewise copied into the thread's folder and pasted as a path; text in the clipboard is pasted as text, as in any terminal.
- `/` commands are declared by the thread features themselves — model, mode, delegation, compaction, recap, new thread, and others; their chips and the context ring stand beside the field.
- The `/` and `$` menus find a command or skill by a missed, extra, wrong, or transposed letter too, and by description words; the exact name stands first and selected, matched letters highlighted.
- Message history is one per project for all its threads, with block links but no attachments; editing the substituted text turns it into an ordinary draft.

**Limits.** History and draft live in this browser and do not cross to another device. A thread cannot be dragged into the composer from a worktree-grouped column or from archive: root threads there are not dragged at all. The thread chip shows the live mark only when the thread stands in this composer's project list; in another project's thread composer opened in the sidebar, the chip carries name and link without the mark. Up arrow in an empty field of a thread where there is something to roll back edits the last message through rollback (A1) instead of browsing history.
