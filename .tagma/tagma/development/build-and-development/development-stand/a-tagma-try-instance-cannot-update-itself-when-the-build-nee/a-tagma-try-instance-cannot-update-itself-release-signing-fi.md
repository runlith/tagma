---
id: 01a17d10-85eb-7f7d-8a69-65bed4498841
title: "\"A tagma:try instance cannot update itself: release signing finds no keychain under substituted HOME\""
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The build falls after 1 min 39 s: \"signing: security login-keychain exited 1: SecKeychainCopyLogin: The specified keychain could not be found\" — the instance world has HOME=<root>/home, with no ~/Library/Keychains under it.",
    "command": "<root>/bin/tagma-dev update --head in an instance raised by bun run tagma:try with RUSTUP_HOME and CARGO_HOME",
    "expected": "The HEAD build is signed with the \"Tagma Local Signing\" key, as in the first tagma:try cut, and the instance restarts onto it."
  }
---
Filed from project `tagma`.

The second face of the same HOME substitution: after working around rustup via RUSTUP_HOME/CARGO_HOME, the build reached signing and fell on the keychain. Workaround is to build a release in the caller environment (`bun run tagma:build --no-restart --origin <checkout>` with the beside-instance variables and its `bin` first in PATH so the launcher never writes the shell profile) and then `tagma-dev restart`.
