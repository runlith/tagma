---
id: 01a117dd-98e5-7df2-86cb-e3f29496f66b
title: Explorer, tabs, autosave, search, and Quick Open in Orca and VS Code (read 2026-10-07)
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca c8937936 and VS Code 5712a2f9 source code",
      "ref": ".external/orca, .external/vscode"
    }
  }
---
Source snapshot: Orca `c8937936` (Electron + Monaco + TipTap), VS Code `5712a2f9`. Orca paths are relative to `.external/orca/src/`, VS Code paths relative to `.external/vscode/src/vs/` (except `extensions/`). "Observed" is read in code, "conclusion" is my inference from code.

Abbreviations: `O:` Orca, `V:` VS Code, `Δ:` main difference.

---

## 1. Explorer tree

**Hidden items**
- O: `.git` and `node_modules` always hidden with no setting — `renderer/src/components/right-sidebar/file-explorer-entries.ts:3-5`. Other dotfiles are shown; the "dotfiles" toggle lives per worktree, shown by default — `FileExplorer.tsx:45`, `shared/persisted-ui-state-types.ts:74`.
- O: symlinks in the explorer count as files, not folders (otherwise reading a link touches protected macOS directories) — `main/ipc/filesystem/filesystem-file-content-inspection.ts:76-85`.
- V: `files.exclude`, by default `**/.git`, `**/.svn`, `**/.hg`, `**/.DS_Store`, `**/Thumbs.db` (on web also `**/*.crswap`) — `workbench/contrib/files/browser/files.contribution.ts:153-158`. `node_modules` is NOT hidden. The exclusion applies as a render filter (`explorerViewer.ts:1336`), not at directory read.
- Δ: Orca hard-hides `node_modules` with no setting; VS Code hides only VCS junk, but everything is glob-configurable.

**Gitignored**
- O: `showGitIgnoredFiles` setting, default `true` (`shared/default-global-settings.ts:132`). Ignored rows shown are italic, gray with `--git-decoration-ignored` and a `CircleSlash` icon on the right (`FileExplorerRow.tsx:209-250`). When off, rows are dropped from the projection (`useFileExplorerVisibleRowProjection.ts:85-88`). Detection: `git check-ignore -z --stdin` over visible relative paths, in batches up to 1 MB stdin, 15 s timeout (`main/git/check-ignored-paths.ts`, `shared/git-check-ignore-stdio.ts:1-3`); on filter typing the request waits 300 ms (`use-file-explorer-ignored-paths.ts:6`). A folder counts as ignored when any ancestor is ignored (`status-display.ts:isPathIgnored`).
- V: `explorer.excludeGitIgnore`, default `false`, RESOURCE scope (`files.contribution.ts:612-617`) — then ignored entries are shown. Ignored gray comes from the git extension: the `GitIgnoreDecorationProvider` collects paths into a queue and every 500 ms (`@debounce(500)`, `extensions/git/src/decorationProvider.ts:70`) runs `git check-ignore`; no badge, only the `gitDecoration.ignoredResourceForeground` color (`#8E8E90` light / `#8C8C8C` dark). When `excludeGitIgnore` is on, the explorer parses `.gitignore` itself (`explorerViewer.ts:1313-1370`, `IgnoreFile`) and hides entries.
- Δ: both show ignored items dimmed by default; Orca adds an icon and italics, VS Code only color.

**Git decorations (letter, color, folder propagation)**
- O: letters `M A D R U C` (`status-display.ts:5-12`). Colors are CSS variables: dark added `#81b88b`, modified `#e2c08d`, deleted `#c74e39`, renamed/untracked/copied `#73c991`, ignored `#6e6e6e`; light added `#587c0c`, modified `#895503`, deleted `#ad0707`, renamed/copied `#007acc`, untracked `#007100`, ignored `#8c8c8c` (`renderer/src/assets/main.css:225-231, 337-343`). The file name is colored with the letter on the right. A folder gets the "dominant" descendant status: priority deleted 5 > modified 4 > added = untracked 3 > renamed 2 > copied 1 (`status-display.ts:23-30`); `deleted` is NOT propagated (`shouldPropagateStatus`). The folder name is colored with the same letter on the right.
- V: letters `M A D R T U I C` (`!` is conflict, `S` submodule) — `extensions/git/src/repository.ts:58-90`; colors are themes `gitDecoration.*ResourceForeground` (`extensions/git/package.json:4151-4245`: added `#587c0c/#81b88b`, modified `#895503/#E2C08D`, deleted `#ad0707/#c74e39`, renamed and untracked `#007100/#73C991`, conflicting `#ad0707/#e4676b`). Separate colors for index and working tree (`stageModified…`, `stageDeleted…`). `propagate = type !== DELETED && !== INDEX_DELETED` (`repository.ts:310`). On a folder no letter but a "bubble badge" — a `●` dot (codicon) at 0.4 opacity with the "Contains emphasized items" tooltip (`workbench/services/decorations/browser/decorationsService.ts:114-119, 199`) plus the name color. Settings: `explorer.decorations.colors` and `explorer.decorations.badges`, both `true`.
- Δ: Orca puts the same letter on a folder, VS Code a dot; Orca does not distinguish index/working tree and has no `!` conflict in the tree (conclusion: Orca shows conflicts in a separate panel).

**Compact folders**
- O: not found (grep `compact|single-child` over `right-sidebar/file-explorer-*`, `useFileExplorer*`, `FileExplorer*.tsx` empty). Conclusion: single-folder chains are not glued.
- V: `explorer.compactFolders`, default `true` (`files.contribution.ts:577-581`); navigation across chain segments: `PREVIOUS_COMPRESSED_FOLDER`/`NEXT_…` commands (`fileCommands.ts:49`).

**Sorting**
- O: directories first, then files; names via `Intl.Collator('en', {numeric: true})`, ties by code units (`shared/file-name-sort.ts:9-33`). Locale is pinned to `en` so main, renderer, and remote host give one order. No settings. Resorting is always client-side even for a ready host answer (`file-explorer-directory-listing.ts:60-63`).
- V: `explorer.sortOrder` = `default | mixed | filesFirst | type | modified | foldersNestsFiles`, default `default`; `explorer.sortOrderLexicographicOptions` = `default | upper | lower | unicode`; `explorer.sortOrderReverse` (`files.contribution.ts:520-549`). Comparison is `Intl.Collator(undefined, {numeric: true})` with tie-break by length (`base/common/comparers.ts:36-60`).
- Δ: both have natural order with folders first; VS Code gives 6 modes, Orca one and locale-independent.

