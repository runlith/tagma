---
id: 01a0c0d5-c7cd-7c20-b0a6-c32a40ce37a4
title: Which git versions the package's spellings need
ord: 105
tags: ["research"]
fields:
  {
    "source": {
      "name": "git",
      "ref": "2.50.1 (Apple Git-155)"
    }
  }
---
Observed on the git named as source. The version floors come from git's release notes; the lazy-fetch behaviour from one local measurement that was not retained, so it is reported here and is not reproducible from this record alone.

- `--end-of-options` — the command-line parser takes it from 2.24; `rev-parse` parses its own arguments and took it later. Nothing here assumes an older git reads either.
- `worktree list --porcelain -z` — printed from 2.36; an older git refuses the flag, never prints a shorter list.
- `check-attr --source=<tree-ish>` — from 2.40 (release notes); an older git refuses the option. `archive` after `--end-of-options` takes the next argument as the tree-ish and every later one as a pathspec, so a `--` there is read as a path; observed on 2.50.1.
- `clean` takes no `--pathspec-from-file` at 2.50.1, so its paths ride the argv, each made literal.
- `worktree add` in a checkout with a promisor remote fetches missing blobs over the network and succeeds. With `GIT_NO_LAZY_FETCH=1` the same command refuses with `fatal: could not fetch … from promisor remote`, fetches nothing (the missing-object count is unchanged), creates no destination and registers no worktree. In an ordinary repository the variable changes nothing: the same measurement checked out and ran the `post-checkout` hook.

Not established: behaviour on any git older than 2.36, and whether a later git changed the `clean` pathspec surface.