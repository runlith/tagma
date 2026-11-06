---
id: 01a14564-656e-7e40-9f43-ef38e29c3592
title: The server exits on its own a minute after the signal, and quit takes it down with SIGKILL after one and a half
ord: 17
tags: ["explanation"]
edges:
  - kind: supersedes
    to: 01a1417f-9dbb-7825-ae17-a672d4dfb793
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/stopping.ts
---
A regular exit closes the writers. A writer held by stuck work would hold the exit just as long — up to the 15-minute wait ceiling. So the signal arms a process deadline: a server that has not closed within it exits without finishing closing. SQLite keeps only committed data, and on restart the successor takes the data directory as soon as the predecessor has exited.

`quit` (used by the window's Stop and Quit) first cancels the process generation and signals its witnessed members. It escalates remaining members to SIGKILL after its longer grace and reports that escalation; completion still requires their actual departure, not expiry of either deadline. An issued predecessor without cancellable generation membership can leave an unrecorded automatic return, so its stop remains explicitly unproven.

Restart preparation reads the migration chain through readers, not through the writer. Otherwise `restart_server` would wait for that same stuck writer before even starting.
