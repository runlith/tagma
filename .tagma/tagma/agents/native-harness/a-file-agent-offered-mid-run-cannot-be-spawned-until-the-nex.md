---
id: 01a0c6e4-edea-730f-9728-d2b94377e000
title: "A file agent offered mid-run cannot be spawned until the next turn: spawn_agent validates agentId against the enum the run opened with"
ord: 45
tags: ["reflection"]
fields:
  {
    "actual": "Ten spawn calls (five before the setting, five after) refused with a client-side schema error — agentId expects \"tagma\" | \"code\" | \"harness:…\" — because the tool's schema was composed when the run opened and is not re-read after agents.offered changes; the error names no setting and no next turn, so the way out (end the turn, spawn in the next) is not stated anywhere",
    "command": "save_agent zone-builder/zone-reviewer/zone-cutter (project scope), then write_setting agents.offered = [{type, to: agents} × 3], then spawn_agent agentId: zone-builder in the same run",
    "expected": "After the setting lands, the newly offered types are spawnable — or the refusal comes from the server naming the offer rule and the way out, as a graph refusal would"
  }
---
Filed from project `runlith`.

Cost: ten refused tool calls and one turn lost in a session whose whole point was to hand work to the three definitions it had just saved. The doctrine says a running run keeps what it opened with, so re-reading may be by design; the friction is the refusal's shape — a schema error that names the enum instead of the setting that governs it and the turn boundary that refreshes it. Either the enum is re-read when agents.offered changes, or the refusal says "offered to agents from the next turn on".