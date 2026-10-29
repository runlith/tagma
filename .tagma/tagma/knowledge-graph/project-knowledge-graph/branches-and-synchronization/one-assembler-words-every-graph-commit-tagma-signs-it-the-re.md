---
id: 01a180cd-41f2-73e4-8d5b-4f3f5be18b81
title: "One assembler words every graph commit: Tagma signs it, the repository's own commits set its shape, and a .tagma commit names only team blocks"
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a10e4a-9107-74f0-98e5-a576ed330a7f
  - kind: relates
    to: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/committer.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/message.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/writeThrough.ts
    symbol: writeThrough
---
Every graph commit — the team tree's `.tagma` commit, the stealth layer's commit and a stealth project's own-git commit — is worded by `commitJournal` in `graph/tree/message.ts`; neither committer writes text of its own, and an act hands its committer only the paths it wrote.

- **The words come from the journal, not from memory.** Each tree keeps the journal position its last commit covered in the mirror's `meta` (`graph-committed`, `graph-committed:stealth`). A commit reads the act range and the blocks it names under the same tree permit as its capture, so a later rename or storage change cannot reword or drop an act the captured files carry. A graph copy closed, a server restarted or a commit failed, interrupted or held before landing changes nothing: the position moves only after a commit lands (or finds nothing to commit), so the next commit names every act since, once. Publication and the position write share one uninterruptible step behind a landing record; a crash or store failure between them leaves the record, and the next commit first looks for a Tagma commit carrying that `Tagma-Graph` position among the tree's recent commits and advances to it, instead of naming landed acts again. A storage move publishes the whole tree, so the moved mirror's positions advance to the journal's end. A missing position is set to the journal's end when the graph opens: acts older than this record are never listed.
- **The cost is the range.** One read of the events in range, of their blocks and of their signers' sessions, paged by id; a long manual pause yields a long body, nothing else.

- **The author is Tagma.** Author and committer are `Tagma <agent@tagma.dev>` because GitHub binds a commit to an account by author email; a per-agent author bound to nobody and left graph commits without avatar or link. Act attribution stays in the graph journal and the sync result rather than a commit-message line of thread identifiers. Every other commit Tagma makes itself — the stealth graph's acts, merges, merge conclusions and birth, the format-level commit, the landing's internal merge-index commit — carries the same identity; older history keeps `<name>@tagma` authors, which checkout history still counts as graph commits for `tagma@tagma`.
- **The shape is read from the repository, never imposed.** Before each commit the assembler reads the last ten non-merge commits of the code checkout's HEAD that change something outside `.tagma` — a graph commit, Tagma's or anyone's, never votes, whatever its author or subject, and a run of graph commits never pushes people's commits out of the sample; when most are Conventional Commits the subject is `docs(graph): …`, otherwise a capitalized phrase. An unborn branch or a checkout that is no repository gets the plain phrase; any other git failure fails the commit, which retries. Titles are folded to one line, so a title with line breaks never splits the subject or an act's body line. The stealth tree reads the same code checkout: its own git holds only Tagma's commits and has no convention to follow.
- **A `.tagma` commit names only team blocks.** The team scope words only blocks whose rows are not stealth: one act can touch both trees, and a stealth title in a public commit message leaks what stealth storage exists to hide. The stealth layer words only stealth blocks; a stealth project's own tree words all.
- **The journal position is a trailer, not the subject.** `Tagma-Graph: <position>` keeps the subject free for meaning; nothing recognizes a graph commit by its subject.
- **Weight decides the subject.** Opened and closed specs, then done and new tasks, then new rules, then the rest — by contract (`core/spec`, `core/work`, `core/law`), never by tag name, so a project's own vocabulary weighs the same. A single heaviest act identifies its block within the 72-character subject, prefix included: its title ends at a whole word with `…` when needed, and the body keeps the complete title. If no title word fits, a single-act subject uses the block's handle. A multi-act batch keeps the leading title with `and N more` when it fits whole or leaves at least 20 title characters; tied leaders or less readable contractions use counts by verb and tag. Plain subjects use the same budget and selection.
