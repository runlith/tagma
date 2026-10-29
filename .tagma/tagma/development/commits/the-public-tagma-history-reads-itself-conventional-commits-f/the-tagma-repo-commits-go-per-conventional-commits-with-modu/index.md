---
id: 01a17f5f-3c8d-78c2-b6c7-2ab23bffa0a7
title: The tagma repo commits go per Conventional Commits with module scope, and release notes assemble from history
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
---
**What we get.** In the tagma repo every code commit — agent's, operator's, or contributor's — is written in one shape that shows the change type and module, and release notes assemble themselves from history.

Of the latest 209 code commits right now, not one has a type: the subject is a long phrase with tasks in brackets at the end.

## Shape

```
feat(threads): move a thread into another project

Why and what changed in behaviour, in one to three sentences.

Task: 26c5d6b8 Move a thread into another project through move_thread
Co-authored-by: Tagma <agent@tagma.dev>
```

- Type: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`. The type is honest: a mechanical edit is not `feat`.
- Scope is the module id from its card without `@runlith/`: `graph`, `threads`, `code-facts`, `checkout-files`. A change across modules takes the one it was made for; a change across the product takes none. The `graph` scope at graph-bot commits matches the graph module by name; author and content tell them apart.
- Subject in English, imperative, lowercase, no trailing period, at most 72 characters.
- `!` and the `BREAKING CHANGE:` trailer only when what users and adapter authors rely on breaks: the `@runlith/tagma` package, CLI commands, operation inputs.
- Body and trailers per [[c11265c5|the commits Tagma assembles]]; a human committing by hand writes type, scope, and subject the same way.
- Old history is not rewritten.

## How it holds

- A `tagma` project rule with prompt delivery: the commit shape above. No automatic check on the subject — Tagma rules judge the file tree — so this is a text rule.
- `CONTRIBUTING.md` describes the same shape for humans and requires the PR title in it; squash-merge takes the PR title (repo setting is the operator's).

## Release notes

Publishing a release (`installation/cut/publish.ts`) writes into the GitHub Release body the `feat`, `fix`, and `perf` commits since the last release, grouped by type, with scope and `Task` lines; `BREAKING CHANGE` is the first section. Graph commits and other types never reach the notes.

## Performer checks

- Release notes covered by a publishing test on a repo with a history of all types: sections, order, no graph commits.
- The rule recorded and standing in a new thread's prompt in the `tagma` project.
