---
id: 01a13211-776e-7288-b1f4-4fb53803d570
title: enforce_rule patch of one allow-list entry fails inspection-failed (envelope) because it re-measures the whole region
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "inspection-failed (envelope): \"swallowed-failures is not judged: the subject reaches 2120 files and 9.6 MiB, past its calibrated envelope of about 10482 files or 12.1 MiB alone (… would pass 120 s)\". Nothing written; the allowance cannot move, so a commit that moves the allowed file is refused by the gate.",
    "command": "enforce_rule ea465bed (swallowed-failures, gate) with inspection {patch:[{builtin:'swallowed-failures', list:'allow', drop:[{redacted}], put:[{redacted}]}]} base 1c710d3f18df",
    "expected": "Moving one allowance to the file's new path lands (it changes one key of the stored policy; the moved site is the same site hash)."
  }
---
Filed from project `runlith`.

The moved file is not yet in HEAD (the mover is waiting for the allowance before landing). The patch form re-runs the full inspection over the rule's whole region instead of judging the touched entries, and that whole-region run is predicted past 120 s, so a one-line policy edit is impossible. Expected the patch to be measured over the files the changed entries name (or a moved-file follow like the modules builtin does).