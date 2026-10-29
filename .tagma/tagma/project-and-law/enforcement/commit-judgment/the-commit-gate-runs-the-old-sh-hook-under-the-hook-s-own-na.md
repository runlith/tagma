---
id: 01a145a0-e8f4-7321-9480-e4fe62ebec47
title: "The commit gate runs the old sh-hook under the hook's own name: hook managers pick the script by `$0`"
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/contract/wire/gateHook.ts
    symbol: chaining
---
The gate takes the hook name, and moves the old hook to `<hook>.tagma-chained`. Husky (4 and 9) picks the user script by `basename "$0"`: run directly, the moved hook would see its new name, find no `.husky/<hook>.tagma-chained`, and exit 0 — repo checks would silently switch off.

So the gate runs a hook with an `sh`, `dash` or `ash` shebang (directly, through `env` or `env -S`, with flags like `-e`) as `<interpreter> [flags] -c '. "$TAGMA_CHAINED"' "$0" "$@"`: the script sees the hook's own path and arguments. Everything else runs directly, as a file:
- bash — its `BASH_SOURCE[0]` under `source` stays the `.tagma-chained` path, and an entry `[[ "${BASH_SOURCE[0]}" == "$0" ]] && main` would silently skip main;
- zsh — it puts the sourced file's path into `$0`;
- a shebang with `--` or a non-flag argument — `-c` would stand after it and be read as a file name.

Managers baking the hook name into its text (lefthook, pre-commit framework, simple-git-hooks) don't depend on `$0`. `passesOwnGit` compares the chain block by its own line count, so chain text can change without touching that read.