**Auto reveal**
- O: `useFileExplorerAutoReveal.ts` — when the active file tab changes (modes `edit` and `markdown-preview`) scrolls to the row and selects it; when ancestors are collapsed it expands them without flashing; does not override a manual "Reveal in Explorer" (`pendingExplorerReveal`). The code comment says "mirrors VS Code's explorer.autoReveal". No toggle.
- V: `explorer.autoReveal` = `true | false | 'focusNoScroll'`, default `true` (`files.contribution.ts:444-454`); `explorer.autoRevealExclude` defaults to `{**/node_modules: true, **/bower_components: true}` (`:455-478`).

**Lazy loading**
- O: one directory read at a time on expand: `fs:readDir` → `readdir(withFileTypes)` → `sortDirEntries` (`main/ipc/filesystem/filesystem-read-handlers.ts:27-56`). Cache `dirCache[path]`; on `force` reread old children stay visible so the virtualizer does not jump to the top (`useFileExplorerTree.ts:64-76`). Collapsed but cached directories are marked stale after overflow and reread on next expand (`file-explorer-stale-dir-cache.ts`). Rows are virtualized (`@tanstack/react-virtual`, `useFileExplorerAutoReveal.ts:2`).
- V: `ExplorerItem.fetchChildren` — async tree; a directory resolves on first expand (`explorerModel.ts:210-226, 312`).

**Refresh on disk change**
- O (main): one recursive `@parcel/watcher` on the worktree root (via a separate child process, `parcel-watcher-process*.ts`), ignoring: `.git node_modules dist build .next .cache target .venv __pycache__`; on macOS the first 8 paths are excluded at fseventsd level, the rest by userspace regex (`main/ipc/filesystem-watcher-ignore.ts:5-45`). Coalescing: trailing 150 ms, max 500 ms (`shared/filesystem-watch-batch-window.ts`), "last event per path"; delete→create reports both, create→delete cancels (`filesystem-watcher-local-events.ts:22, 176-208`). More than 5000 events in a batch is one `overflow` event (`filesystem-watcher-event-batch.ts:3`).
- O (renderer): `useFileExplorerWatch.ts` + `file-explorer-watch-reconcile.ts` turn events into point `refreshDir(parent)` calls for cached directories only; `overflow` → full `refreshTree` (root + disclosed, with bounded parallelism). A file `update` event does not touch the tree. While an inline input is open or a drag runs, events accumulate and apply after (`useFileExplorerWatch.ts:120-190, 255-293`). Extra renderer delay is 0 ms (the batch is already assembled in main).
- V: recursive parcel-watcher in a utility process; `FILE_CHANGES_HANDLER_DELAY = 75` ms, then `ThrottledWorker`: batches of 500, 200 ms pause, buffer no more than 30000 events (`platform/files/node/watcher/parcel/parcelWatcher.ts:177-185`). `files.watcherExclude` defaults to `.git/objects/**`, `.git/subtree-cache/**`, `.hg/store/**` (`files.contribution.ts:294-311`). The explorer reacts with a 500 ms delay (`explorerService.ts:37`), updates ONLY when a visible allowed element was deleted (or changed under `modified` sort) or a new one was added into an already resolved parent (`:77-104, doesFileEventAffect :524`); on window focus back a full `refresh(false)` "to compensate for lost events" (`:136`); events are ignored during inline editing (`:109`).
- Δ: both are one recursive root watcher with point updates. Orca suppresses noise harder (ignores `dist/build/target`), VS Code compensates losses with a focus reread. Conclusion for Tagma: an overflow signal → full reread is needed, plus deferring updates during inline input.

**Very large directories**
- O: no paging or entry limit on `readdir` found; protection is row virtualization. Limits exist only in Quick Open (section 8) and search (section 9).
- V: no explorer paging; virtualized tree. No child-count limits found.

---

## 2. File operations

**Create (inline in tree)**
- O: `startNew(type, parentPath, depth)` expands the parent and inserts an input row below the subtree (`useFileExplorerInlineInput.ts:68-80`). Enter creates, Escape cancels, blur after 150 ms also commits (like Finder), the first 200 ms of blur are ignored (focus returns after the menu closes) — `file-explorer-inline-input-row.tsx:97-163`. A created file opens in the editor at once (`mode: 'edit'`, not preview); folders and files land on the undo stack. An error is a toast, the directory is reread.
- V: `explorer.newFile`/`newFolder` commands, inline input; a name with `/` creates nested paths (`fileActions.ts:refreshIfSeparator`, `:80-86`).

**Rename**
- O: Enter on a row (no modifiers) — `useFileExplorerKeys.ts:224-228`; double click on the name (`FileExplorerRow.tsx:206-231`); also double click on the tab. Selection is the name without extension (up to the last dot, `file-explorer-inline-input-row.tsx:93-98`). Same name does nothing. `F2` is not bound (conclusion: grep for `F2` in explorer hooks is empty).
- V: `F2`, on macOS `Enter` (`fileActions.contribution.ts:56-60`), only for writable non-roots.
- Δ: Orca uses Finder logic (Enter = rename, no F2); VS Code F2 everywhere and Enter only on Mac.

**Delete**
- O: local files go to the OS trash (`shell.trashItem`, `main/ipc/filesystem/filesystem-write-handlers.ts:76`); exception is WSL UNC (hard `rm`). No confirmation for local delete, even for a batch; confirmation only for remote (SSH/runtime) paths where there is no trash (`useFileDeletion.ts:73-98, 238-262`). Before deletion dirty tabs are force-saved (otherwise undo reads stale disk), then autosave timers are muted (`:103-117`); tabs with that path and descendants are then closed (`:196`), `expanded` entries for the subtree are cleaned. ENOENT on a race with an external delete is ignored.
- V: `files.enableTrash` defaults to `true` (`files.contribution.ts:232-236`); `explorer.confirmDelete` defaults to `true`, a "Do not ask me again" checkbox switches the setting off (`fileActions.ts:134-176`). Shortcuts: `Delete` (win/linux) or `Cmd+Backspace` (mac) to trash; `Shift+Delete` / `Cmd+Alt+Backspace` permanently (`fileActions.contribution.ts:65-97`). On trash error a "Delete Permanently" dialog (`fileActions.ts:225-252`). Dirty copies get a separate warning first, then the confirmation is skipped. Read-only files get an extra dialog.
- Δ: VS Code asks by default; Orca does not (with undo only for text files, see below). For Tagma: undo is safer than a dialog, but OS trash matters more than both.

