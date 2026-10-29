---
id: 01a16d48-a027-7e9b-a7b3-c9c255ce1d88
title: Deleting a thread requested synchronously from inside its own settlement subscriber or on.ended hook waits for itself
ord: 10
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16d34-ca3c-771b-b611-881fd6ff2679
---
After 33ae84b7a9/a54cc8c2e8 (task [[d6ff2679]], explanation [[4a67b8ac]]) `ThreadDeletion.settle` waits for the driven work and the publications of the thread. Deletion requested synchronously from that same work (a settlement subscriber or an app's `on.ended` hook deleting its own thread) waits for itself: with `within` it refuses `still-settling`, and `deleteByHost` without `within` would wait forever. No `delete_thread` caller does that today (grep). The fix requires moving external hooks out of the run fiber — a separate design decision.

Done when deleting one's own thread from a subscriber or a hook either goes through or refuses with a cause and a way out, and `deleteByHost` cannot wait forever. Verification through the same door.
