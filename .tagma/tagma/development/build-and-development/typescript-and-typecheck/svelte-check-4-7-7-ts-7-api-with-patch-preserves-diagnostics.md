---
id: 01a16159-97c2-77f8-9d03-e8d7044c3891
title: "svelte-check 4.7.7: TS 7 API with patch preserves diagnostics and speeds up chat-ui and app"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "svelte-check 4.7.7 and TypeScript 7.1.0-beta",
      "ref": "svelte-check@4.7.7; @typescript/native = npm:typescript@7.1.0-beta; patches/svelte-check@4.7.7.patch"
    }
  }
edges:
  - kind: relates
    to: 01a1613d-8864-7cd6-b0fa-d0a9ec6237de
---
Measurements of svelte-check 4.7.7 on Bun 1.4.3, Node 26.8.1 and TypeScript 6.0.3 / `@typescript/native` → `typescript@7.1.0-beta`, macOS arm64. These are sequential single samples of a shared machine and shared checkout; HEAD moved under other work, load variance was not estimated. The package script `bun run typecheck` was measured, not a standalone tsc. For each mode the svelte-check arguments in the shared runner were temporarily changed. After the API fix, `--tsgo-experimental-api` under Node with the tsx loader was chosen; TypeScript 6 remains the JS API.

| Mode | Package | Wall, s | Diagnostics | Matches baseline |
| --- | --- | ---: | --- | --- |
| TS 6 baseline, Bun | chat-ui | 7.25 | 0 errors, 0 warnings | baseline |
| TS 6 baseline, Bun | app | 42.84 | 0 errors, 1 warning | baseline |
| --tsgo, Bun | chat-ui | 1.75 | 1 config error | no |
| --tsgo, Bun | app | 15.86 | 212 errors, 1 warning | no |
| API without patch, Bun | chat-ui | 0.75 | directoryExists crash, exit 1 | no |
| API without patch, Bun | app | 1.39 | directoryExists crash, exit 1 | no |
| API with patch, Node + tsx | chat-ui | 3.19 | 0 errors, 0 warnings | yes |
| API with patch, Node + tsx | app | 14.12 | 0 errors, 1 warning | yes |

A diagnostics match means identical case-preserved file, position, severity, code and message; the service source is not printed. On sensitivity `.ts` the baseline leaves source empty, native sets `ts`; the COMPLETED files-seen count also differs. These fields do not change the error list.

The app's only warning: `apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte(243,1): warning a11y_no_noninteractive_element_interactions: Non-interactive element \`<div>\` should not be assigned mouse or keyboard event listeners https://svelte.dev/e/a11y_no_noninteractive_element_interactions`.

Sensitivity was verified outside the repository: `Broken.svelte` holds an incompatible assignment in script and a `count.toUpperCase()` call in template; `use.ts` imports the component and assigns a string to a numeric prop via ComponentProps. Baseline TS 6 and --tsgo find all three errors; the unfixed API emits none due to the crash. After the patch the API emits exactly `Broken.svelte(4,9) TS2322`, `Broken.svelte(7,11) TS2339`, `use.ts(4,48) TS2322`, exit 1. On identical Node + tsx the baseline sensitivity took 0.97 s, the API 0.87 s; through the final runlith-typecheck the API took 1.08 s.

The patch changes the owner of the faulty contract in `svelte-check/dist/src/index.js`: all filesystem callbacks explicitly use the new API sentinels, ordinary reading goes to `serverFS.useOS`; a snapshot is created via createSnapshot, updated via snapshot.update, and releases its predecessor only when the object changes; the configured project is taken from the snapshot. Diagnostics paths come from the original snapshots, not from FileMap's case-insensitive keys. The synchronous native API uses Node `stdout._handle.fd`, which Bun 1.4.3 lacks. Node without tsx does not resolve existing `.js` specifiers to `.ts` sources when loading the Vite config; tsx keeps the same check configuration. The root manifest registers the Bun patch, native is installed via alias, tsx is declared a dependency of the command owner, the lockfile is written by Bun only.

The `--tsgo` mode was not chosen. Its generated tsconfig sets incremental:false but inherits composite:true from chat-ui; the mode needs a consistent generated config. Among the 212 errors in app are physically surviving generated `++LoadProcesses.svelte.ts` and other files whose source no longer exists; the generated-overlay glob includes them although the manifest need not contain them. There are also separate Svelte resolution problems: the `Pill.svelte` / `pill.svelte.ts` collision, tooltip casing, workspace components outside the root becoming `*.svelte` without concrete exports/props. Using --tsgo requires proper cleanup of the generated overlay and resolving these components, not fixing real sources for the extra diagnostics. None of the 212 errors are declared false: the full unmodified output is below.

The root `bun run tagma:typecheck` with the final native runner passed in 93.25 s after the review fixes, exit 0: no TypeScript errors, Svelte warnings layer 12 / query 9 / app 1, four doctrine checks passed. A separate unified-output smoke through the public sensitivity script printed root-relative single-line TS2322/TS2339/TS2322 and exited 1. On a clean chat-ui the final runner prints no START, COMPLETED, or empty count.

Below are the full stdout/stderr of the last 4.7.7 comparisons. The final chat-ui 3.19 s and app 14.12 s were taken with a direct `/usr/bin/time -p bun run typecheck` after the review fixes; earlier samples are not substituted into the speed decision. An independent review found project-wide short-circuit semantic diagnostics and snapshot release on no-op update; both are fixed in the patch. An added standalone syntax error in Syntax.ts proved the short-circuit: before the fix native emitted only TS1109, after — the same four syntax + semantic diagnostics as the baseline. Full red/baseline/green outputs below.


## 4.7.7-baseline-chat

```text
cwd: /opt/workspaces/runlith/packages/chat-ui
command: bun run typecheck 
exit: 0

stdout:
svelte-check @runlith/chat-ui
svelte-check found 0 errors and 0 warnings

stderr:
$ runlith-typecheck
real 7.25
user 14.74
sys 1.11

```


