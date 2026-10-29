---
id: 01a0d2f5-7697-7fc0-9344-10e8823bbb30
title: "The Agents column is the thread tree again: the sections, shortcut rows and group rows go, and the new rows, folds, peek and team strip stay"
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d136-c2b1-74b0-a32d-d96ca4acd1ed
  - kind: relates
    to: 01a0d136-c1a6-7dbb-b477-8dc4f943c3ed
---
The operator decided this on 2026-09-24 after using the built sections of [[a4acd1ed]]. It reverses that decision's column layout and nothing else of the spec [[f943c3ed]].

**1. Outcome.** The Agents column is the thread tree again, composed as it was before [[a4acd1ed]] was built:
- pinned trees first, under the Pinned band;
- then live trees;
- then quiet trees, with a hairline between bands;
- the header's attention counts, which jump to the first working or waiting thread;
- Archived as the folded foot.

Everything else the spec built stays:
- the row grammar and peek of [[fd277fc5]];
- team folding of [[e08ed2e3]] ("N finished", "N more working", counts on a collapsed parent);
- the team strip of [[6c0d60a2]];
- the row fields of [[595698df]];
- the birth fact of [[ddba1d6c]].

**2. Problem.** The operator used the sections (Needs you, Ready, Working, Pinned, Recent) and wants the tree back. The rest they judged fine.

**3. What holds now.** The sections are built in commits d1b2af88c1 and aa70d45725 (task [[577af042]]), and the groups in c70daeb980 and 3cb0d7b8d3 (task [[6baeb699]]), in `apps/tagma/app/src/lib/features/harness`: ThreadColumn, threadTree, ThreadList and ThreadRow's crumb. The pre-section composition is in git history before d1b2af88c1.

**4. Target.**
- **Restore** the column composition, band order, pinned band, header attention counts and archived foot as they stood before [[577af042]].
- **Remove:**
  - the section headers;
  - the Needs-you shortcut rows and their crumbs;
  - Ready's cut, "N more" and Mark all read;
  - Recent's "Earlier · N";
  - the ask-group rows ("N asks", Allow all);
  - the launch-group rows ("Title ×N").
- **Keep** the list keys that do not depend on sections: J/K beside the arrows, A to the next waiting thread in the tree, P, E, Space for the peek and / for the filter.

**5. Owners.** [[2028d329]]: the harness feature's column, tree and list.

**6. Rejected.** Keeping Needs you as a strip above the tree: not asked for. The operator said to return the tree.

**7. Acceptance.**
- The column on real threads looks like the pre-section column, with the new rows, folds and strip.
- No section header, shortcut row, "N asks" or "×N" row remains.
- The attention counts jump.
- The app typecheck and tests pass.

**8. Claims and work.**
- The claims written for the sections and groups by [[577af042]] and [[6baeb699]] die with this change. Each is superseded, or rewritten from the restored code.
- The pre-section claims that [[f943c3ed]] judged "dies" or "absorbed into [[577af042]]" are rewritten from the restored code: the banded composition, pins, the pinned band, band order, attention counts, and the archived foot.
- Ideas [[5403cf1a]] and [[3d2686de]] (Ready and launch groups) lose their subject and are closed.
- Task [[0772907f]] (the Archived total) survives only if the restored foot still wants a total; otherwise it is closed.

**9. Order.** One task.

**10–17.**
- 10 Contract: out, since no wire changes; the row keeps its fields.
- 11 Stored data: out.
- 12 Who may: out, because an act is removed and none is added.
- 13 Long-lived: the section folds' stored marks become unread keys, harmless.
- 14 Bounded: the window of 50 roots is unchanged.
- 15 Rollout: a reload shows the tree.
- 16 Failures: unchanged.
- 17 Observability: checked in a browser.
