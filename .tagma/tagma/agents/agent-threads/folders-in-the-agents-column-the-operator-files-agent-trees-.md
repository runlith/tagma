---
id: 01a0f7af-b132-76e1-8d17-2e389f454f5d
title: "Folders in the Agents column: the operator files agent trees into named, ordered folders of the project"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## 1. Outcome
The operator files agent trees into named folders in the Agents column, so ten resting agents become one folded row without archiving or deleting anything. A folder is a shelf inside the one list: drag a row onto it, press M, or pick "Move to folder…" in the row menu. A collapsed folder still says what lives inside — working, waiting and failed counts and the hue of the most urgent — and the header's waiting count opens it.

Approved UX: the artifact "Папки для агентов" (http://localhost:5634/a/415d7215a0f7), with the operator's open questions answered by its recommendations: one level of folders, no folder colour of its own, agents may file trees through the same operations, a new thread lands in a folder only from that folder's "+".

## 2. Problem
The list keeps every live root; a long session leaves dozens of resting trees the operator neither wants archived nor wants in view. Pin only lifts; archive removes from view entirely.

## 3. What holds now
Pins live on `thread.pinned_at` of the root, are written by `pin_thread`, and travel to the app as a field of the feed's row frame; the window admits every working and pinned root and fills with the newest idle roots (LIST_WINDOW_ROWS). The app derives the bands from rows alone.

## 4. Target model
- `thread_folder` (id, project, name, position): a project's folders, ordered by position. `thread.folder_id` → folder, `on delete set null`; it lives on the root (an id inside a tree files the tree's root, as a pin does).
- A tree stands in exactly one place on screen: Pinned when pinned (it keeps its folder and returns to it when unpinned), else its folder, else loose. Filing a tree clears its pin.
- Archived trees keep their folder; unarchive returns them to it. Deleting a folder releases its trees to loose and deletes no thread.
- The window admits every foldered root the way it admits pinned roots: filing is the operator's request to keep the tree, so a folder's counts are exact.
- Feed: the opening `list` frame carries the project's folders; every folder change fans one `folders` frame with the whole list; rows carry `folderId`.
- Column order: Pinned → live loose → folders (manual order) → quiet loose → Archived. Inside a folder trees band as the list does (live over quiet). A collapsed folder keeps the open thread's tree drawn under its header.
- Operations: `list_thread_folders`, `create_thread_folder` (optionally filing threads into it in the same act), `rename_thread_folder`, `move_thread_folder`, `delete_thread_folder`, `file_threads`.
- App: drag and drop (5 px threshold, folder header and open folder body as targets, spring-open after 650 ms, loose area, Pinned header, a New folder / Archive dock replacing the Archived foot while dragging, folder headers reorder by drag), ⌘/Ctrl-click and Shift-click selection carried by one drag, M opens a folder picker, Undo on every move through the snackbar.

## 5. Owners and boundaries
- thread-record owns the table and a `ThreadFolders` service (one subject, beside `ThreadRecords`).
- threads owns the operations, the row field, window admission and the feed frames (`ThreadList.announceFolders`).
- The app's thread feature owns the column composition, the drag controller and the picker; folds of folders live in the browser with the other folds.

## 6. Rejected alternatives
- Labels (many per thread): the list does not get shorter, and a label filter hides work waiting on the operator.
- Spaces (one visible at a time): live work elsewhere needs a second indicator; projects already are spaces.
- Live trees floating out of a collapsed folder: rows would move without the operator's act.
- Nested folders and folder colours: deferred; colour is spent on state.

## 7. Acceptance
- Filing, unfiling, creating with members, renaming, reordering and deleting a folder each arrive in a second open app through the feed alone.
- A foldered root older than the idle window still stands in its folder after a reload.
- A collapsed folder draws working/waiting/failed counts; the header waiting count opens a folder that hides the waiting row.
- Deleting a folder leaves every member thread standing loose.
- Drag, M picker and row menu all file; Undo restores the previous place.

## 8. Claims and tasks touched
Window admission claim f716d119 gains foldered roots; the app band composition claims (eabc5886, columnEntries) gain the folder band; 375fa6a5 loses native link drag inside the list. New claims are written from the code at close.

## 9. Order
Store and migration → ThreadFolders → operations and feed → app list state and Repo → column composition and folder row → drag, picker, selection, undo.

## 10–17
- Contract: additive. `folderId` and the list frame's `folders` are optional keys, so an older page decodes newer frames.
- Stored data: one migration adds the table and the column; rollback drops both, leaving every thread loose. Folder membership is not written into rollout meta: a database rebuilt from rollouts loses folders (limitation).
- Who may do what: the operator always; an agent through the `threads` capability, asked under trust like a pin.
- Long-lived things: a folder lives until deleted; an empty folder stays.
- Bounded resources: the window grows with the number of filed roots, the operator's own count; archive remains the road for hundreds.
- Rollout: running pages see no folders until reloaded and keep working.
- Failures: every act is one write unit; a refused act leaves the list as the feed last said.
- Observability: the folder frames and the row's `folderId` are visible in the feed; the operations answer what they moved.