## 4.7.7-baseline-app

```text
cwd: /opt/workspaces/runlith/apps/tagma/app
command: bun run typecheck 
exit: 0

stdout:
svelte-check @tagma/app
/opt/workspaces/runlith/apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte:243:1
Warn: Non-interactive element `<div>` should not be assigned mouse or keyboard event listeners
https://svelte.dev/e/a11y_no_noninteractive_element_interactions (svelte)

====================================
svelte-check found 0 errors and 1 warning in 1 file

stderr:
$ runlith-typecheck
real 42.84
user 56.71
sys 11.41

```


## 4.7.7-tsgo-chat

```text
cwd: /opt/workspaces/runlith/packages/chat-ui
command: bun run typecheck 
exit: 1

stdout:
svelte-check @runlith/chat-ui
/opt/workspaces/runlith/packages/chat-ui/.svelte-check/tsconfig.json:3:3
Error: Composite projects may not disable incremental compilation. (js)

====================================
svelte-check found 1 error and 0 warnings in 1 file
[03:41:59.966] ERROR (#1): ChecksFailed: Type errors reported by svelte-check @runlith/chat-ui.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:95:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:62:27)

stderr:
$ runlith-typecheck
error: script "typecheck" exited with code 1
real 1.75
user 2.75
sys 0.59

```


## 4.7.7-tsgo-app

