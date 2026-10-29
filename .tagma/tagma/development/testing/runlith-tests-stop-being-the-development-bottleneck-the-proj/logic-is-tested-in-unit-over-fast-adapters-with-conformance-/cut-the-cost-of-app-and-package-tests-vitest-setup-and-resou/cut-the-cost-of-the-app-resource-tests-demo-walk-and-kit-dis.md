---
id: 01a16def-6270-7c50-b247-c96cd9c81234
title: Cut the cost of the app resource tests, demo walk and kit distribution
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-5b26-7878-822b-21458858cf1f",
    "status": "done"
  }
---
Three duplicate app composition itests removed in 3b79b4f08f: 23.5 → 0 s of file CPU per the original measurement; 86 owner checks passed, the remaining worker itest passed with no process residue. Generated adapter conformance in f91230a033 no longer rebuilds and packages the SDK; packed declarations are deliberately not covered by a test typecheck. The browser walk in 2cc724169d keeps two findings on a minimal author scene. Together these files: 52.5 → 11.3 s of line CPU (4.65×), afterwards an indicative sample under load; the final quiet run stays with the parent task. Both remaining files green on seeds 1/2/3. Ledger: x10/x-packages.tsv. The historical paneComposition is absent and not counted in the savings.