**Move by drag&drop**
- O: dragging onto a folder (or a file row → its parent) expands the folder after 500 ms (`useFileExplorerRowDrag.ts:9`); multi-drag supported (MIME path list, `FileExplorerRow.tsx:150-168`). No confirmation. Not into itself or a descendant; same parent is a no-op (`useFileExplorerMoveDrop.ts:43-55`). The operation is an editor transaction (below) plus an undo write. Native files from Finder are copied in (`useFileExplorerImport.ts`).
- V: `explorer.enableDragAndDrop` = `true`, `explorer.confirmDragAndDrop` = `true` (`files.contribution.ts:479-488`; "Are you sure you want to move…" dialog, `explorerViewer.ts:1855-1885`). Copy with Alt held (mac) / Ctrl (win/linux) (`:1850`, no confirmation asked for a copy). `explorer.autoOpenDroppedFile` = `true`. A native drop confirms with `explorer.confirmPasteNative` = `true`.

**Copy / paste / duplicate**
- O: "Duplicate" only for files, name `stem copy.ext`, `stem copy 2.ext`… existence check + `COPYFILE_EXCL` with up to 10 retries (`useFileDuplicate.ts`, `main/ipc/filesystem-mutations.ts:135-137`). Cut/paste inside the tree not found. "Copy" in the context menu puts the file into the OS buffer as an object (a single file; for SSH it is first copied locally — docs `file-explorer.mdx`). Copying paths: `Cmd+Alt+C` and `Cmd+Alt+Shift+C` (`shared/keybindings/definitions-core-3.ts:158-179`).
- V: `Cmd+X`, `Cmd+C`, `Cmd+V` in the explorer, Esc cancels cut (`fileActions.contribution.ts:99-140`); duplicates are `explorer.incrementalNaming` = `simple | smart | disabled`, default `simple` (`files.contribution.ts:561-571`).

**Multi-select**
- O: `Cmd/Ctrl` click toggles, `Shift` click is a range, both are an additive range (`file-explorer-selection.ts:getFileExplorerSelectionMode`); deletion and path copying work over the set. Nested roots collapse (`selectDeletionRoots`).
- V: `workbench.list.multiSelectModifier`, default `ctrlCmd` (`platform/list/browser/listService.ts:1389`).

**Undo/redo of file operations**
- O: an in-memory 50-step linear stack (`fileExplorerUndoRedo.ts:7`), fires only with tree focus: `Mod+Z` / `Mod+Shift+Z` (linux/win also `Ctrl+Y`) — `useFileExplorerKeys.ts:131-153`, `definitions-core-3.ts:139-157`. Covers: file/folder create, rename, move, delete of ONLY a text file (its content is read before deletion and written back; no undo for folders and binaries — `useFileDeletion.ts:134-197`). The OS trash is not used for undo.
- V: `explorer.enableUndo` = `true`, `explorer.confirmUndo` = `verbose | default | light` — `files.contribution.ts:499-513`. Via `IUndoRedoService`/`ResourceFileEdit`; for trash deletion file contents up to 5 MB are kept for undo (`MAX_UNDO_FILE_SIZE`, `fileActions.ts:79`), folders are irreversible, and the dialog warns "This action is irreversible!" (`:164-165`).
- Δ: similar functionality; for Tagma the important choice is restoring from the OS trash (not portable) vs storing contents ourselves (as both do).

**Open tabs**
- O (rename/move): `executeOpenEditorPathMove` (`renderer/src/lib/execute-open-editor-path-move.ts`) — one transaction: mute deferred saves of affected tabs → mark the source path suppressed (so the watcher does not mistake delete for external) → `rename` on disk → reindex open tabs in place, including tabs inside the renamed folder (`remapOpenEditorTabsForPathChange`, :97). When reindexing fails, roll the rename back on disk. A dirty buffer moves with the tab; such tabs get a "gate" waiting for disk confirmation (`pendingSelfMoveEcho`).
- O (delete): tabs close, saved beforehand. External delete/rename (not through Orca): the tab stays, the heading is struck through (`tab-bar/EditorFileTab.tsx:94, 329`), marked `externalMutation = 'deleted' | 'renamed'`, removed when the file returns (`hooks/editor-external-watch-event-reconciliation.ts:34-150`, 75 ms debounce; a delete+create pair with the same basename is marked `renamed`).
- V: built-in rename/move operations carry editors (`WorkingCopyFileService`); delete from inside closes; external delete/rename leaves an orphan tab when `workbench.editor.closeOnFileDelete` = `false` (default, `workbench.contribution.ts:346-350`); dirty ones never close automatically. Orphan check: delete event + 100 ms pause + `exists()` (against false events on network drives, `textFileEditorModel.ts:178-185`).

---

## 3. Tabs

**Preview tab**
- O: clicking a file in the explorer opens with `preview: true` (`useFileExplorerHandlers.ts:150`); within a tab group and worktree there is at most one preview tab, the next preview opening replaces it in place (keeping position, `open-file-apply.ts:167-250`). The mark is italics (`EditorFileTab.tsx:329`). It is pinned by: double-clicking the file row (`useFileExplorerHandlers.ts:261`, `makeFilePermanent`), any edit (`markFileDirty` removes preview — `store/slices/editor/actions/open-file-mutations.ts:82-102`), opening by non-preview paths (Quick Open, terminal links, file creation, search). No separate setting (`enablePreview` is not in code). An evicted preview can be returned with `Cmd+Shift+T`, but only when the caller enabled `recordReplacedPreview`; not from the explorer.
- V: `workbench.editor.enablePreview` = `true`; `enablePreviewFromQuickOpen` = `false`; `enablePreviewFromCodeNavigation` = `false` (`workbench.contribution.ts:331-345`). Pinning: double-clicking a tab/file in the explorer, an edit, "Keep Open". One preview tab per group (`editorGroupModel.ts:212, 359-382`).
- Δ: in Orca Quick Open and links open pinned, in VS Code Quick Open by default is pinned too (setting off). I.e. they match.

