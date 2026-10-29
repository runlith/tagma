---
id: 01a1129a-5607-7dbf-8fe2-02073d2a8b42
title: "Fix the activity re-review findings: immutable read continuations, bounded selection, honest loss coverage, lifecycle and body storage"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111d3-d45b-7adf-8e1a-f4a85ab9b442",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11269-a3ce-7ee4-b5ba-178403b34468
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
---
Re-review of commits up to 6dc4ff2ad9: architecture (Sol) — `scratch/01a1128e-16ea-7a0e-a23a-537f6056c7f0/activity-rereview.md` (3 blocking, 8 major, 2 minor; below 9: completeness 8, lifecycle 7, retention 7.5, performance 7.5, read surface 6.5), performance (Muse) — `scratch/01a1128e-16e9-7e4b-bbbf-642e0bf65654/activity-perf-rereview.md` (N1 major, N2–N6 minor). Fix every finding confirmed by code; a rejected one — with proof. Done when the typecheck and affected tests are green and a third review scores at least 9 on every axis.

Result: the third review's findings were fixed by commits `48b859d92f`, `64987c4119`, `dce2d0b314`, `53f9139f21`, `1d34bcfdd6`, `4467e1beb6`, `0423d42191`, and the coordinator accepted the work without a new round. Left unproven:
- the third round's fixes were not re-reviewed;
- the first-page delay still grows with the matched set size;
- finding 6 (the thread-list window accumulates the whole set) is unfixed and moved to e4024638.
