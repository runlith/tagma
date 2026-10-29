---
id: 01a14566-7ba5-7830-95e4-9f342e770fe6
title: "Two independent clones of one repository do not register as two projects: a project's identity is the history's root commit"
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "refused duplicate-root «this root is already registered as project gf-classic»: `projects/identity.ts:14-17` takes repoKey = `rev-list --max-parents=0 HEAD`, identical for both clones. Workaround: `git fetch --deepen=1` in the second clone changed the root commit.",
    "command": "add_project name=gf-tagma rootPath=/opt/workspaces/gf-tagma (a separate `git clone` of the same repository as the already registered gf-classic; both shallow at depth 1 on c3596ea)",
    "expected": "A separate folder with its own .git registers as its own project with its own settings (or Tagma offers to adopt it as a checkout of the same project)"
  }
---
Filed from project `runlith`.

For shallow clones the identity also drifts: `--deepen` changes the root, and the already registered project stops matching its repoKey. The refusal advises a `scopeId` for a subtree — that does not apply to two separate clones.