```text
cwd: /opt/workspaces/runlith/apps/tagma/app
command: bun run typecheck 
exit: 1

stdout:
svelte-check @tagma/app
/opt/workspaces/runlith/apps/tagma/app/src/routes/_desktop/dictation/+page.svelte:3:10
Error: Module '"/opt/workspaces/runlith/apps/tagma/app/src/lib/features/speech/dictation/pill.svelte"' has no default export. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/routes/_desktop/dictation/+page.svelte:3:20
Error: File name '/opt/workspaces/runlith/apps/tagma/app/src/lib/features/speech/dictation/Pill.svelte.ts' differs from already included file name '/opt/workspaces/runlith/apps/tagma/app/src/lib/features/speech/dictation/pill.svelte.ts' only in casing. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/graph/BlockName.svelte:3:23
Error: Already included file name '/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/tooltip/Tooltip.d.svelte.ts' differs from file name '/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/tooltip/tooltip.d.svelte.ts' only in casing. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/graph/sidebar/Sidebar.svelte:12:10
Error: Module '"/opt/workspaces/runlith/apps/tagma/app/src/lib/features/graph/sidebar/SidebarTree.svelte"' has no default export. Did you mean to use 'import { SidebarTree } from "/opt/workspaces/runlith/apps/tagma/app/src/lib/features/graph/sidebar/SidebarTree.svelte"' instead? (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/shared/ui/dialog/Asked.fixture.svelte:11:18
Error: Parameter 'open' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/shared/ui/dialog/dialog-footer.svelte:27:25
Error: Binding element 'props' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/shared/ui/dialog/dialog-content.svelte:37:27
Error: Binding element 'props' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/projects/RemoveDialog.svelte:37:20
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/FolderRemove.svelte:31:20
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/Row.svelte:21:12
Error: Module '"*.svelte"' has no exported member 'CONTEXT_RING_HOT'. Did you mean to use 'import CONTEXT_RING_HOT from "*.svelte"' instead? (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/Menu.svelte:277:20
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/worktrees/FinishDialog.svelte:282:18
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/checkout/GitView.svelte:605:18
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/checkout/DiffTab.svelte:384:20
Error: Parameter 'held' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/executions/terminal/CloseDialog.svelte:23:18
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/library/AgentLibrary.svelte:407:18
Error: Parameter 'open' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte:243:1
Warn: Non-interactive element `<div>` should not be assigned mouse or keyboard event listeners
https://svelte.dev/e/a11y_no_noninteractive_element_interactions (svelte)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/native/Conversation.svelte:303:18
Error: Property 'openImage' is missing in type 'SvelteComponent<Record<string, any>, any, any>' but required in type '{ openImage(image: ChatAttachment): void; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/native/RewindConfirm.svelte:41:20
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/threads/native/draft.composer.svelte:75:78
Error: Parameter 'id' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++AgentLibraryItem.svelte.ts:24:197
Error: Object literal may only specify known properties, and '"onclick"' does not exist in type 'Omit<HTMLAttributes<HTMLDivElement>, "onclick"> & MenuItem & { inset?: boolean | undefined; variant?: "default" | "destructive" | undefined; unstyled?: boolean | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:3:15
Error: Module '"@runlith/executions/protocol/evidence"' has no exported member 'CpuAccount'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:4:25
Error: Cannot find module '$lib/features/executions/load/Figures.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:6:62
Error: Cannot find module '$lib/features/executions/load/tree.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:24:37
Error: Property 'machine' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:25:37
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:26:49
Error: Property 'readings' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:27:88
Error: Property 'installation' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadBands.svelte.ts:55:123
Error: Type '{ history: any; }' is missing the following properties from type '$$ComponentProps': layers, lit (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:10:39
Error: Cannot find module './loadGrid.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:11:10
Error: Module '"$lib/features/executions/load/View.svelte.js"' has no exported member 'endingWords'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:12:60
Error: Cannot find module '$lib/features/executions/load/tree.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:61:30
Error: Property 'busy' is private and only accessible within class 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:61:30
Error: This expression is not callable. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:63:70
Error: Property 'outcome' does not exist on type 'Ending'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:89:26
Error: Property 'revise' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:142:17
Error: Property 'canStop' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadLeaf.svelte.ts:148:293
Error: Expected 1 arguments, but got 3. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:4:25
Error: Module '"$lib/features/executions/load/Readings.svelte.js"' has no exported member 'Orphan'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:5:22
Error: Cannot find module '$lib/features/executions/load/presence.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:6:67
Error: Cannot find module '$lib/features/executions/load/tree.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:7:10
Error: Module '"$lib/features/executions/load/View.svelte.js"' has no exported member 'endingWords'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:7:23
Error: Module '"$lib/features/executions/load/View.svelte.js"' has no exported member 'residualWords'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:10:26
Error: Cannot find module './loadGrid.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:29:20
Error: Property 'orphans' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:29:37
Error: Property 'residualGhosts' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:30:8
Error: Parameter 'one' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:36:58
Error: Property 'projects' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:37:80
Error: Property 'machine' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:45:25
Error: Property 'busyOrphan' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:46:50
Error: Property 'residualEnding' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:48:119
Error: Property 'outcome' does not exist on type 'Ending'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:54:49
Error: Property 'projects' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:63:25
Error: Property 'canEnd' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadOrphans.svelte.ts:64:133
Error: Property 'end' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:3:15
Error: Module '"@runlith/executions/protocol/evidence"' has no exported member 'MachineProcess'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:7:16
Error: Module '"$lib/features/executions/load/View.svelte.js"' has no exported member 'endingWords'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:7:29
Error: Module '"$lib/features/executions/load/View.svelte.js"' has no exported member 'residualWords'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:9:28
Error: Cannot find module '$lib/features/executions/load/tree.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:12:26
Error: Cannot find module './loadGrid.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:42:16
Error: Property 'readings' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:42:36
Error: Binding element 'projectId' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:42:47
Error: Binding element 'name' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:42:53
Error: Binding element 'snapshot' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:43:32
Error: Parameter 'row' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:49:47
Error: Property 'orphans' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:49:60
Error: Parameter 'one' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:51:15
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:51:49
Error: Parameter 'row' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:57:44
Error: Property 'machine' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:59:88
Error: Property 'machine' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:69:40
Error: Function lacks ending return statement and return type does not include 'undefined'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:51
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:57
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:73
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:79
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:92
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:98
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:113
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:71:119
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:23
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:29
Error: Property 'projectId' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:40
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:40
Error: Expected 1 arguments, but got 3. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:46
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:51
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:87:57
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:88:34
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:88:40
Error: Property 'projectId' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:88:51
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:88:57
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:89:59
Error: Property 'outcome' does not exist on type 'Ending'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:94:18
Error: Property 'end' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:95:27
Error: Property 'residualEnding' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:95:42
Error: 'orphan' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:95:49
Error: Property 'orphan' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:99:30
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:101:31
Error: Property 'endProcess' does not exist on type 'ExecutionActs'. Did you mean 'endProcesses'? (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:22
Error: Property 'busy' is private and only accessible within class 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:22
Error: This expression is not callable. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:27
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:33
Error: Property 'projectId' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:44
Error: 'owned' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:126:50
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:128:24
Error: Property 'busyOrphan' does not exist on type 'View'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:129:24
Error: Property 'residualBusy' does not exist on type 'ExecutionActs'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:150:27
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:150:175
Error: Property 'name' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:150:187
Error: Property 'row' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:160:17
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:162:17
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:162:51
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:162:86
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:162:122
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:163:18
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++LoadProcesses.svelte.ts:163:43
Error: Property 'account' does not exist on type 'Readings'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++PaceSegments.svelte.ts:5:22
Error: Cannot find module './Pace.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++PaceSegments.svelte.ts:24:38
Error: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type 'Record<"full" | "low" | "lowest", string>'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SectionsSync.svelte.ts:22:13
Error: Property 'retain' does not exist on type 'SidePanes'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SectionsSync.svelte.ts:22:34
Error: Parameter 'id' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:14:23
Error: Cannot find module '$lib/shared/reading/Panes.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:21:41
Error: Cannot find module '$lib/app/chrome/Sidebar.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:23:67
Error: Module '"$lib/features/workspace/address.js"' has no exported member 'surfaceOf'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:89:26
Error: Expected 1 arguments, but got 0. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:96:48
Error: Expected 2-3 arguments, but got 1. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:96:78
Error: Argument of type 'string' is not assignable to parameter of type 'Router'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:97:60
Error: Argument of type 'string' is not assignable to parameter of type 'Router'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++Sidebar.svelte.ts:97:95
Error: Argument of type 'string' is not assignable to parameter of type 'Router'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarHeading.svelte.ts:4:25
Error: Cannot find module '$lib/app/chrome/Sidebar.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarRow.svelte.ts:39:35
Error: Argument of type 'string' is not assignable to parameter of type 'Router'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarShelf.svelte.ts:7:25
Error: Cannot find module '$lib/app/chrome/Sidebar.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:8:25
Error: Cannot find module '$lib/app/chrome/Sidebar.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:11:29
Error: Cannot find module './SidebarTree.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:12:26
Error: Cannot find module './treeLines.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:34:28
Error: Expected 1 arguments, but got 0. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:41:42
Error: Parameter 'line' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:46:48
Error: Parameter 'line' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/chrome/++SidebarTree.svelte.ts:55:67
Error: Argument of type '{ project: string; }' is not assignable to parameter of type 'string'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++BesideSlot.svelte.ts:6:23
Error: Cannot find module '$lib/shared/reading/Panes.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++BesideSlot.svelte.ts:23:40
Error: Property 'declared' does not exist on type 'SidePanes'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++BesideSlot.svelte.ts:31:48
Error: Property 'fill' does not exist on type 'SidePanes'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++BesideSlot.svelte.ts:34:22
Error: Property 'share' does not exist on type 'SidePanes'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++PaneSlot.fixture.svelte.ts:3:31
Error: Cannot find module './paneSlot.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++PaneSlot.fixture.svelte.ts:18:127
Error: Object literal may only specify known properties, but 'panes' does not exist in type '$$ComponentProps'. Did you mean to write 'pane'? (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++SidePane.svelte.ts:19:26
Error: Cannot find module './paneSlot.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/app/panes/++SidePane.svelte.ts:53:23
Error: Property 'take' does not exist on type 'SidePanes'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++FilesColumn.svelte.ts:10:23
Error: Cannot find module '$lib/shared/reading/Panes.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++FilesColumn.svelte.ts:13:10
Error: Module '"./seams.js"' has no exported member 'FILES_PANE'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++FilesColumn.svelte.ts:17:34
Error: Cannot find module './OpenFile.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++ThreadMain.svelte.ts:8:41
Error: Cannot find module '$lib/shared/reading/Panes.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++ThreadMain.svelte.ts:11:10
Error: Module '"./seams.js"' has no exported member 'DIFF_PANE'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++ThreadMain.svelte.ts:14:37
Error: Cannot find module './OpenFile.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++ThreadMain.svelte.ts:41:32
Error: Property 'file' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/checkout/++ThreadMain.svelte.ts:75:256
Error: Property 'file' does not exist on type '{}'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/commands/++Output.svelte.ts:8:15
Error: Module '"./lines.js"' has no exported member 'OutputPhase'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/commands/++Output.svelte.ts:8:28
Error: Module '"./lines.js"' has no exported member 'OutputStream'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/commands/++Output.svelte.ts:77:11
Error: This comparison appears to be unintentional because the types '"Ended" | "Flowing" | "Recovering"' and '"Lost"' have no overlap. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/commands/++Output.svelte.ts:77:62
Error: Property 'problem' does not exist on type 'never'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/load/++OutputSheet.svelte.ts:5:29
Error: Cannot find module './OutputSheet.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/load/++OutputSheet.svelte.ts:17:222
Error: Parameter 'open' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++CloseTerminalDialog.svelte.ts:6:32
Error: Cannot find module '../places/Tabs.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++CloseTerminalDialog.svelte.ts:28:223
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:11:32
Error: Cannot find module '../places/Tabs.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:70:34
Error: Parameter 'tab' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:125:39
Error: Parameter 'tab' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:179:154
Error: 'indicator' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:179:205
Error: 'indicator' is possibly 'null'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/executions/terminal/++TabStrip.svelte.ts:183:81
Error: Expected 2-3 arguments, but got 1. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/opening/++Preview.svelte.ts:38:57
Error: Property 'streaming' is missing in type '{ text: string; theme: "dark" | "light"; }' but required in type 'MarkdownRender'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/opening/++Preview.svelte.ts:66:112
Error: Type 'boolean' is not assignable to type 'string'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/providers/auth/++SignIn.svelte.ts:4:15
Error: Module '"@runlith/llm/models/catalog"' has no exported member 'OAuthProviderId'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/providers/auth/++SignIn.svelte.ts:33:152
Error: Type 'OAuthProviderId' is not assignable to type 'never'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/++FolderGroup.svelte.ts:9:28
Error: Module '"./tree.js"' declares 'ThreadTreeNode' locally, but it is not exported. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/++FolderGroup.svelte.ts:40:334
Error: Property 'renameFolder' does not exist on type 'ThreadList'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/++Header.svelte.ts:34:199
Error: Object literal may only specify known properties, and '"onclick"' does not exist in type 'Omit<HTMLAttributes<HTMLDivElement>, "onclick"> & MenuItem & { inset?: boolean | undefined; variant?: "default" | "destructive" | undefined; unstyled?: boolean | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/++Header.svelte.ts:46:234
Error: Object literal may only specify known properties, and '"onclick"' does not exist in type 'Omit<HTMLAttributes<HTMLDivElement>, "onclick"> & MenuItem & { inset?: boolean | undefined; variant?: "default" | "destructive" | undefined; unstyled?: boolean | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/++Header.svelte.ts:187:209
Error: Object literal may only specify known properties, and '"onclick"' does not exist in type 'Omit<HTMLAttributes<HTMLDivElement>, "onclick"> & MenuItem & { inset?: boolean | undefined; variant?: "default" | "destructive" | undefined; unstyled?: boolean | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++AcpToolRow.svelte.ts:8:30
Error: Cannot find module './acpCall.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++HostReplaceDialog.svelte.ts:8:61
Error: Property 'hostStanding' does not exist on type 'ThreadList'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++HostReplaceDialog.svelte.ts:23:15
Error: Property 'hostStanding' does not exist on type 'ThreadList'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++HostReplaceDialog.svelte.ts:23:36
Error: Parameter 'answer' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++HostReplaceDialog.svelte.ts:32:33
Error: Property 'replaceHost' does not exist on type 'ThreadList'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++HostReplaceDialog.svelte.ts:51:210
Error: Parameter 'next' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/external/++TransportChip.svelte.ts:65:266
Error: Object literal may only specify known properties, and '"onclick"' does not exist in type 'Omit<HTMLAttributes<HTMLDivElement>, "onclick"> & MenuItem & { inset?: boolean | undefined; variant?: "default" | "destructive" | undefined; unstyled?: boolean | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:28:34
Error: Property 'readArchived' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:33:47
Error: Property 'adrift' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:35:59
Error: Property 'adrift' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:37:175
Error: Type '"tagma"' is not assignable to type '"external" | "main" | "tagma"'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:47:14
Error: Property 'archivedTotal' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:48:131
Error: Property 'archivedTotal' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:52:106
Error: Property 'archivedTotal' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:55:61
Error: Property 'archived' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:62:175
Error: Type '"tagma"' is not assignable to type '"external" | "main" | "tagma"'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:67:250
Error: Property 'restore' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:75:20
Error: Property 'moreArchived' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++ArchivedGroup.svelte.ts:76:177
Error: Property 'readMoreArchived' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++RestoreItem.svelte.ts:22:249
Error: Property 'restore' does not exist on type 'Finishing'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/threads/worktrees/++RestoreItem.svelte.ts:24:3
Error: This comparison appears to be unintentional because the types 'FinishAct | null' and '"restore"' have no overlap. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++LoadPlaceActs.svelte.ts:7:37
Error: Cannot find module './places.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++LoadPlaceActs.svelte.ts:9:31
Error: Cannot find module './Listings.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++LoadPlaceActs.svelte.ts:28:30
Error: Argument of type 'string' is not assignable to parameter of type 'Router'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++LoadPlaceName.svelte.ts:3:37
Error: Cannot find module './places.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++LoadPlaceName.svelte.ts:4:31
Error: Cannot find module './Listings.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++SpacePanel.svelte.ts:5:29
Error: Cannot find module './Space.svelte.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/features/worktrees/++SpacePanel.svelte.ts:18:64
Error: Parameter 'item' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/++Hint.svelte.ts:6:26
Error: Cannot find module './ui/tooltip/index.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/++Hint.svelte.ts:56:199
Error: Binding element 'props' implicitly has an 'any' type. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/command/++command-dialog.svelte.ts:48:88
Error: Expression produces a union type that is too complex to represent. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/command/++command-dialog.svelte.ts:48:166
Error: Object literal may only specify known properties, and 'ref' does not exist in type 'HTMLAttributes<HTMLDivElement> & { value?: string | undefined; }'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/command/++command-dialog.svelte.ts:48:356
Error: Type '"ref"' is not assignable to type '"value"'. (ts)

/opt/workspaces/runlith/apps/tagma/app/.svelte-kit/.svelte-check/svelte/src/lib/shared/ui/select/++select-separator.svelte.ts:4:27
Error: Cannot find module '$lib/shared/ui/separator/index.js' or its corresponding type declarations. (ts)

/opt/workspaces/runlith/apps/tagma/app/src/lib/features/graph/columns.ts:5:65
Error: Type '() => Promise<typeof import("./sidebar/Sidebar.svelte.js")>' is not assignable to type 'ColumnFrame'. (ts)

/opt/workspaces/runlith/apps/tagma/app/../../../packages/agent/src/thread/run/ThreadEffectSettlement.ts:99:7
Error: Type '(_view: TransitionView, tx: ThreadWriteTx) => Effect<{ readonly apply: true; readonly result: ThreadEffectSettlementResult; readonly events?: readonly ThreadEventInput[] | undefined; readonly patch?: (ThreadWritableColumns & { parentThreadId?: string | null | undefined; } & { readonly contextReading?: ThreadContextReading | null | undefined; }) | undefined; readonly participants?: ((tx: ThreadWriteTx) => Effect<void, ThreadBorderFailed, never>) | undefined; } | { readonly replayed: ThreadEffectSettlementResult; }, ThreadPortFailure, never>' is not assignable to type '(view: TransitionView, tx: ThreadWriteTx) => Effect<Decision<ThreadEffectSettlementResult, ThreadWriteTx, ThreadPortFailure>, ThreadPortFailure, never>'. (ts)

====================================
svelte-check found 212 errors and 1 warning in 57 files
[03:42:20.132] ERROR (#1): ChecksFailed: Type errors reported by svelte-check @tagma/app.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:95:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:62:27)

stderr:
$ runlith-typecheck
error: script "typecheck" exited with code 1
real 15.86
user 39.65
sys 4.08

```


