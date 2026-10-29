---
id: 01a16ed8-9e20-7aaf-a32d-017babc524e8
title: A shell body mistaken for a path in law delivery after bash
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "exit 0 after 2m56s; the footer reported Unknown FileSystem.stat for /opt/workspaces/runlith/status=0; for package ...; exit $status and delivered no law on the output.",
    "command": "bash({command:\"/opt/workspaces/runlith/node_modules/.bin/testbed /bin/sh -c 'status=0; for package in adapter-anthropic adapter-cursor adapter-deepseek adapter-devin adapter-muse adapter-openai adapter-openai-compatible adapter-opencode adapter-opencode-go adapter-openrouter adapter-stepfun adapter-xai navigation-ts; do bun ~/.tagma-dev/scratch/01a16dee-2b0b-7892-afdb-3123a319f97d/measure-isolation.mjs after \\\"packages/$package\\\" || status=1; done; exit $status'\",waitMs:0,lifeMs:600000})",
    "expected": "A finished command returns its result and delivers law only on found real paths, never sending the sh -c body to stat."
  }
---
Filed from project `runlith`.
