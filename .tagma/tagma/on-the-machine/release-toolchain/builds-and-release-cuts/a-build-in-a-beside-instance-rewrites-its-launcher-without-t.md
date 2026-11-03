---
id: 01a17d12-8041-77ce-82b3-8cfbec7d7aa5
title: "A build in a beside instance rewrites its launcher without the instance variables: its `tagma-dev` starts addressing the main Tagma"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "`writeLauncher` in `installation/cut/build.ts` calls `writeLauncherBeside(root, path, platform)` with no beside environment: the launcher lost its exports, and `restart` restarted the operator's main server on 5633 (its host untouched, pid-91286 logic).",
    "command": "env TAGMA_INSTALLATION_MODE=beside TAGMA_INSTALL_ROOT=<root>/install TAGMA_DATABASE_PATH=… TAGMA_PORT=47821 … bun run tagma:build --no-restart --origin <checkout>, then <root>/bin/tagma-dev restart",
    "expected": "After the build, launcher `<root>/bin/tagma-dev` still exports TAGMA_PORT, TAGMA_DATABASE_PATH and the beside mode, and `restart` restarts the trial server on 47821."
  }
---
Filed from project `tagma`.

`releaseBeside` in `installation/cut/release.ts` passes `besideEnv` to `writeLauncherBeside`, but the build path (`tagma:build`, which the server's `install_next` also follows) does not. So any build over a beside instance, including its own `tagma-dev update`, leaves a launcher that talks to this user's main installation. The first `restart` call the main server refused `operator-only`; the second, without the agent's session variables, went through and restarted it onto the same installation.
