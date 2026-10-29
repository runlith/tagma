---
id: 01a111dc-1afa-7036-9a0f-432ffbdff675
title: Tagma's own git sees none of the user settings; only the landing's blob write, a checkout's working-view read, commit publication and the stealth graph's network exchange with its remote see them
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/indexSync.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/publish.ts
  - kind: file
    ref: apps/tagma/server/src/landing/merge/modes.ts
  - kind: file
    ref: apps/tagma/server/src/platform/git/ownGit.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
    symbol: ownBlobs
---
`actingGit` and `runGit` launch git with no global and no system config and `core.autocrlf=false`: Tagma's own acts over index, commit and merge give one result on any machine, whatever the user's config holds.

The exception is the landing step that turns working bytes into blobs (`runGit` with `cleans`): whole-file `update-index --add`, both `hash-object` paths of its own texts (batched over the mirror and one by one with `--path`) and the `check-attr filter` dividing them. They see the repository, global and system config, as `configuredGit` does, because a blob must match what the user's `git add` would write: `core.autocrlf=true` from the Git for Windows system config, `core.eol`, clean filters like git-lfs from the global config, and `core.attributesFile`. Without that, a CRLF file with no `text`/`eol` attributes went into the commit with CRLF, and an LFS file without a pointer. Only settings that do not change blob bytes are pinned: `core.safecrlf=false` (landing never refuses where `git add` would only warn), `core.fsmonitor=false` and `core.splitIndex=false` (a temporary index never wakes the daemon and never leaves a `sharedindex` in the git dir).

`spawnGit` (`@runlith/git`) keeps git in its own process group, but drops the reference to it (`unref`) and returns it only on failure or interruption. While the reference stands, the Effect suspender on release signals the whole group, even after git's successful exit, and kills the fsmonitor daemon git started in it. Then with `core.fsmonitor=true` every index read waits about a second on a dead socket and starts a new daemon: `git status` on runlith ran 1.0–1.2 s instead of 70–90 ms. An interrupted git still takes the whole group; a git that exited nonzero the suspender also cleans up by group.

Commit creation also sees the user config: every Tagma commit — landings, commit_checkout, the pull merge commit, `merge_worktree` merge and squash — goes through one `makeCommit` (`landing/land/publish.ts`), and the `rebase`-mode replay through `configuredGit`; `commit.cleanup` and `commit.gpgsign` read the same (`landing/land/hooks.ts`), and the commit's hooks run with the user config, as under `git commit`: their `git add` hashes with his filters. A commit carries the user's identity and signature, as `git commit` does: without that identity came from the machine name, and `commit.gpgsign` from the global config never applied. So `MergeCommits` gets git without the `actingGit` wrapper: the wrapper would close the global config again. A signature git could not make is the `commit-unsigned` refusal in the signer's words — never a silent unsigned commit. An interactive signer (pinentry, 1Password, a key) answers in time: `commit-tree` runs outside the commit lane with its minute ceiling, under the call ceiling, while the lane holds only the branch compare-and-set (`advance` in `platform/git/publish.ts`).

A read whose answer is compared against working-tree bytes — holder bases, landing, turn rollback, the file panel, counters and discharge through `workingTextsAt`, and staged writes that the index pull-up after landing compares against session-text digests through `stagedTextsAt` — goes through `configuredGit` for the same reason: otherwise a CRLF file committed with LF looks wholly changed. The stealth graph's network commands with its remote (`ls-remote`, `fetch`, `push` in `graph/storage/remote.ts`) also run with the user config: the credential helper, `core.sshCommand`, `url.<base>.insteadOf` and proxies are his access to the remote, the same he pushes code with. Password prompting is off (`GIT_TERMINAL_PROMPT=0`), push goes without hooks and without signing (`--no-verify`, `--no-signed`), so the user's global pre-push or `push.gpgSign` neither judges nor signs graph branches. Local exchange steps — ref reads, `merge-base`, `update-ref` — stay without user config.

Common to all are wiped `GIT_DIR` and kin, the `C` locale, `core.longpaths` and `core.quotePath=false`.
