---
id: 01a174d7-3e29-7dd9-ad0c-fedbf3abefbe
title: submit_work refuses lines-held over a local const inside a neighbor's Svelte component that the importer does not use
ord: 85
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: \"selected references require uncommitted declarations: one in apps/tagma/app/src/lib/features/checkout/files/TreeMenu.svelte:39, held by menus\" — the declaration there is `const one = $derived(...)` inside the component's <script>, nothing is exported outward and ExplorerView does not import it; the only exits are waiting for the neighbor (over an hour) or carrying its unfinished lines.",
    "command": "submit_work subject=\"Break the remaining app import cycles…\" (no paths) in /opt/workspaces/runlith",
    "expected": "The landing goes through: my lines in checkout/files/ExplorerView.svelte (one import-holderName line from worktrees/holders.js) reference no neighbor declaration."
  }
---
ExplorerView.svelte imports the `TreeMenu from './TreeMenu.svelte'` component. The neighbor (the menus agent, thread 01a174be-8ab6-7212-91fd-5c44acf2b74) added the local `const one = $derived(aim !== null && aim.paths.length === 1);` to TreeMenu. In my changed files the `one` identifier appears as arrow parameters (`(one) => …`) and local variables, not as a member of the imported module. Apparently the conservative member-name check treats every top-level identifier in a Svelte component's `<script>` as an exported declaration, and an importer's same-named local identifier as a reference to it. For a Svelte component only props/`export` from `<script module>` are visible outward; the instance's local consts are not visible to the importer. Workaround: land without the files touched by that import, and land them after the neighbor.
