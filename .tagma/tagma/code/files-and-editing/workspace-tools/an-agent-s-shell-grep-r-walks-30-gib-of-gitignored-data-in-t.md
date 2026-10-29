---
id: 01a128a5-e289-790a-b414-601856970fa1
title: An agent's shell grep -r walks ~30 GiB of gitignored data in the checkout and holds it for minutes, while the same search with the grep tool takes under a second
ord: 133
tags: ["reflection"]
fields:
  {
    "actual": "The command ran over 3 min 17 s, the agent blocked; the operator sees this often. grep -r reads ~30 GiB gitignored: .external 6.7 GiB, node_modules 5.2 GiB, target. Measurement under pace low: grep -r over node_modules+.external alone — 55–73 s per run; rg honoring .gitignore over the whole tree — 0.15–0.5 s.",
    "command": "bash: cd /opt/workspaces/runlith && grep -rn \"settleFloor\\|boot.ts\" --include=*.json --include=*.ts -l . | grep -v node_modules (thread 01a1267b-ea09-7fb8-9262-45fa444a045d, call toolu_01ArHgTajTawi9pVmo1RMU1g)",
    "expected": "Code search from an agent's bash answers in seconds, like the built-in grep: gitignored trees not walked"
  }
---
Filed from project `runlith`.

The `utility` priority (power.agentWork = low) overlays, but is not the cause: rg under the same utility fits in half a second. The bash tool description orders searching with the built-in grep and glob, but the agent still took shell `grep -r` from the root. Hence the defect class: the harness leaves the agent a search path hundreds of times slower than its own, and nothing stops it. Spec a9f87123 measured Low and Lowest only on CPU load. I/O throttling of `utility` (IO tier 1) unmeasured.