## 4.7.7-api-chat

```text
cwd: /opt/workspaces/runlith/packages/chat-ui
command: bun run typecheck 
exit: 1

stdout:
svelte-check @runlith/chat-ui
[03:42:30.042] ERROR (#1): ChecksFailed: Type errors reported by svelte-check @runlith/chat-ui.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:95:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:62:27)

stderr:
$ runlith-typecheck
37 |             if (sentinelName !== "useOS") {
38 |                 args.push(`${name}:${sentinelName}`);
39 |             }
40 |             continue;
41 |         }
42 |         throw new TypeError(`Invalid filesystem callback '${name}': expected a function or a supported serverFS sentinel`);
                       ^
TypeError: Invalid filesystem callback 'directoryExists': expected a function or a supported serverFS sentinel
      at configureFileSystemCallbacks (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/fsCallbacks.js:42:19)
      at new Client (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/sync/client.js:23:33)
      at new API (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/sync/api.js:71:23)
      at new SvelteCheckTSGoDiagnosticsProvider (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:134412:20)
      at initialize (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:135309:48)
      at new SvelteCheck (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:135267:14)
      at <anonymous> (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:143319:33)

svelte-check failed
error: script "typecheck" exited with code 1
real 0.75
user 0.72
sys 0.22

```


## 4.7.7-api-app

