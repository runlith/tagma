---
id: 01a1942a-116c-7aca-ac54-1edb6cdd88db
title: A pinned old testbed cannot sweep directory-form reports made by the current testbed
ord: 1224
tags: ["reflection"]
fields:
  {
    "actual": "The command exited 1 before starting any test: pinned testbed sweepRuns removed directory /tmp/runlith-test/reports/run.77843.1793243973474 as a file and raised EISDIR.",
    "command": "/Users/teunlao/runlith/runlith/node_modules/.bin/testbed bun test --no-isolate ./src/profiles/anthropicOAuth/ClaudeCodePresentation.itest.ts --test-name-pattern 'a fork on its own lane'",
    "expected": "The offline test starts while old and current testbed versions share the machine report directory."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.