**Pinned tabs**
- O: `isPinned` is in the tab model (`shared/tab-types.ts:70`: "pinned tabs survive close others"; a close guard — `store/pinned-tab-close-guard.ts`). Pins for editors are a shared unified-tab mechanism (terminals, browser, editors in one bar).
- V: sticky: `Cmd+K Shift+Enter` pin (`editorCommands.ts:1404`), "Close Others/Right/All" exclude sticky (`excludeSticky`, `editorCommands.ts:857, 886, 901, 927`), `workbench.editor.pinnedTabSizing`, `pinnedTabsOnSeparateRow`.

**Close others / reopen**
- O: "Close Others", "Close to Right" context menu (`EditorFileTabContextMenu.tsx:163`, `tab-group/useTabGroupCloseScopeCommands.ts`); `tab.close` = `Mod+W`, `tab.closeAll` = `Mod+Alt+W`, `tab.reopenClosed` = `Mod+Shift+T`. Closed stack is 10 per worktree (`MAX_RECENT_CLOSED_EDITOR_TABS`, `open-file.ts:167`); reopening restores position and group.
- V: recently closed stack is 20 (`historyService.ts:663`), navigation history 200 (`:854`), `Cmd+Shift+T`.

**Tab restore after restart**
- O: the session serializes with a 150 ms debounce (`renderer/src/lib/session-write-subscriber.ts:116`) and keeps per file: `filePath`, `relativePath`, `worktreeId`, `language`, `isPreview`, `runtimeEnvironmentId`, `externalSshTargetId`, `readOnly`, `liveTail` and — only for dirty ones — `dirtyDraftContent` + `lastKnownDiskSignature` (`shared/workspace-session-editor-schema.ts:6-18`, `renderer/src/lib/workspace-session.ts:120-150`). Only `edit`-mode tabs are kept (diff/conflict are not), the active tab per worktree, and group order. Cursor and scroll: 20-entry LRU in a module cache (`lib/scroll-cache.ts:6`) — i.e. they survive tab switches but NOT restart (no cursor/scroll fields in the session schema). No tab-count limit found.
- O (hot exit): dirty drafts are kept in the session; on start a disk-conflict scan runs for them before autosave enables (`editor-restored-tab-conflict-scan.ts`, `pendingDiskBaselineVerification`).
- V: group serialization with preview/sticky/mru indexes (`editorGroupModel.ts:1213`); `workbench.editor.restoreViewState` = `true` (scroll/cursor are kept per group and survive tab close, `workbench.contribution.ts:410-415`), `sharedViewState` = `false`; `files.hotExit` = `onExit` on desktop (`files.contribution.ts:123-145`) — unsaved is restored; `files.restoreUndoStack` = `true` (20 MB budget for closed-model stacks, `modelService.ts:86`). Tab limit: `workbench.editor.limit.enabled` = `false`, `limit.value` = `10`, `excludeDirty` = `false`, `perEditorGroup` = `false` (`workbench.contribution.ts:459-478`).
- Δ: Orca does not persist cursor/scroll across restart; VS Code does. For Tagma it is cheap to add.

---

## 4. Autosave

- O: `editorAutoSave` setting, default `false` (`shared/default-global-settings.ts:50`), `editorAutoSaveDelayMs` delay 1000 ms, range 250..10000 (`shared/constants.ts:94-96`; UI: Settings → General → "Auto Save Files"/"Auto Save Delay", `GeneralEditorSettingsSection.tsx:98-140`). The trigger is ONLY idle: on every draft change the timer resets (`editor-save-queue.ts:187-215`: `window.setTimeout(...)` after the last edit). No save on blur/loss of focus found in code (grep for `blur` in `components/editor` gives only `IpynbCellEditor`, `setup-contextual-copy`, `useModifierHeldClass`). ⚠ `docs/site/content/docs/editing/monaco.mdx` claims "save on blur and after short idle… There is no dirty dot" — this diverges from code: the dirty dot exists (`tab-bar/EditorFileTab.tsx:365-373`), autosave is off by default, there is no blur trigger.
- O: per-file save queue with "generations" (`saveGeneration`) so stale writes do not overwrite a rename/close result (`:62-100`); write is `fs:writeFile` → `writeFile(path, content, 'utf-8')`, NOT atomic, UTF-8 only, no mtime check (`main/ipc/filesystem/filesystem-write-handlers.ts:42`). Before writing a "self-write" is registered (750 ms TTL locally, 3 s for SSH/runtime) so the watcher's own echo is not treated as external (`editor-self-write-registry.ts:14-24`). Autosave is suspended while the tab is marked `changed` (external change), waits for disk-baseline verification, or owner change (`editor-autosave.ts:isAutosaveSuspendedForFile`); an explicit `Mod+S` goes through and overwrites (the banner warned).
- O (dirty close): a close request queues the file into a Save / Discard / Cancel dialog; "Save" waits up to 10 s for closing and on failure shows a "Save timed out or failed. Fix errors before closing." toast and returns the dialog (`components/use-terminal-editor-close-dialog-actions.ts:36-82`); "Discard" mutes timers and closes. Window/quit close: `ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT` saves all dirty and refuses when some cannot autosave or one path is open in two dirty tabs (`editor-restart-save-handlers.ts:35-69`); otherwise hot-exit.
- O (write error): an explicit save is a "Failed to save the file. Please try again." toast and `false` (`editor-file-save-attempt.ts`); autosave is called as `void queueSave(...)` without catch (conclusion: the failure is quiet, the tab stays dirty, the next attempt is on the next edit). In advance: after a failure `clearSelfWrite`, so a real event is not suppressed.
- V: `files.autoSave` = `off | afterDelay | onFocusChange | onWindowChange`; default `off` (desktop) / `afterDelay` (web) (`files.contribution.ts:261-274`); `files.autoSaveDelay` = `1000`, min `0` (`:275-281`); `files.autoSaveWorkspaceFilesOnly` = `false`, `files.autoSaveWhenNoErrors` = `false`. Implementation is `workbench/browser/parts/editor/editorAutoSave.ts`: the timer resets on every content change (`onDidChangeContent` → `scheduleAutoSave`, :230-260), `onFocusChange` fires on active-editor change and panel blur (:106-125), `onWindowChange` on window blur. For a "short delay" (≤ 1000 ms, `filesConfigurationService.ts:128, 454`) the mode is marked `AFTER_SHORT_DELAY` (used by UI to hide the indicator). Untitled and read-only are not autosaved.
- V (close): Save / Don't Save / Cancel dialog (`editorGroupView.ts:1778-1844`, `fileDialogService.showSaveConfirm`); `files.hotExit` lets it never ask at all on exit. A save failure: the model stays dirty, in error mode, a notification with Retry / Compare / Overwrite / Revert / Save as Admin actions (`textFileSaveErrorHandler.ts:129-170, 247-400`).
- Δ: VS Code has blur modes and "don't save on diagnostic errors"; Orca is idle-only. Orca does not guard the write against an external race on write (protection is on the UI side via a banner).
---

