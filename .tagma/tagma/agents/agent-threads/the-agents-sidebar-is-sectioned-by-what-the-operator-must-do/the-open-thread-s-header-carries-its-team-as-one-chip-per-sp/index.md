---
id: 01a0d136-c2d9-7e3c-9701-58ec6c0d60a2
title: The open thread's header carries its team as one chip per spawn step, a chip holding a question highlighted
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** The open thread's header carries a team strip, with one chip per spawn step (for example, the review pair spawned together). Each chip shows:
- its members' state dots;
- its name;
- its members' vendor glyphs.

A chip holding a question is highlighted in the waiting tone. Clicking a chip opens a menu of its members, and choosing a member opens that thread.

**Problem.** The fourth question of [[f943c3ed]], "how is a team made up", has no answer on screen except scrolling the tree. Once the sidebar shows only live children ([[e08ed2e3]]), the whole team needs a home, and the header of the thread being read is that home.

**Holds now.** `ThreadHeader.svelte` draws:
- the parent crumb;
- the title (renamable on a root);
- the born-as agent menu;
- the account;
- `ThreadId`;
- `ThreadMenu`.

It finds the row in `list.threads` ([[8cf9d4f1]], [[f37fbcc2]]). Children are the rows whose `parentThreadId` is the open thread.

## Target
- **Members:** the open thread's direct children that the list holds (the window carries every live descendant of an admitted root). A child with a team of its own shows a small count in its chip; the strip does not flatten grandchildren.
- **Chips:** members are grouped by `bornOf` ([[ddba1d6c]]), and the chips are ordered by their first member's handed order. A member with `bornOf` null is a chip of its own.
- **Chip name:** the members' shared profile or agent (`profileId ?? agentId`) when all share one. Otherwise the first member's name, then "+N".
- **Glyphs:** one vendor glyph per distinct provider among the members.
- **Highlight:** a chip holding a waiting member is highlighted, with a count of the waiting.
- **Overflow:** when the strip overflows the header's width, the chips that do not fit collapse into a "+N" chip with the same menu.
- **Absent strip:** no strip is drawn for a thread with no children, or while the open thread's row is outside the list (an archived or paged-out thread, as in [[f37fbcc2]]).

**Owners.** [[2028d329]]: `ThreadHeader.svelte`, plus a strip component beside it. It reads rows through `ThreadList`, and asks the server nothing of its own.

**Rejected.**
- **One chip per member:** a pair reads as two strangers.
- **The whole tree flattened into the strip:** it reproduces the sidebar in the header.
- **Cards per team in the column** (variant C): too tall.

**Acceptance.**
- With a parent that spawned two reviewers in one step, a builder in another step, and one reviewer asking, the header shows 2 chips.
- The review chip carries two dots (one blue) and two glyphs (Opus, Sol), and is highlighted.
- Clicking the review chip lists both members, and choosing one opens it.
- A parent whose children predate [[ddba1d6c]] shows one chip per child.

**Claims touched.** [[8cf9d4f1]] survives: the strip is the team, not what the next turn chooses. [[f37fbcc2]] survives, and the strip stands under its condition.

**Order.** [[c50f5fd3]], which waits on [[37a0a3ab]].

- **10. Contract:** it reads `bornOf`, and absent means a chip per child.
- **11. Stored data:** out.
- **12. Who may do what:** out. Opening a thread is navigation.
- **13. Long-lived things:** out. The menu lives while open.
- **14. Bounded resources:** chips beyond the header's width collapse into "+N".
- **15. Rollout:** out, because this is client-only.
- **16. Failures:** out, because it is derived from the feed's rows.
- **17. Observability:** the acceptance case, on a live review pair.
