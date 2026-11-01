---
id: 01a1946a-e347-7088-b737-1f0cb8c923d9
title: The commit format step strips the script block of a Svelte route under a [...rest] directory
ord: 173
tags: ["reflection"]
fields:
  {
    "actual": "The commit 45845d8325 carried `import SurfacePage from '$lib/app/SurfacePage.svelte';\\n<SurfacePage />` with no `<script>` tags, reported as \"(conflict)\"; a second submit_work rewrote it again and answered nothing to commit, so the page landed only by a plain git commit (ae2688925).",
    "command": "submit_work paths [\"apps/tagma/app/src/routes/[project]/p/[...path]/+page.svelte\", …]",
    "expected": "The oxfmt format step formats the Svelte page in place, or leaves it as written, and the commit carries a valid Svelte file."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

The working file was `<script lang="ts">\n  import SurfacePage from '$lib/app/SurfacePage.svelte';\n</script>\n\n<SurfacePage />\n`. Sibling route pages under `[project]/…/[[id]]` format fine, so the `[...path]` segment is the likely trigger: the path may reach oxfmt as a glob (`[...path]` is a character class) or the svelte parser is not chosen for it. The refusal text also said "the form the format commands gave … (conflict) was left out of the working files", so the step knew the forms disagreed and still committed the rewritten one.