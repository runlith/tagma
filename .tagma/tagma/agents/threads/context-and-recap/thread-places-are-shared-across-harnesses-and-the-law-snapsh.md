---
id: 01a1274e-1d4c-7756-b0f8-edeb9105ff3f
title: Thread places are shared across harnesses, and the law snapshot is stored per project
ord: 11
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12726-9e16-7f6a-a8a2-153230815684
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/assembly.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/guidance.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/perform.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/guidanceIndex.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/instructionRule.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/instructions.ts
  - kind: file
    ref: apps/tagma/server/src/threads/working.ts
---
Only `move_thread` with `home` changes a thread's home; projects outside the home where it works are kept by the shared `WorkPlaces` owner in `threads`; on a move the new home's place row is dropped, and the former home is not added to places — its law arrives via `instructions-unread`, as in any foreign place. This list survives restarts and history compaction; native and external harnesses read one place record, and each transport keeps instruction snapshots per project. Changing the copy of the same project replaces only its set. A place is one current copy per project. Apart from places, `thread_copy` keeps every copy where the thread changed something, home ones too, with an unhanded-work mark: the thread's first changing act in a copy after handover sets it, and a handover of tasks that passed all marked copies clears it. A child run's end and a thread's end open only the home, the thread's current roots, and marked copies: a copy of long-handed-over work is not reopened on every run end. `WorkPlaces.worked` yields every copy of this history still standing as its project's checkout; by them, the home, and the current roots, `read_thread_work` reads the thread's work. One owner (`HeldTasks`) gathers this set for reading and for handover alike, so the Work tab never shows a task from a copy the thread's end would not hand over. A copy the workspace no longer attributes to its project (worktree deleted by Tagma or outside) enters neither reading nor handover. A path whose place did not read drops the whole answer: a silently skipped copy would hold tasks with no handover.

Handover clears the mark only on handed-over copies and only one set before its own read began. A changing act sets the mark twice: on entry, so a mid-act failure does not lose it, and on completion (`WorkPlaces.acted` from `triggered`), so an act that entered before the handover began and took work after its read leaves the copy marked. `WorkPlaces` memory skips a repeated write only when the mark is set no earlier than this thread's last handover. Rows of deleted worktrees stay in history: the workspace gives no "checkout deleted" event, and a `locate` miss would drop unhanded work from handover forever. Copies where the thread worked before this history appeared are not restored: foreign ones were remembered as one last each, home ones not at all, besides the home and current roots. The global project joins this list on common grounds: the inherited prompt rules of its main copy do not replace the selected checkout's law.

Native and hosted ACP allow mutating a foreign place on the law snapshot before the assistant message that spawned the call: the project matches, and the delivered text is reconciled with the target checkout's live set. A difference holds the mutation until delivery; a root match and the built admission guide give none. The history owner incrementally holds delivered states and a snapshot for every sealed batch; after projection recovery the admission reads its addressed answer with no second look at the message tail. Admission reads the full snapshot: a former root may become the target again after work in a copy with the same text, while the law in it has changed meanwhile. Hosted relies on transport order: `recorded` awaits `reached` before COMMIT post-tool guide, so an unsealed message's guide cannot yet stand in history and does not admit a neighbouring call of that batch. Reading passes at once and records the place; `project-instructions` brings the set on the next step. Compaction drops the projection, rewind and other history replacements rebuild it. Another copy of the home project is not in the list: regional law arrives by its paths. An unreadable foreign graph drops the place record, so the next record awaits the law again. A removed project's place rows stay recorded but are not served, including the home and selected roots: removal is reversible, and a returning project brings back its threads' places. So a thread's end does not open a removed project's graph and does not refuse because of it; tasks the thread held there stay with its session, as with any stopped one, and after the project's return a claim takes them. An unreadable graph of a standing project still holds the thread's end with a `thread-tasks-unreadable` refusal: tasks there cannot be handed over, while the graph may answer again.

`touch_path` groups paths by checkout and returns place addresses with regional briefs. Hook guidance reads the live sets of those places under the delivery lock and stores them with the briefs in one home event; a late hook cannot revoke newer law with an older snapshot. A retry on evidence answers with the recorded text. An HTTP/MCP act with a foreign-project place first refuses `instructions-unread`, delivering the law inside the refusal itself; the retry runs. A call parallel to the first refusal may pass on the already-recorded place: this path does not guarantee law before every mutation. This also works for a purely graph act. After compaction or context clearing ACP receives the home and the stored places anew. An unreadable foreign place is dropped with a reason, without blocking the home run. The hook reports a file record only after the file changed, so this path promises no law before the write or typed intake. Hosted ACP runs tools through native owners and keeps their guarantee.
