---
id: 01a174f6-6d57-7b52-96d2-77c43c9514de
title: set_module describes a prepare step the door lacks, and writes a card leaving hundreds of escapes, with no preview
ord: 105
tags: ["reflection"]
fields:
  {
    "actual": "The cards landed at once, 083d37f1 remeasured with 'debt 0 → 0', and 851 violations (private app imports into packages whose entries are not open to the new modules) silently recorded as escaped; visible only through read_enforcement. No prepare parameter in the schema, though the description says '`prepare` measures at HEAD…'.",
    "command": "set_module modules=[38 new app-* cards with relations] in /opt/workspaces/runlith (without absorb/owner)",
    "expected": "One act shows what the record will find outside debt (like check_rules for a change), or the door takes the prepare its description refers to before the card lands."
  }
---
Filed from project `runlith`.

The set_module answer prints only "re-measured … debt 0 → 0" and breaks off ("the answer goes on past what one reply carries"), without naming escaped in the visible part. Fixed with a second set_module (entries of 14 packages), escaped back to 0. Cost: a spare compute-and-record cycle, risk that escapes stay unnoticed. check_rules with `inspection: modules` over an uncommitted card impossible — the card lives in the graph, not the tree — so the door itself should give the preview.
