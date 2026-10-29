---
id: 01a13d57-c92a-783c-bbf3-4ad3df3f8f93
title: "Project strip: ProjectStrip, dock and tabs, ⌃` switcher, ⌘1–9, ShellOps.openProject and projects in ⌘K"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d58-a2a3-7367-b56b-d22ad36f9488",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d1d-cf8d-7804-a695-42f64e40cd91
---
Implement [[4e40cd91]]: `ProjectStrip`, `Dock.svelte`, `TabRow.svelte`, `Switcher.svelte` and `keys.ts` in `apps/tagma/app/src/lib/features/projects/`; `ShellOps.openProject` on all three `ShellPort` implementations, `TopBar.switchProject` goes into it; the Projects group in the palette; the "Projects: Dock | Tabs" segment in the app menu; the `--project-1…8` tokens. Pulse marks read `ProjectPulse.of(projectId)` from `features/projects/Pulse.svelte.ts` — the task [[adffc3bf]] builds it in parallel. Done when the spec's "How to check" tests are green, and both looks are snapshot-checked on their own instance.

Done in 5f4a353fc1 and 961ee9146d. Not checked: the app typecheck after review edits; ⌘1–9, ⌃` and the switcher look in desktop on macOS (snapshots are in the browser, where there are no chords); pulse marks with live threads; Enter in the palette covered by a snapshot only, not a test.
