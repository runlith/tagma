---
id: 01a1404e-36da-7e13-9f27-f758664d80e9
title: Law checks do not start after the parses export changes in code-facts
ord: 47
tags: ["reflection"]
fields:
  {
    "actual": "8 inspections finished before the check with SyntaxError: Export named 'parses' not found in module '/opt/workspaces/runlith/packages/code-facts/src/languages/js/imports.ts'. Refuses=true, fingerprints 0; effect-style not measured.",
    "command": "check_law({paths:[\"packages/agent/src/collaboration/CollaborationTools.test.ts\"],whole:true,limit:30})",
    "expected": "Check 17 rules over the test-file change and return violations or a green result."
  }
---
Filed from project `runlith`.
