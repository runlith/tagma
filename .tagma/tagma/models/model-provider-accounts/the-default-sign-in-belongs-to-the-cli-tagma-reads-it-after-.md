---
id: 01a1361f-cf4d-7f3a-a38e-90833b360b13
title: The default sign-in belongs to the CLI; Tagma reads it after the provider is selected and keeps lists fresh
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12c5a-e14b-7f23-b49a-56a5c8041df5
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/defaultLogins.ts
---
Whether the CLI signs in with its usual sign-in (no directory, the `default` key) is known only to the CLI itself: the operator signs in, out and switches accounts in their own terminal. So `signed` and `label` are the last reading of `auth.status`, not a fact of their own, and one owner reads it: `DefaultLoginBook`.

The first read needs a provider selection: an addressed catalog request, a CLI-thread launch, a native-model request on its sign-in, or sign-in through Tagma. That selection persists in the account record even when status refuses; old automatically found default records prove no selection. Account directories created by Tagma sign-in already come from an explicit selection. Passive lists and startup never open an untouched CLI.

On launch, the default sign-in is re-read when the launch would otherwise refuse: no record, an unsigned one, or no signed records for the named account. The read does not join an already running list read that may have started before the operator signed in. A healthy signed record needs no extra process: the CLI itself will reject a lost sign-in.

After selection, lists serve answers no older than `LISTED_MS`: quitting and switching accounts in the CLI arrive on their own, and frequent reads start no process per read. A status refusal does not change the previous `signed` and `label`, and the row gets `problem: unreadable`; an addressed launch receives a typed refusal. Accounts with their own directory are not read this way: the sign-in flow signs and removes them.
