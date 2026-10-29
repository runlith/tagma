---
id: 01a12f59-488d-7856-859e-5a1ffee219c9
title: A tagma:try root's bin/tagma talks to the operator's server, not to the instance it belongs to
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "It reached the operator's live server on the default port. begin_sign_in ran there: a pending claude-code account landed in ~/.tagma/harness-accounts.json, a login terminal opened in the operator's project 'personal', and `claude auth login` opened a browser tab. Cleaning up took three more acts (stop_terminal, remove_account, rm of the account directory). Only setting TAGMA_PORT, TAGMA_DATABASE_PATH and TAGMA_INSTALL_ROOT (besideEnv) reaches the instance, and neither the try answer nor the root's bin says so.",
    "command": "bun run tagma:try --root $TMPDIR/hs-try --port 4917 --json; then $TMPDIR/hs-try/bin/tagma op begin_sign_in --json '{\"provider\":\"claude-code\",\"projectId\":30}'",
    "expected": "The CLI shipped inside the try root (or the try answer's own instructions) reaches the isolated instance on port 4917 and its database."
  }
---
Filed from project `runlith`.

tagma:try's JSON answer names url/database/root but not the environment a CLI needs to address it. A try root's bin could bind its own port/database, or the answer could print the besideEnv line.