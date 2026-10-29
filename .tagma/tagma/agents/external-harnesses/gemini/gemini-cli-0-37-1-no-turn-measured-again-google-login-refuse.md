---
id: 01a15f90-0780-76d6-aa29-fc92c3dd4a91
title: "Gemini CLI 0.37.1: no turn measured again — Google login refused (`client is no longer supported`), no API key — probe of 2026-10-21"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Attempted live Gemini CLI probe in PTY: directory trust and Google login",
      "ref": "Gemini CLI 0.37.1 (Homebrew); 2026-10-21"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f14b-75af-b91b-2da051bf75cd
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Gemini CLI 0.37.1 (Homebrew; the CLI reports 0.65.0 as available), `--yolo`, 2026-10-21, one host (macOS). CLI in a 120×40 PTY raised through the Tagma terminal. **No turn measured: login was rejected**, so not a single model reply. Repeats [[51bf75cd]].

## What happened

- The folder-trust dialog ("Do you trust the files in this folder?") — picked "Trust folder (probe)".
- Then the "Get started — How would you like to authenticate for this project?" screen and the message: "Failed to sign in. Message: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google".
- No `GEMINI_*` or `GOOGLE_*` variables in the environment. No Gemini API key and no Vertex AI were tried. The probe did not work around login.

## What is known without a live turn

In the installed bundle (`@google/gemini-cli` 0.37.1) the wait-indicator string is "(esc to cancel, …)". That is an interface string, not an interrupt observation.

## Not established

Everything the probe was for: the interrupt key mid-turn, what it does to the prompt and the draft, input mid-turn, ready confirmation.