## 5. File changed on disk while open

**Clean buffer**
- O: watcher events → `notifyEditorExternalFileChange` → for NON-dirty tabs: when the tab is active and visible an immediate reload with `force` (`useEditorPanelExternalContentEvents.ts:60-100`), otherwise content is invalidated and loads on activation. The Monaco model updates with one edit over the whole range with undo stops before and after, so a reload is undone with `Cmd+Z` (`monaco-content-sync.ts:49-77`); cursor/scroll position is kept by Monaco itself (conclusion — no confirming scroll test found). Own writes are filtered via the self-write registry. Rich-markdown echo reload once reset the cursor to the end — that is why the registry was introduced (`editor-self-write-registry.ts:3-13`).
- V: `TextFileEditorModelManager.onDidFilesChange`: for every NON-dirty model on `UPDATED|ADDED` queues a reload (queue size ≤ 2 per resource) — `textFileEditorModelManager.ts:122-136, 153-166`. Update via `ModelService.updateModel` → `_computeEdits` + `pushEditOperations` with `pushStackElement` before/after, so view and cursor are kept, the reload is undoable (`modelService.ts:376-385, 412`).

**Dirty buffer**
- O: the draft is NOT reloaded. The tab is marked `externalMutation = 'changed'` (`editor-changed-on-disk-mark.ts`), autosave is blocked, and an amber "This file changed on disk while you have unsaved edits. Saving will overwrite the newer disk content." banner appears under the header with Compare / Reload from Disk / Keep My Edits buttons (`ExternalFileChangeBanner.tsx:132-186`). "Reload" drops the draft and shows a "Reloaded from disk" toast with an Undo button for 8 seconds (`:21-70`); "Keep" removes the mark and shifts the base (double FNV hash + length, `diff-content-signature.ts:getDiskBaselineSignature`); "Compare" is a compare dialog. An explicit `Mod+S` overwrites.
- V: dirty models are not reloaded. The conflict is found on SAVE by etag/mtime (`FILE_MODIFIED_SINCE`, `textFileEditorModel.ts:938-940, 992-994`): "Failed to save '…': The content of the file is newer. Please compare your version with the file contents or overwrite…" with Compare / Overwrite / Revert actions (`textFileSaveErrorHandler.ts:129`). The `files.saveConflictResolution` = `askUser` setting (otherwise `overwriteFileOnDisk`) — `files.contribution.ts:354-367`.
- Δ: Orca detects the conflict at once, on external write; VS Code lazily, on save. The Orca banner is nicer and safer (autosave blocks), but it needs storing the disk base signature and scanning restored tabs.

**Deleted file on disk**
- O: the tab stays, the heading is struck through (`externalMutation: 'deleted'`), removed when the file returns; the buffer is not lost. Details in section 2.
- V: the model goes "orphan" (checked after 100 ms via `exists`), the tab stays, `closeOnFileDelete` = `false`; saving recreates the file.

**Renamed file on disk**
- O: when the same batch has a create with a matching basename the mark is `renamed`, otherwise `deleted`; the tab does NOT follow the new name, only strikes through (`editor-external-watch-event-reconciliation.ts:92-134, 270-300`).
- V: an external rename is delete + add → orphan; it follows only through its own service operations.

---

## 6. Large, binary, and image files

**Thresholds and detection**
- O: `MAX_TEXT_FILE_SIZE` = 50 MB, above it "File too large: X MB exceeds 50MB limit" (`filesystem-file-content-inspection.ts:6`, `filesystem-read-handlers.ts:73-80`). Binary: any NUL byte in the first 8192 bytes (`BINARY_PROBE_BYTES = 8192`, `isBinaryBuffer`, :54-63); for files over 8 KB only the prefix is read first so archives are not buffered whole (`:96-99`). No encodings — reading is always `buffer.toString('utf-8')`. For a binary file the editor shows a "Binary file — cannot display" placeholder (`EditorEditFileSurface.tsx:122-124`); no "Open anyway" button.
- V: detection is the first 512 bytes (`ZERO_BYTE_DETECTION_BUFFER_MAX_LEN`, `workbench/services/textfile/common/encoding.ts:27`): when a zero byte is present and does not fit the UTF-16 LE/BE "zero on odd/even positions" pattern it is binary; BOM is checked earlier (`:447-483`). Encoding: `files.encoding` = `utf8`, `files.autoGuessEncoding` = `false` (jschardet), `files.candidateGuessEncodings` = `[]`. A binary file gets a `BinaryFileEditor` with "The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding." text and an "Open Anyway" button (`workbench/browser/parts/editor/binaryEditor.ts:63-73`); `workbench.editor.defaultBinaryEditor` = `''` (ask).
- V (size): `workbench.editorLargeFileConfirmation` — minimum 1 MB, default 1024 MB locally, 10 MB remote, 50 MB web (`platform/files/common/files.ts:1630-1654`); above it "The file is not displayed in the text editor because it is very large" with an open button (`textFileEditor.ts:196-203`). Optimizations (`editor.largeFileOptimizations` = `true`): tokenization/wrap/folding/codelens/word highlight/sticky scroll switch off past 20 MB or 300,000 rows (`textModel.ts:189-190, 338-341`); heap operations past 256M characters (`:191`); a "Forcefully Enable Features" banner (`contrib/codeEditor/browser/largeFileOptimizations.ts:44-62`). Misc: `editor.maxTokenizationLineLength` = 20000, `editor.stopRenderingLineAfter` = 10000.
- O (Monaco): tokenization thresholds are stock Monaco (the comment in `filesystem-file-content-inspection.ts:5` confirms "Monaco degrades features on large files like VS Code"); none of its own found.

