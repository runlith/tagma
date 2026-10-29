---
id: 01a14742-3850-72e4-936c-2318838a9443
title: "Built-in browsers for agents: Orca, VS Code, Cursor, Codex, Claude Code, and Electron 43–44 (read 2026-10-17)"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Orca 0df25b7 — sources; docs and changelogs of VS Code, Cursor, Codex, Claude Code, Electron",
      "ref": ".external/orca"
    }
  }
---
Reading of Orca `0df25b7` (2026-10-11, Electron 43.7.5, `agent-browser ~0.27.0`) and public sources on built-in browsers as of 2026-10-17. Five researcher agents read the Orca code; key claims were verified against the sources. Nothing was launched: behavior and numbers come from code, `Why:` comments, and commits, not from measurements.

Child questions of this node:
- [[609d2ca5|how the page is embedded in the window]]
- [[1ff1496a|how the agent drives the tab]]
- [[359d6572|where the page lives and how other clients see it]]
- [[447be62e|profiles, user agent, and signing into Google]]
- [[b8c9e955|other products, Electron 43–44, and automation engines]]
- [[486f5a5e|how Electron differs from Chrome, anti-detect browsers, and open spoofing builds]]

Shared observations:
- Nobody has their own browser engine: everywhere it is Chromium inside Electron (`<webview>` or `WebContentsView`) or an external Chrome over CDP. The common denominator of automation is CDP.
- For Orca the browser is one of the largest subsystems: about 66k lines without tests. The embedding core is 6–8k; the bulk is remote pages (about 13k), network tunnels (5.5k), cookie import (4.3k), broadcast and viewing (6k), automation (about 7k, 2.7k of it dead code).
- Orca's server is moving to the same layout as Tagma's: orcad on plain Node by default, Electron as backup. In this layout their browser is the least ready: orcad does not broadcast pages, and nobody but its desktop sees a client-hosted page.

Undetermined: the Cursor engine and Codex architecture; `agent-browser` behavior from inside (its source is not in the checkout); how Google detects a built-in browser beyond UA.