```text
cwd: /opt/workspaces/runlith/apps/tagma/app
command: bun run typecheck 
exit: 1

stdout:
svelte-check @tagma/app
[03:42:31.450] ERROR (#1): ChecksFailed: Type errors reported by svelte-check @tagma/app.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:95:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:62:27)

stderr:
$ runlith-typecheck
37 |             if (sentinelName !== "useOS") {
38 |                 args.push(`${name}:${sentinelName}`);
39 |             }
40 |             continue;
41 |         }
42 |         throw new TypeError(`Invalid filesystem callback '${name}': expected a function or a supported serverFS sentinel`);
                       ^
TypeError: Invalid filesystem callback 'directoryExists': expected a function or a supported serverFS sentinel
      at configureFileSystemCallbacks (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/fsCallbacks.js:42:19)
      at new Client (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/sync/client.js:23:33)
      at new API (/opt/workspaces/runlith/node_modules/.bun/typescript@7.1.0-beta/node_modules/typescript/dist/api/sync/api.js:71:23)
      at new SvelteCheckTSGoDiagnosticsProvider (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:134412:20)
      at initialize (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:135309:48)
      at new SvelteCheck (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:135267:14)
      at <anonymous> (/opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/dist/src/index.js:143319:33)

svelte-check failed
error: script "typecheck" exited with code 1
real 1.39
user 1.29
sys 0.43

```


## 4.7.7-baseline-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck 
exit: 1

stdout:
~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/Broken.svelte:4:9
Error: Type 'string' is not assignable to type 'number'. (ts)

~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/Broken.svelte:7:11
Error: Property 'toUpperCase' does not exist on type 'number'. (ts)