**Orca viewers**
- Images/PDF: `.png .jpg .jpeg .gif .svg .webp .bmp .ico .pdf` extensions are read as base64 and shown in `ImageViewer`/`PdfViewer` (50 MB limit, `filesystem-file-content-inspection.ts:10-20`). Conclusion: `.svg` opens ONLY as an image (no text editing — by MIME table). PDF: scale/scroll position are remembered in the session (`pdf-view-position.ts`, docs: "session-only").
- Misc: CSV/TSV is a read-only table (`CsvViewer.tsx`, "Table" toggle), `.ipynb` is a Notebook viewer (beta), Mermaid, HTML is a browser-tab preview.
- V: images/audio/video are the `media-preview` extension (binary custom editor); PDF is not built in.

---

## 7. Markdown

**Does Orca have a rich editor: yes.** TipTap/ProseMirror next to Monaco; `.md` opens in rich by default (`markdown-preview-controls.ts:71-77`: `modes.includes('rich') ? 'rich' : 'source'`; in diff `source`).
- Modes: `MarkdownViewMode = 'source' | 'rich' | 'preview'` (`store/slices/editor/types/open-file.ts:152`) — a segmented switch in the header (`EditorViewToggle.tsx`: Source / Rich Editor / Preview / Edit / Changes); the mode is per file (`markdownViewMode[fileId]`) and does not survive restart (conclusion: no field in the session schema except `markdownFrontmatterVisible`). A separate preview tab: `editor.markdownPreview` = `Mod+Shift+V`. ⚠ docs claim "Cmd-Shift-M switches to raw Monaco", in code `Mod+Shift+M` = `tab.newMarkdown` ("New markdown tab", `definitions-core-2.ts`); no separate rich↔source shortcut found.
- Threshold divergence: docs write ">300 KB → raw first" (`docs/…/markdown.mdx`), in code `RICH_MARKDOWN_MAX_SIZE_BYTES = 600 * 1024` (`shared/constants.ts:92`); checked by UTF-8 bytes without allocation (`markdown-rich-size-limit.ts`). Past the threshold the mode is `source` with a banner and "Open anyway" (override lives until the tab closes; `markdownRichModeSizeOverride`).
- Invalid for rich (stays `source`, "Editable only in code mode because…" banner, `markdown-rich-mode.ts:25-110`): (1) HTML/JSX/MDX — `<tag…>`/`<!-- -->` regex, except when inline HTML survives round-trip (checked up to 50,000 characters; larger is conservatively blocked); (2) reference-style links `^[x]: url`; (3) footnotes `^[^x]: `. Code blocks are cut from the check.
- Front matter: YAML `---` and TOML `+++` are cut before TipTap (`markdown-frontmatter.ts`, regex `^(---|\+\+\+)\r?\n…`), shown as a block, glued back with "exactly one newline" normalization (`prependFrontMatter`); per-file visibility ("Hide front matter" in the "…" menu).
- Tables: GFM via TipTap with Tab/Shift-Tab/Enter/Backspace keys (docs); row/column toolbar.
- Round-trip fidelity (the main thing): rich does NOT write "canonical" markdown over the file blindly. `reconcileSerializedMarkdown` (`rich-markdown-source-reconcile.ts`) carries the edit into the source text with a diff-match-patch patch: (1) no semantic changes → return source bytes; (2) only EOL/trailing-newline difference → keep EOL; (3) document over 50,000 characters → canonical output (the file formatting is rewritten!); (4) otherwise patch over the source, on any hunk failure canonical output; (5) a control re-parse through a "throwaway" TipTap — when mismatched, canonical too. Dominant EOL (CRLF/LF) is always restored.
- What can break (inference from logic): documents over 50,000 characters in rich get canonicalized on every edit; complex HTML inserts are cut by heuristics; exotic Markdown extensions (math, footnotes, `[[…]]` wiki links — handled by a separate extension) are outside the checks.
- V: no built-in WYSIWYG; only `markdown.showPreviewToSide` and "Open Preview" (the `markdown-language-features` extension). The `workbench.editorAssociations` setting can swap the editor.
- Δ: for Tagma (CodeMirror + Svelte) a rich mode is a separate expensive project; when doing it, take Orca's reconcile approach (minimal patch over the source), otherwise the file is rewritten whole by markdown.

---

## 8. Quick Open (Cmd+P)

- O: file list is `rg --files --hidden` in TWO passes: main (respects `.gitignore`) and an "ignored pass" with `--no-ignore-vcs` (ignored files land in results too); directory blocklist `.git .next .nuxt .cache .stably .vscode .idea .yarn .pnpm-store .terraform .docker .husky .npm .npm-global .gvfs`, plus `node_modules` and `.local/share` (`shared/quick-open-filter.ts:14-30, 187-236`). No `--follow`. Nested linked-worktrees are excluded from the active result (`buildExcludePathPrefixes`). No `rg` → `git ls-files` fallback (two calls) or bounded `readdir` walk (50,000 entries, depth 256, 10 s — `shared/quick-open-readdir-budget.ts`). The list is not watcher-kept: requested on every open (`useRuntimeFileListForWorktree`).
- O (scorer): a plain subsequence over the whole lowercase path; score is the sum of gaps between matches − 5 per character after `/`, `.`, `-` − 100 when the file name contains the whole query; lower is better; a heap holds top-50 (`shared/quick-open-path-search.ts:4, 118-150`). Limits: query ≤ 2 KB, remotely ≤ 256 characters. No recents, no `path:line` syntax, no camelCase. Opening picks the file into a pinned tab (`QuickOpen.tsx:99-108`).
- V: `workbench.action.quickOpen`, `Cmd+P`; on empty query — editor history; on query — history + file search (`search.quickOpen.includeHistory` = `true`, `history.filterSortOrder` = `default | recency`) — `anythingQuickAccess.ts:500-553`; search via `ISearchService.fileSearch` (rg `--files --hidden --case-sensitive --no-require-git`, `--no-ignore`/`--no-ignore-parent`/`--follow` per settings; `ripgrepFileSearch.ts:31-83`), `search.exclude` defaults to `{**/node_modules, **/bower_components, **/*.code-search}` (`search.contribution.ts:106`), `search.useIgnoreFiles` = `true`, `useGlobalIgnoreFiles` = `false`, `useParentIgnoreFiles` = `false`, `followSymlinks` = `true`. Result limit `MAX_RESULTS = 512`, typing delay `TYPING_SEARCH_DELAY = 200` ms (`:107-109`). Scorer `base/common/fuzzyScorer.ts`: compared by label (file name) and description (path); on file-name prefix match the base is `1<<17` + length-share bonus, otherwise `1<<16` (`:380-381, 474-555`); inside — bonuses: +1 per character, runs up to 3 characters 6 each (then 3 each), +1 case, +8 word start, +2 camelCase, plus separator bonus; a multiword space-separated query must match all; history matches only by name when the query has no `/`.
- Position syntax: `file:12:5`, `file#12`, `file(12,5)`, `file:12-20`, `file line 12` etc. (`LINE_COLON_PATTERN`, `contrib/search/common/search.ts:154-161`); `@` / `#` prefix for symbols.
- Δ: VS Code is fundamentally better on relevance (path vs name, recents, `:line`). For Tagma take the "name above path + history + `:line`" structure; the Orca scorer is too simple.

