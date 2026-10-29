---
id: 01a158cd-a6a8-7f34-afc0-ff85976626ad
title: submit_work fails with a bare "Missing key at [\"default\"]" in runlith, no refusal code or way out
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "Error text only: `Missing key\\n  at [\"default\"]`; nothing landed; repeated twice with and without paths",
    "command": "submit_work {subject, paths:[\"packages/seam/src/SeamHandle.svelte\"]} in /opt/workspaces/runlith",
    "expected": "A commit landing, or a typed refusal (e.g. config-invalid) naming what is missing and how to proceed"
  }
---
Filed from project `runlith`.

tagma.config.ts at the repo root does have `export default defineConfig({...})` (line 43), last changed in a66fa63ae7 five hours earlier. The same session landed commits at 03:33 the same day (3130755aa5). The error looks like a schema decode of the config module's exports leaking out of the door without being shaped as a refusal; it may also be a running server older than the config format. Cause named by thread 01a1550c: the installed build's bundler merged the rules SDK's text import with its code import; the config is not at fault. The work is blocked: one Svelte file stays uncommitted.