~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/use.ts:4:48
Error: Type 'string' is not assignable to type 'number'. 

====================================
svelte-check found 3 errors and 0 warnings in 2 files

stderr:
$ bun --bun svelte-check --tsconfig ./tsconfig.json --output human
error: "svelte-check" exited with code 1
error: script "typecheck" exited with code 1
real 0.98
user 1.29
sys 0.10

```


## 4.7.7-tsgo-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck --tsgo
exit: 1

stdout:
~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/Broken.svelte:4:9
Error: Type 'string' is not assignable to type 'number'. (ts)

~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/Broken.svelte:7:11
Error: Property 'toUpperCase' does not exist on type 'number'. (ts)

~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/src/use.ts:4:48
Error: Type 'string' is not assignable to type 'number'. (ts)

====================================
svelte-check found 3 errors and 0 warnings in 2 files

stderr:
$ bun --bun svelte-check --tsconfig ./tsconfig.json --output human --tsgo
error: "svelte-check" exited with code 1
error: script "typecheck" exited with code 1
real 0.44
user 0.41
sys 0.10

```


## 4.7.7-api-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck --tsgo-experimental-api
exit: 1

stdout:

stderr:
$ bun --bun svelte-check --tsconfig ./tsconfig.json --output human --tsgo-experimental-api
37 |             if (sentinelName !== "useOS") {
38 |                 args.push(`${name}:${sentinelName}`);
39 |             }
40 |             continue;
41 |         }
42 |         throw new TypeError(`Invalid filesystem callback '${name}': expected a function or a supported serverFS sentinel`);
                       ^
TypeError: Invalid filesystem callback 'directoryExists': expected a function or a supported serverFS sentinel
      at configureFileSystemCallbacks (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/@typescript/native/dist/api/fsCallbacks.js:42:19)
      at new Client (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/@typescript/native/dist/api/sync/client.js:23:33)
      at new API (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/@typescript/native/dist/api/sync/api.js:71:23)
      at new SvelteCheckTSGoDiagnosticsProvider (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/svelte-check/dist/src/index.js:134412:20)
      at initialize (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/svelte-check/dist/src/index.js:135309:48)
      at new SvelteCheck (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/svelte-check/dist/src/index.js:135267:14)
      at <anonymous> (~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity/node_modules/svelte-check/dist/src/index.js:143319:33)

svelte-check failed
error: "svelte-check" exited with code 1
error: script "typecheck" exited with code 1
real 0.26
user 0.23
sys 0.04

```


## patched-baseline-node-tsx-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck 
exit: 1

stdout:
1792633944318 START "~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity"
1792633944319 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":3,"character":8},"end":{"line":3,"character":19},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792633944319 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":6,"character":10},"end":{"line":6,"character":21},"message":"Property 'toUpperCase' does not exist on type 'number'.","code":2339,"source":"ts"}
1792633944319 {"type":"ERROR","filename":"src/use.ts","start":{"line":3,"character":47},"end":{"line":3,"character":52},"message":"Type 'string' is not assignable to type 'number'.","code":2322}
1792633944319 COMPLETED 113 FILES 3 ERRORS 0 WARNINGS 2 FILES_WITH_PROBLEMS

stderr:
$ node --import /opt/workspaces/runlith/node_modules/.bun/tsx@4.23.15/node_modules/tsx/dist/loader.mjs /opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json --output machine-verbose
error: script "typecheck" exited with code 1
real 0.97
user 1.37
sys 0.10

```


## patched-api-node-tsx-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck --tsgo-experimental-api
exit: 1

