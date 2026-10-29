---
id: 01a1457d-fba6-794d-ba29-1b19fa5e9133
title: submit_work refuses EEXIST symlinking ignored .husky/_ into commit tree
ord: 61
tags: ["reflection"]
fields:
  {
    "actual": "Refused twice with the same text: \"EEXIST: file already exists, symlink '/opt/workspaces/gf-tagma/.husky/_' -> '.../commit-trees/ac6b015c6058aa14705d79cf/tree/.husky/_'\". The commit tree already held a real .husky/_ directory (with hook files) when the symlink was attempted, so nothing was committed.",
    "command": "submit_work { subject: \"Add endpoint for total fees per year in base currency\" } in /opt/workspaces/gf-tagma (Ghostfolio, husky installed, .husky/_ is git-ignored)",
    "expected": "The commit lands the 7 changed files; the ignored .husky/_ directory is either linked into the commit tree once or skipped."
  }
---
Filed from project `gf-tagma`.

Retried unchanged once with the identical result. Nothing in commit-trees was touched and withoutSteps was not used. Worked around with a direct git commit of the explicit paths.