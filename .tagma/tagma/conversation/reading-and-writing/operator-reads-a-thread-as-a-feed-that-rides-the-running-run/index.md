---
id: 01a14bc0-754e-7774-9bf0-abe5760fe634
title: Operator reads a thread as a feed that rides the running run and scrolls back to the start
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92846c655f6f
  - kind: relates
    to: 01a14bc0-7595-7388-9467-c90f6d8a1c85
  - kind: relates
    to: 01a14bc0-7602-7cab-b241-acda4f784251
  - kind: relates
    to: 01a14bc0-7609-7d58-a98e-72588a9bdc58
  - kind: relates
    to: 01a14bc0-7656-71a8-87f1-676f905b4121
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/preferences.ts
  - kind: file
    ref: packages/chat-ui/src/ChatComposerOverlay.svelte
  - kind: file
    ref: packages/chat-ui/src/ChatSurface.svelte
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
  - kind: file
    ref: packages/chat-ui/src/entries/ToolXRay.svelte
  - kind: file
    ref: packages/chat-ui/src/JumpToLatest.svelte
  - kind: file
    ref: packages/chat-ui/src/MessageNav.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/ThreadPort.ts
    symbol: ThreadPort
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/evidence.ts
    symbol: EVIDENCE_OPERATIONS
  - kind: symbol
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
    symbol: ThreadSession
---
**Value.** The operator reads the conversation with the agent — his messages, answers, reasoning, work steps — and follows the running run live, without reloading.

**How.** The project's chat section, the sidebar, and the phone shell show the same feed. Under it lie the `read_thread_snapshot`, `read_thread_entries`, and `read_thread_entry` operations, available only to the operator.

**Behaviour.**
- The feed rides the tail until the operator scrolls up; selected text, a press on the feed and keyboard focus on a feed control only hold it in place while they last. While it rides the tail, nothing but his own input takes it off: rows growing, shrinking or arriving, and the browser moving the view, leave it at the end; a find-in-page jump or a screen reader's scroll is undone. A local composer submission returns it to the latest message and resumes following at press time, including a queued send or a dictated send; a selection standing in the feed at that moment no longer holds it. Delivery confirmations, retries and another holder's submissions do not take the reader back to the tail. At the very bottom the feed follows the tail however the operator got there — wheel, key, scrollbar, or button; scrolling toward the start loads older pages before he reaches them. A wheel over the composer scrolls the feed; on a phone a drag that starts on the composer leaves the feed where it is, as in a messenger, and a fling past the feed's edge does not pull the page.
- While a run is going, its time stands as a label on the input field's top edge and stays visible at any scroll; the live step in the feed shows only its own time. The changed digit rolls upward, the rest stand still.
- For one who left the tail further than a screen, a button to the latest stands above the input field — an opaque tile on the navigation column's background. Without a run it carries a go-to label and an arrow, with no running mark; width follows content smoothly, an action change softly rewords the text, a long line fades at the edge.
- A floating chip separate from the feed picks up long enough actions and keeps the chosen live step among parallel ones. A fast chain stays a shared working state; the shown step gets time to read, but its completion immediately swaps the label and mark by the true record. Waiting on a person, lost live state, and the end of a run wait for no hold. Missed actions never replay later; the feed itself shows events at once. Rows and marks build on the shared `chatStepLine`, `chatStepMark`, and `chatLiveLine`.
- Work steps collapse into groups, the newest open; `/stretches` and `/verbose` commands open everything or show raw payloads.
- A tool step opens to input and output and gives an address for the terminal entry. Block references show by their titles, a thread reference opens the thread beside it, a file path in the editor.
- At the feed's left edge, centred on its visible height above the composer, stands the navigation over the operator's messages: one tile per message, the current one gold. It does not scroll with the feed and shows from two messages; its room comes from the feed's own width, not the window's, and a feed narrower than 56rem, where it would sit beside the text, has none. The current message is the one whose turn — the message and everything after it up to the next one — lies under the reading line, even when the message itself has scrolled out of sight. The line stands a fixed distance under the top and, over the last screen of scroll, moves down to the last line above the composer, so every message on the last screen becomes current in turn and a feed at its tail — a run working or not — is on the latest message. The line's place on the last screen moves only with the operator's own scroll, so a run writing below a stopped reader never changes the current message. A message the operator clicked stays current until he moves the feed himself; one too near the end to reach the top stays current while it is in view. A click reaches any message, however far from the rendered rows, and the rail keeps the current tile in its own view.
- The session reconnects a broken subscription by itself, with no attempt limit.

**Limits.** A thread whose feed the server refused to give is shown as a chip with the cause instead of the feed. A terminal-CLI thread opens a terminal instead of a feed.
