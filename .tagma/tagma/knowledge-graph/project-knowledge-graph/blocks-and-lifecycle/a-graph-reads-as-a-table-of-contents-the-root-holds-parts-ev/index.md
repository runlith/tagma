---
id: 01a18319-42dc-76d5-8f38-ae98aa192705
title: "A graph reads as a table of contents: the root holds parts, every block stands under what it is about, and the type is a section, never a folder"
ord: 28
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14b9b-d842-7f67-8b91-c95e1310e014
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/graph
  - kind: dir
    ref: apps/tagma/server/src/catalogs/contract/wire
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/birth.ts
  - kind: file
    ref: apps/tagma/server/src/graph/doctrine/graphWriting.ts
  - kind: file
    ref: apps/tagma/server/src/reflections/filing.ts
---
**Why.** A person who installs Tagma, sets no rules and just works with agents should open the graph a week later and find it already in order: parts, short pages, nothing to fight. That first impression decides whether they stay. Agents write the graph, people read it, and today every graph a person opens after a week of agent work is a flat list in birth order: a block with no parent named is born at the root (`graph/blocks/birth.ts`, `rootBlockOf`), a new module card too (`set_module`, `enforcement/rules/modules.ts`), the law tells agents a block "stands under its semantic owner" without saying how to find it and that a rule's place "decides nothing", and the app draws storage as it is. In `tagma` this left 178 children at the root, 60 of them modules copied one-to-one from `packages/`, in birth order, and 319 features kept apart from the modules they are made of. Agents place well when placing is their job: a pass given a clear brief placed 986 of 999 blocks under their owners. So the order comes from the law Tagma ships and the write door, not from the user's rules or new machinery.

## The structure

- **The root is a table of contents.** It holds the parts of the project and only the rare block no part owns. A block's place decides only where readers find it, never who receives its text: a rule with no sources reaches every thread wherever it stands, so having no sources is no reason to stand at the root.
- **Parts appear when the project needs them.** While the root's children fit a screen, the root holds modules or topic pages directly; a novice's small project gets no empty level. When they outgrow it, they are grouped into parts. A part is a page — an untagged note — holding one area of what the user gets: its modules and capabilities in a project with code, its topic pages in a notebook. It is never a module card: a card owns one directory, and an area of what the user gets runs across directories. A module stands under its part wherever its code lies: the module map reads a module's territory from its root, and a card holding cards is only a group with no code of its own. Under an application's card stay only the modules that make up that application as a whole.
- **Every block stands under what it is about.** Knowledge, law, work and observations about code stand under the container owning that code — the nearest block supporting core/container whose sources cover it, in a project with code its module — never under another leaf `read_owners` answers for the same file. Work stands under what it changes: a module, a capability, or the part when it spans the part. Anything else — law, a note, an idea, a reading — stands under the page of its topic or area. When no owner exists, the owner is created first.
- **What the user gets stands beside what it is made of.** Where a project describes its capabilities in blocks of their own — `tagma`'s own `#feature` tag; the shipped catalogs carry none — they stand under the part, never under a module: a capability usually runs through several modules. A module page lists the capabilities its code carries, read from their sources, never placed twice.
- **A list a person scans fits one screen: 20 rows.** A row is about 30 px, and a 13-inch laptop at the default zoom shows about 20 below a page header. Past that, the list's owner splits it into groups by subject — chapters, never tags.
- **The type is a facet, never a folder.** No branch gathers blocks by tag. A page shows its children in sections by role — pages, capabilities, modules, knowledge, law, work, observations, history folded — and lists across the graph (all open work, all law, all reflections) are views and places of the sidebar.
- **A title names its subject in a short line a person scans**; the body carries the rest.
- **This is the default.** A user's own rules and tag parts override it; nobody has to write any for the graph to be in order.

## What changes

1. **The write door.** Every act that births a block takes a parent: `create_block`, `create` in `apply_batch`, `set_module` for a new card. Without one it refuses `parent-required` with the ways out — the owner `read_owners` answers for the block's sources, the page of its topic, or the root named explicitly. Moving a block to the root (`parentId: null`) and moving a subtree into another project stay explicit choices and are unchanged. The app creates a block on the page it is created from.
2. **The write answer.** When a write leaves its parent with more than 20 children of one role, the answer says so and names the parent, so the writer groups it in the same work. Tagma never regroups a graph by itself: an old flat graph tidies where agents work in it.
3. **The law** — every sentence ships to every user:
   - the graph-writing section (`graph/doctrine/graphWriting.ts`) replaces "A node stands under its semantic owner, chosen after reading that region" with: every block stands under what it is about — code knowledge, law and work under the owner `read_owners` answers, work under what it changes, a note under its topic's page; a missing owner is created first; the root holds only the parts and the rare block no part owns, named explicitly; a page a write's answer names as past a screen is grouped by subject in the same work; a title is a short line a person scans;
   - `#module` (`softwareDevelopment.ts`), the `set_module` parent and its refusal: a module stands under its part, wherever its code lies; a card holding cards is a group with no code of its own;
   - placement is said once, in the graph-writing section, for a block of any kind; a tag prompt names where its kind stands only where the kind differs from that rule (a module by area wherever its code lies, under an application's card), so `#rule`, `#explanation`, `#task`, `#spec`, `#reflection` and the notebook tags carry no placement clause;
   - `#rule` says only that its place decides nothing about who receives it, and that `delivery` takes the narrowest reach: `code` sourced to the code a norm is about, `prompt` only for a norm every thread needs.
4. **Reflections (developer builds only).** `file_reflection` lives in a developer module the release never carries; it files under the owner of the code declaring the operation or tool the friction is about, never silently at the root.
5. **The `tagma` graph.** One pass under the new law: the root becomes the parts the feature-catalog areas already cut ([[1310e014]]); each area's features and the modules the table assigns to it, the server's and the app's included, stand under one part; rules and explanations with sources stand under their modules; lists past 20 rows are grouped; container titles are shortened; `Dump` is sorted.
6. **The app.** The row: one grid at every depth — chevron column, the tag's icon as the row's one mark, title, facts — with the branch line from the parent icon's centre; a square state tile among the facts only on blocks with a lifecycle, no date outside work, a container's count, one weight, one line with a fade in navigation. The pages: the root as a front page of parts, law and work; a container page in sections by role, a module page with the capabilities its code carries; the sidebar as places, not a second copy of the tree. Pages are built after a mockup of the whole screen; the row does not wait for the structure.
7. **The agent's map.** The start map draws a page holding modules as a group, so an agent meets the parts a person reads.

## Order

The structure first (this spec), then the door, the write answer and the law together (the refusal's way out is the law), then a synthetic run on a fresh project with code and a fresh notebook, both with no rules of the user's, then the `tagma` pass, then the pages. The row may go at any time.
