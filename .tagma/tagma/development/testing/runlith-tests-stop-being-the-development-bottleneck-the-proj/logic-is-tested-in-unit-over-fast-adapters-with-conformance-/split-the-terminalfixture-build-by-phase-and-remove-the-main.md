---
id: 01a16e8b-cb0a-7ac9-97c9-9b02f6297a96
title: Split the TerminalFixture build by phase and remove the main cost at the producer
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc54-7953-ba9c-9dd1e8cd9919",
    "status": "done"
  }
---
TerminalFixture build split by phase with entry/exit marks from performance.now and process.cpuUsage in 3 separate bun -e processes per variant. Build: 3.497/3.564/3.524 CPU s of its own process, of which shared composition.runtime 3.222/3.284/3.210 s; terminal remainder .275/.280/.314 s. With runtime-first import the terminal's own addition .103/.124/.141 s. Checkout birth separately .178–.222 s; first CLI call .600–.694 s, repeat .020–.035 s. The default world has no extra host or births; the host variant belongs to the real program-checker scenario commitGate. Shared cost handed to x-record-fix; terminalCore/Delivery actually use DoorFixture. By the runner's decision the work closes with measurement and no cosmetic rebuild; unchanged consumers not rechecked. Ledger: x10/x-harness.tsv; full values and probe in scratch x-harness, terminal-phases.json. No after claimed: producer code unchanged. Temporary probe removed, held paths = 0.