---

## 9. File search

- O: engine is `rg --json --hidden --glob '!.git' --max-count 100 --max-filesize 5M [--ignore-case|(case-insensitive by default)] [--word-regexp] [--fixed-strings] --glob include / --glob !exclude -- query root` (`shared/text-search.ts:57-85`). Respects `.gitignore` (no `--no-ignore`). Limits: 2000 matches total (`DEFAULT_SEARCH_MAX_RESULTS`), 100 per file, row context ≤ 500 characters, 15 s timeout, JSON row structure ≤ 32K tokens/depth 16. A new search kills the previous rg of the same root (`filesystem-search-handlers.ts:55-61`). Not streaming: the result is given as one `SearchResult { files, totalMatches, truncated }`; renderer debounce 300 ms (`useFileSearchRunner.ts:16-17`). Comma-separated glob lists with escaping (`text-search-glob-patterns.ts`). Toggles: case / whole word / regex; "Files to include / exclude". "Find in Folder" from the folder menu and `Cmd+Shift+F` with a picked folder substitute include `folder/**`. Replace and replace-all NOT found (grep `replace` over Search*.tsx empty). Fallback without rg is `git grep` (`filesystem-search-git.ts`).
- V: `rg --hidden --no-require-git --json --crlf --no-config [--ignore-case|--case-sensitive] [--fixed-strings|--regexp] [-g globs] --max-filesize N [--no-ignore] [--follow] [--multiline]` (`workbench/services/search/node/ripgrepTextSearchEngine.ts:407-510`). `search.maxResults` = `20000` (`services/search/common/search.ts:32`), `search.searchOnType` = `true`, `searchOnTypeDebouncePeriod` = `300` ms, `search.smartCase` = `false`, `search.exclude` and `files.exclude`, `search.mode` = `view`. Results stream. Replace: `Cmd+Shift+H`, "Replace All" (`Cmd+Alt+Enter`/`Cmd+Shift+Enter`), `search.useReplacePreview` = `true` — diff preview before applying (`searchActionsRemoveReplace.ts:185-235`).
- Δ: Orca is a minimal search without replace and streaming; for Tagma cheapest is Orca rg args + streaming + a "truncated" counter.

---

## 10. Paths from terminal and chat output

- O: link detection ported from VS Code (comment in `renderer/src/lib/terminal-links.ts:19-22`). Two passes: a path with separators + optional `:line:col` (`LOCAL_PATH_REGEX`, :36) and "bare" file names that become a link only when resolved from cwd (`terminal-bare-file-link-detection.ts`); separate branches for paths with spaces, `file://` URIs, WSL (`/mnt/c`→`C:`), width-wrapped rows (`hard-wrapped-terminal-path-fragments.ts`). Activation is `Cmd` click on macOS, `Ctrl` click otherwise; `Shift+Cmd/Ctrl` opens with the system app (`terminal-link-activation.ts:3-18`, `terminal-file-open-routing.ts:151-163`). The `openDetectedFilePath` route: `stat`; a known worktree root → workspace switch; a directory → OS; `.html` → browser tab; otherwise `openFile({mode:'edit'})` (pinned), the needed worktree activates (when the path is inside another, its owner is found), and with `line` Monaco turns on (`markdown` is forced to `source`, since rich cannot reveal by row) and after two `requestAnimationFrame` a `pendingEditorReveal {line, column}` is set (`:260-297`). Default column 1.
- V: detectors `terminalLocalLinkDetector`, `terminalWordLinkDetector`, `terminalUriLinkDetector`, `terminalMultiLineLinkDetector`; ≈40 suffix formats: `foo:339`, `foo:339:12`, `foo:339:12-789`, `foo#339`, `"foo", line 339, col 12`, `foo 339` etc. (`links/browser/terminalLinkParsing.ts:57-86` — list in comments). Opening: `openEditor({ resource, options: { pinned: true, selection, revealIfOpened: true }})` (`terminalLinkOpeners.ts:50-52`); `terminal.integrated.enableFileLinks` = `on | off | notRemote`.
- Chat: no separate chat path detector searched in Orca. Links in markdown preview go through `store/slices/editor/actions/markdown-link-action.ts` (calls `openFile`, rows 117 and 161); otherwise the route is the same `openFile` + `pendingEditorReveal`.
- Δ: both open `pinned` with a `line:col` position. VS Code knows more suffix formats.

---

## 11. Explorer and tab keys