stdout:
1792633935377 START "~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity"
1792633935377 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":3,"character":8},"end":{"line":3,"character":19},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792633935378 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":6,"character":10},"end":{"line":6,"character":21},"message":"Property 'toUpperCase' does not exist on type 'number'.","code":2339,"source":"ts"}
1792633935378 {"type":"ERROR","filename":"src/use.ts","start":{"line":3,"character":47},"end":{"line":3,"character":52},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792633935378 COMPLETED 2 FILES 3 ERRORS 0 WARNINGS 2 FILES_WITH_PROBLEMS

stderr:
$ node --import /opt/workspaces/runlith/node_modules/.bun/tsx@4.23.15/node_modules/tsx/dist/loader.mjs /opt/workspaces/runlith/node_modules/.bun/svelte-check@4.7.7+a3107cd762483df7/node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json --output machine-verbose --tsgo-experimental-api
error: script "typecheck" exited with code 1
real 0.87
user 0.84
sys 0.07

```


## patched-render-sensitivity

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck 
exit: 1

stdout:
src/Broken.svelte(4,9): error TS2322: Type 'string' is not assignable to type 'number'.
src/Broken.svelte(7,11): error TS2339: Property 'toUpperCase' does not exist on type 'number'.
src/use.ts(4,48): error TS2322: Type 'string' is not assignable to type 'number'.
svelte-check svelte-check-sensitivity: 3 errors, 0 warnings
[03:53:45.482] ERROR (#1): ChecksFailed: Type errors reported by svelte-check svelte-check-sensitivity.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:105:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:72:27)

stderr:
$ bun /opt/workspaces/runlith/packages/tsconfig/src/main.ts
error: script "typecheck" exited with code 1
real 1.08
user 1.06
sys 0.15

```


## patched-mixed-red

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck 
exit: 1

stdout:
src/Syntax.ts(1,21): error TS1109: Expression expected.
svelte-check svelte-check-sensitivity: 1 errors, 0 warnings
[04:00:01.860] ERROR (#1): ChecksFailed: Type errors reported by svelte-check svelte-check-sensitivity.
    at <anonymous> (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:105:44)
    at typecheck.run (/opt/workspaces/runlith/packages/tsconfig/src/main.ts:18:20)
    at typecheck.run (definition) (/opt/workspaces/runlith/packages/tsconfig/src/typecheck.ts:72:27)

stderr:
$ bun /opt/workspaces/runlith/packages/tsconfig/src/main.ts
error: script "typecheck" exited with code 1
real 1.37
user 1.07
sys 0.19

```


## baseline-mixed

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck 
exit: 1

stdout:
1792634420490 START "~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity"
1792634420491 {"type":"ERROR","filename":"src/Syntax.ts","start":{"line":0,"character":20},"end":{"line":0,"character":21},"message":"Expression expected.","code":1109}
1792634420491 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":3,"character":8},"end":{"line":3,"character":19},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792634420491 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":6,"character":10},"end":{"line":6,"character":21},"message":"Property 'toUpperCase' does not exist on type 'number'.","code":2339,"source":"ts"}
1792634420491 {"type":"ERROR","filename":"src/use.ts","start":{"line":3,"character":47},"end":{"line":3,"character":52},"message":"Type 'string' is not assignable to type 'number'.","code":2322}
1792634420491 COMPLETED 113 FILES 4 ERRORS 0 WARNINGS 3 FILES_WITH_PROBLEMS

stderr:
$ node --import /opt/workspaces/runlith/node_modules/.bun/tsx@4.23.15/node_modules/tsx/dist/loader.mjs node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json --output machine-verbose
error: script "typecheck" exited with code 1
real 1.05
user 1.39
sys 0.14

```


## patched-mixed-green

```text
cwd: ~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity
command: bun run typecheck --tsgo-experimental-api
exit: 1

stdout:
1792634471881 START "~/.tagma-dev/scratch/01a1613e-6093-78f6-88e9-6da068f7fc60/sensitivity"
1792634471881 {"type":"ERROR","filename":"src/Syntax.ts","start":{"line":0,"character":20},"end":{"line":0,"character":21},"message":"Expression expected.","code":1109,"source":"ts"}
1792634471881 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":3,"character":8},"end":{"line":3,"character":19},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792634471881 {"type":"ERROR","filename":"src/Broken.svelte","start":{"line":6,"character":10},"end":{"line":6,"character":21},"message":"Property 'toUpperCase' does not exist on type 'number'.","code":2339,"source":"ts"}
1792634471881 {"type":"ERROR","filename":"src/use.ts","start":{"line":3,"character":47},"end":{"line":3,"character":52},"message":"Type 'string' is not assignable to type 'number'.","code":2322,"source":"ts"}
1792634471882 COMPLETED 3 FILES 4 ERRORS 0 WARNINGS 3 FILES_WITH_PROBLEMS

stderr:
$ node --import /opt/workspaces/runlith/node_modules/.bun/tsx@4.23.15/node_modules/tsx/dist/loader.mjs node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json --output machine-verbose --tsgo-experimental-api
error: script "typecheck" exited with code 1
real 1.04
user 0.89
sys 0.12

```


## final-samples

```text
packages/chat-ui — /usr/bin/time -p bun run typecheck
stdout: (empty)
stderr:
$ runlith-typecheck
real 3.19
user 2.74
sys 0.40
exit 0

apps/tagma/app — /usr/bin/time -p bun run typecheck
stdout:
apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte(243,1): warning a11y_no_noninteractive_element_interactions: Non-interactive element `<div>` should not be assigned mouse or keyboard event listeners https://svelte.dev/e/a11y_no_noninteractive_element_interactions
svelte-check @tagma/app: 0 errors, 1 warnings
stderr:
$ runlith-typecheck
real 14.12
user 7.15
sys 1.14
exit 0

```


## patched-reviewed-root

```text
cwd: /opt/workspaces/runlith
command: bun run tagma:typecheck 
exit: 0

stdout:
bun check packages/acp
bun check packages/activity
bun check packages/adapter-anthropic
bun check packages/adapter-deepseek
bun check packages/adapter-devin
bun check packages/adapter-muse
bun check packages/adapter-openai
bun check packages/adapter-openai-compatible
bun check packages/adapter-opencode-go
bun check packages/adapter-stepfun
bun check packages/adapter-xai
bun check packages/agent
bun check packages/agent-sources
bun check packages/agent-tools
bun check packages/audio
bun check packages/audio-darwin
bun check packages/audio-file
bun check packages/browser-cookies
bun check packages/builtin-catalog
bun check packages/bundle
bun check packages/cdp
bun check packages/code-facts
bun check packages/codesign
bun check packages/credential-file
bun check packages/desktop-host
bun check packages/desktop-input
bun check packages/dev-runner
bun check packages/echo
bun check packages/effect-test
bun check packages/execution-host
bun check packages/executions
bun check packages/file-lock
bun check packages/files
bun check packages/git
bun check packages/github
bun check packages/held
bun check packages/highlight
bun check packages/llm
bun check packages/markdown
bun check packages/mcp
bun check packages/ndjson-rpc
bun check packages/paging
bun check packages/performance
bun check packages/ripgrep
bun check packages/scroll-follow
bun check packages/seam
bun check packages/search-text
bun check packages/source-comments
bun check packages/speech
bun check packages/speech-openai
bun check packages/speech-soniox
bun check packages/speech-whisper
bun check packages/sqlite-process
bun check packages/tagma
bun check packages/tsconfig
bun check packages/utils
bun check packages/vite-browser-guard
bun check packages/watch
bun check apps/tagma/cloud
bun check apps/tagma/desktop
bun check apps/tagma/inspection
bun check apps/tagma/server
packages/layer/src/svelte/test-utils/FlaggedApp.svelte(17,24): warning state_referenced_locally: This reference only captures the initial value of `boot`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HandoffFrame.svelte(8,7): warning state_referenced_locally: This reference only captures the initial value of `awaits`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HandoffProbe.svelte(22,9): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HeldPane.svelte(17,25): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HeldPane.svelte(17,37): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HeldPane.svelte(18,42): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HeldPane.svelte(20,3): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/HeldProbe.svelte(18,13): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/ScreenTestHost.svelte(16,9): warning state_referenced_locally: This reference only captures the initial value of `props`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/time-travel/Host.svelte(30,3): warning state_referenced_locally: This reference only captures the initial value of `onApp`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/time-travel/Host.svelte(39,14): warning state_referenced_locally: This reference only captures the initial value of `engines`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/layer/src/svelte/test-utils/time-travel/Page.svelte(9,7): warning state_referenced_locally: This reference only captures the initial value of `second`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
svelte-check @runlith/layer: 0 errors, 12 warnings
packages/query/src/test-utils/UnobservedInfReadProbe.svelte(16,3): warning state_referenced_locally: This reference only captures the initial value of `onRead`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedInfReadProbe.svelte(17,11): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedInfReadProbe.svelte(18,12): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedInfReadProbe.svelte(19,16): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedInfReadProbe.svelte(20,18): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedReadProbe.svelte(11,3): warning state_referenced_locally: This reference only captures the initial value of `onRead`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedReadProbe.svelte(11,18): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedReadProbe.svelte(11,37): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
packages/query/src/test-utils/UnobservedReadProbe.svelte(11,63): warning state_referenced_locally: This reference only captures the initial value of `query`. Did you mean to reference it inside a closure instead? https://svelte.dev/e/state_referenced_locally
svelte-check @runlith/query: 0 errors, 9 warnings
apps/tagma/app/src/lib/features/browser/screencast/CastView.svelte(243,1): warning a11y_no_noninteractive_element_interactions: Non-interactive element `<div>` should not be assigned mouse or keyboard event listeners https://svelte.dev/e/a11y_no_noninteractive_element_interactions
svelte-check @tagma/app: 0 errors, 1 warnings
bun test v1.4.3 (c6da4a4d3)

stderr:
$ runlith-typecheck apps/tagma && bun test ./apps/tagma/server/src/threads/doctrine/sectionText.itest.ts ./apps/tagma/server/src/threads/doctrine/render.test.ts
✓ No type errors in 18 files [245.96ms]
✓ No type errors in 48 files [131.28ms]
✓ No type errors in 72 files [125.70ms]
✓ No type errors in 263 files [264.64ms]
✓ No type errors in 65 files [129.38ms]
✓ No type errors in 55 files [89.77ms]
✓ No type errors in 88 files [152.90ms]
✓ No type errors in 73 files [122.91ms]
✓ No type errors in 70 files [248.40ms]
✓ No type errors in 91 files [240.52ms]
✓ No type errors in 104 files [145.30ms]
✓ No type errors in 66 files [123.82ms]
✓ No type errors in 90 files [180.55ms]
✓ No type errors in 66 files [128.51ms]
✓ No type errors in 69 files [149.26ms]
✓ No type errors in 79 files [149.49ms]
✓ No type errors in 814 files [1077.80ms]
✓ No type errors in 79 files [135.88ms]
✓ No type errors in 248 files [421.55ms]
✓ No type errors in 35 files [125.50ms]
✓ No type errors in 17 files [98.83ms]
✓ No type errors in 30 files [63.41ms]
✓ No type errors in 22 files [118.64ms]
✓ No type errors in 157 files [413.61ms]
✓ No type errors in 14 files [91.42ms]
✓ No type errors in 20 files [100.57ms]
✓ No type errors in 38 files [110.59ms]
✓ No type errors in 1 file [40.19ms]
✓ No type errors in 12 files [139.14ms]
✓ No type errors in 8 files [44.52ms]
✓ No type errors in 6 files [63.87ms]
✓ No type errors in 2 files [86.88ms]
✓ No type errors in 23 files [86.54ms]
✓ No type errors in 15 files [90.92ms]
✓ No type errors in 584 files [2.30s]
✓ No type errors in 84 files [476.67ms]
✓ No type errors in 2 files [72.01ms]
✓ No type errors in 19 files [88.05ms]
✓ No type errors in 35 files [131.09ms]
✓ No type errors in 2 files [68.64ms]
✓ No type errors in 22 files [85.21ms]
✓ No type errors in 14 files [135.89ms]
✓ No type errors in 159 files [467.65ms]
✓ No type errors in 235 files [495.45ms]
✓ No type errors in 9 files [140.82ms]
✓ No type errors in 93 files [351.26ms]
✓ No type errors in 11 files [64.93ms]
✓ No type errors in 5 files [133.97ms]
✓ No type errors in 93 files [554.67ms]
✓ No type errors in 9 files [121.52ms]
✓ No type errors in 4 files [77.23ms]
✓ No type errors in 4 files [91.27ms]
✓ No type errors in 11 files [37.28ms]
✓ No type errors in 11 files [73.01ms]
✓ No type errors in 61 files [188.03ms]
✓ No type errors in 28 files [105.67ms]
✓ No type errors in 56 files [133.47ms]
✓ No type errors in 61 files [149.95ms]
✓ No type errors in 30 files [159.62ms]
✓ No type errors in 180 files [381.10ms]
✓ No type errors in 10 files [110.18ms]
✓ No type errors in 40 files [95.21ms]
✓ No type errors in 2 files [49.85ms]
✓ No type errors in 13 files [137.50ms]
✓ No type errors in 59 files [429.17ms]
✓ No type errors in 175 files [313.43ms]
✓ No type errors in 150 files [345.52ms]
✓ No type errors in 5,314 files [30.27s]

apps/tagma/server/src/threads/doctrine/sectionText.itest.ts:
(pass) a terminal verb and a bare operation id in a section are refused by file, line and term [0.53ms]
(pass) the sanctioned spellings are silent, and so is everything outside a section [0.28ms]
(pass) a section is read by its words alone, and a finding lands on the line that carries it [0.09ms]
(pass) a double brace is a hole nothing fills, and is refused with the interpolation to write [0.14ms]

 4 pass
 0 fail
 10 expect() calls
Ran 4 tests across 1 file. [785.00ms]
real 93.25
user 166.45
sys 22.69

```
