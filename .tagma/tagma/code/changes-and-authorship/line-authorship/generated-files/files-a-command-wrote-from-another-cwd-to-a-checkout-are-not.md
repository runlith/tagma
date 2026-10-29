---
id: 01a13f19-dc78-7dc9-9b13-32ef762842e3
title: Files a command wrote from another cwd to a checkout are not attributed to the session, and submit_work cannot commit them
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "First submit_work committed 47 paths and silently left 17 untracked paths (four license-document texts and all API fixtures): neither `left` nor `unattributed` named them. The second call with those paths answered `nothing to commit — paths named no file this session holds`. Had to commit directly via `git commit -- <paths>` — an extra step and a commit past the change record.",
    "command": "bash `python3 capture.py …` / `python3 docx2md.py` (workdir = thread scratch) writes to ~/.tagma-dev/worktrees/<project>/<branch>/<app>/src/lib/app/<feature>/{fixtures,documents}; then submit_work checkout=<branch> paths=[…/documents, …/fixtures]",
    "expected": "A command of this session that wrote files into a registered checkout at least lands in `unattributed`, and submit_work with those paths in `paths` commits them."
  }
---
The command-write observer apparently only counts paths under the command cwd: when the workdir is the thread scratch, writes to another registered checkout by absolute paths are invisible entirely. Without these files the branch does not work: the first commit would leave references to documents and fixtures that are missing. Most dangerous is that the submit_work answer looks complete — `left` is empty, `unattributed` unnamed.