| Action | Orca (mac) | VS Code (mac) | Source |
|---|---|---|---|
| Quick open | `Mod+P` | `Cmd+P` | `definitions-core-1.ts:8`; `quickAccessActions.ts:128` |
| File search | `Mod+Shift+F` (`sidebar.search.toggle`) | `Cmd+Shift+F` | `definitions-core-1.ts`; `search.contribution.ts:73` |
| Show explorer | `Mod+Shift+E` | `Cmd+Shift+E` | same |
| Close tab | `Mod+W` | `Cmd+W` | `definitions-core-2.ts`; `editorCommands.ts:838` |
| Close all tabs | `Mod+Alt+W` | not checked | |
| Reopen closed | `Mod+Shift+T` | `Cmd+Shift+T` | `editorActions.ts:1702` |
| Save | `Mod+S` | `Cmd+S` | `definitions-core-3.ts:59` |
| Rename in tree | `Enter` | `Enter` (mac), `F2` (win/linux) | `useFileExplorerKeys.ts:224`; `fileActions.contribution.ts:56` |
| Delete | `Mod+Backspace`, `Delete` (mac); `Delete` (win/linux) | same; permanent `Shift+Delete` / `Cmd+Alt+Backspace` | `definitions-core-3.ts:180-190`; `fileActions.contribution.ts:65-97` |
| Undo/redo file operations | `Mod+Z` / `Mod+Shift+Z` (Ctrl+Y) with tree focus | shared workbench undo/redo (`explorer.enableUndo`) | `useFileExplorerKeys.ts:131` |
| Cut / Copy / Paste files | no cut/paste; "Copy path" `Mod+Alt+C`, relative `Mod+Alt+Shift+C` | `Cmd+X/C/V`; Esc cancels cut | |
| Navigation | ↑↓ move selection, ←/→ collapse-expand/to parent/to first child, Home/End, PageUp/PageDown (step = 1/10 of list), Shift+↑↓ range, Space opens/collapses | standard tree navigation (WorkbenchCompressibleAsyncDataTree); exact key set not compared | `file-explorer-keyboard-navigation.ts:30-120` |
| Name filter | separate "name filter" field above the tree (not keyboard typing): builds a projection over the worktree file list | type-to-navigate (`workbench.list.typeNavigationMode` = `automatic`), `Cmd/Ctrl+F` is the find widget, `workbench.list.defaultFindMode` = `highlight`, `defaultFindMatchType` = `fuzzy` | `use-file-explorer-name-filter.ts`; `listService.ts:1430-1500` |
| Next/previous tab | `Mod+Alt+]`/`[` (one kind), `Mod+Shift+]`/`[` (all kinds), `Ctrl+Tab` (recent) | `Ctrl+Tab`, `Cmd+Shift+]`/`[` | `definitions-core-2.ts` |
| Tab by number | `Ctrl+1..9` (mac) / `Alt+1..9` | `Ctrl+1..9` | |
| Find/Replace in file | `Mod+F` / `Mod+Alt+F` (linux/win `Mod+H`) | `Cmd+F` / `Cmd+Alt+F` | |
| Word wrap | `Alt+Z` | `Alt+Z` | `definitions-core-3.ts` |

Orca explorer binds work only with focus inside the explorer shell and not in an input field (`useFileExplorerKeys.ts:34-38, 163-168`); they overlap via configurable keybindings checked for group conflicts.

---

## 12. Which checkout Orca shows

- The explorer is bound to `activeWorktreeId` (`FileExplorer.tsx:36`), the root is `activeWorktree.path` (:49); on worktree change the tree drops and rereads (`useFileExplorerTree.resetAndLoad`), disclosure state is per worktree in `expandedDirs[activeWorktreeId]` (:60-63; `expandedDirs` not found in the session schema — conclusion: does not survive restart), the dotfiles flag is per worktree (`showDotfilesByWorktree`).
- Active worktree choice: "Switch worktree" palette `Mod+J` (linux/win `Mod+Shift+J`), `Mod+Shift+↑/↓` previous/next, `Mod+1..9` by index, `Mod+Alt+←/→` history (`definitions-core-1.ts:20-60`), worktree list sidebar, jumping via a terminal link to another worktree root (`terminal-file-open-routing.ts:158-163`).
- Editor tabs are bound to a worktree (`openFiles[].worktreeId`); each worktree has its own tab group and order; opening a file from another worktree's terminal switches to it.
- Quick Open and search run at the active worktree root; nested linked-worktrees under a repository root are excluded (`getNestedWorktreeExcludePaths`, `quick-open-file-list.ts:63-77`).
- V: no worktree concept; one workspace is one window (multi-root: several roots in one explorer); the git extension has a `'worktree'` repository view (`repository.ts:321`, `_repositoryKind`), but switching is opening another folder/window.

---

## What could not be found / docs vs code divergences

- Orca: a preview-tab off setting, `compact folders`, replace in search, cut/paste in the tree, large-directory paging, cursor/scroll persist across restart — not found.
- Orca docs vs code: autosave ("on blur, no dot") vs code (off by default, idle-only, the dot exists); rich markdown threshold 300 KB vs 600 KB; rich/raw switch shortcut `Cmd-Shift-M` vs `tab.newMarkdown`.
- The `gitStatusByWorktree` source and refresh rate (git status branches) for tree decorations not traced (only the consumer in `use-file-explorer-tree-pane-state.ts:128-143`).
- The quiet-autosave-failure and clean-reload scroll-keeping conclusions are not test-confirmed.

## What to copy, where to diverge (for Tagma, condensed)

- Copy: preview tab (click is preview, double click/edit pins); recursive watcher with noisy-directory ignore, 75–150 ms coalescing and overflow signal → full reread; deferred event application during inline input; Enter/F2 rename, extensionless name selection; natural sort with folders on top; OS trash for delete; transactional rename/move with open-tab rebinding (including nested); Compare/Reload/Keep banner for a dirty buffer and autosave block during conflict; binary detection by NUL in the first 512–8192 bytes; `rg --files --hidden` with a blocklist; `rg --json` with limits; `path:line:col` links opening pinned.
- Diverge with reason: Quick Open scorer — take VS Code (name > path, history, `:line`), Orca's is too simple; file write is atomic (tmp+rename) and with mtime/etag check, Orca's bare `writeFile`; persist cursor/scroll (cheap, Orca lacks it); do not hard-hide `node_modules`, make it a configurable `files.exclude`; encoding detection at least UTF-8/UTF-16 BOM, Orca has UTF-8 only; delete undo is content-based with a size limit (both do so); rich-markdown only with a reconcile patch over the source, otherwise keep source + preview.
