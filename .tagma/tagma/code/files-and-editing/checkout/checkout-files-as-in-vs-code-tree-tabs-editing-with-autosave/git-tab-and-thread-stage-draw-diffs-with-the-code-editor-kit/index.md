---
id: 01a117dd-98e5-7df2-86cb-e3f7db56abc2
title: Git tab and thread stage draw diffs with the code-editor kit and an overview ruler; the diff minimap goes away
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/diffRows.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/DiffTab.svelte
---
The diff in the Git tab and in the thread stage is drawn by the `Diff.svelte` kit [[1759d27d]]: both sides' line numbers, the line holder in the gutter, the overview ruler instead of a code minimap (as in the VS Code diff), copying without deleted lines. The diff is read-only: edits happen in the file tab; [[b51edd1b]] adds the "Open file at this line" button.

## What stands now

- `apps/tagma/app/src/features/checkout/DiffPane.svelte` → `AuthoredDiff.svelte` → `ToolDiff` from `@runlith/chat-ui` with `author`, `onExpand`, `map` props; `authoredHunks.ts` cuts the `read_authorship` answer into hunks, `LineHolder.svelte` draws the holder strip.
- The minimap is `packages/chat-ui/src/entries/DiffMap.svelte` + `mapGeometry.ts` + `mapPicture.ts`: the whole file squeezed into the panel height, `min(3, height / lines)` px per line, so on a long file the code turns into a strip. In the VS Code diff the minimap is off (`diffEditorEditors.ts` `minimap.enabled = false`); an overview ruler stands instead.
- `ToolDiff` also draws edit diffs in the chat feed (`ToolRow.svelte`, `AcpToolRow.svelte`) — it stays there.

## Target

| Was | Becomes |
|---|---|
| `DiffPane.svelte` | `DiffTab.svelte` — an editor-area tab [[b51edd1b]] and the thread stage contents |
| `AuthoredDiff.svelte`, `authoredHunks.ts` + test | `Diff.svelte` kit + `diffRows.ts` adapter: `PathAuthorship` → diff lines, holder → mark tinted `handHues` |
| `LineHolder.svelte` | kit gutter marks |
| `DiffReading.svelte.ts` | stays the owner of `read_authorship` reads and `open` expansion; its own `counted` count leaves — a path's `+/−` comes from Holdings (51c66cb6, [[762eb07f]]) |

`PictureDiff.svelte`, the width switch, line wrap, and path history are unchanged. The thread stage (`ThreadMain.svelte`, `DiffStage.svelte`) draws `DiffTab`; `OpenFile.svelte.ts` gains a view (`diff` | `file`) and a line so [[b51edd1b]] opens the file there too.

## Removed

- `packages/chat-ui`: `DiffMap.svelte`, `mapGeometry.ts` + test, `mapPicture.ts` + test; `ToolDiff.svelte` loses the `author`, `onExpand`, `map` props and their branches.
- `features/checkout`: `AuthoredDiff.svelte`, `authoredHunks.ts` + test, `LineHolder.svelte`, `DiffPane.svelte`.
- Graph: #rule [[9d65d54f]] is lifted — there is no minimap anymore, and the ruler draws positions of the shown document, so no replacement rule is needed. #rule d4336fc4 stays: `ToolDiff` in chat stays.

## Acceptance

- Executor: diff-read contracts (hidden expansion, width narrowing, refusal) green on the new view; a path's `+/−` in the header equals the Git tab line.
- Operator: in the browser on the dev stand — a long-file diff with ruler, holders in the gutter, copying.
