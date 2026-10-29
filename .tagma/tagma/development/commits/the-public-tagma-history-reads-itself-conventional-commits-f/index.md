---
id: 01a17f5f-3c8d-78c2-b6c7-2ab0da57b535
title: "The public tagma history reads itself: Conventional Commits for humans and agents, graph commits from Tagma (tagma-dev), the project graph in the repo"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**What we get.** A visitor of `runlith/tagma` sees a live project and understands from one commit history what is being done in it: every code commit states the type, module, what changed and why, and names the task; every knowledge commit states what opened, closed, or got fixed in the graph, with the `tagma-dev` avatar. The project graph lives in the same repo and reads on GitHub straight as Markdown: the product shows itself on itself.

Why: an open graph is the best Tagma demo, and frequent meaningful commits mark a maintained project. History is a second knowledge source beside the graph: release notes, "what changed in the module", "which commit did the task" come from `git log` without Tagma.

## Parts

1. **Commits Tagma assembles** (product, for all users): repo-convention format, body and trailers at agent commits, `tagma-dev` author and meaningful messages at graph commits, recognizing graph commits by content.
2. **The tagma repo commit law**: Conventional Commits with module scope, for agents and humans; release notes from history.
3. **Publishing the tagma graph**: business and personal into the `runlith` graph, the rest in English, the project into team storage.

## Order

- Parts 1 and 2 and extracting the private from part 3 go in parallel: they do not depend on each other.
- Graph translation comes after extraction: what leaves is not translated.
- Switching to team goes last, after part 1 and after translation: the public graph history starts at once with meaningful `tagma-dev` commits.
- Release notes come after the release-publishing work (`installation/cut/publish.ts`) lands.

## What the operator does

- Holds the `tagma-dev` machine GitHub account with verified `agent@tagma.dev` address — the identity Tagma signs its commits with: Tagma name, logo, link to tagma.dev. Account created 2026-10-28.
- Sets squash-merge to PR title and description in `runlith/tagma` settings.
- Allows push after switching.

## Acceptance

It belongs to the parts; the shared part here: after push the latest `runlith/tagma` commits on GitHub are code commits per Conventional Commits with task trailers and graph commits from `tagma-dev` with avatar and meaningful subject, and `.tagma/` opens in the browser as English documentation.
