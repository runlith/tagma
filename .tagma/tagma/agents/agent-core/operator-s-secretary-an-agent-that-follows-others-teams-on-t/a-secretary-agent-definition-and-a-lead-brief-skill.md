---
id: 01a16449-f3a3-7a52-9c4a-9053c6dcedc4
title: A secretary agent definition and a lead brief skill
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a163ff-c890-77a1-9b13-0dd3a3d0c9c2",
    "status": "done"
  }
edges:
  - kind: waits-on
    to: 01a16449-f3a3-7a52-9c4a-90515fc6ae4f
  - kind: waits-on
    to: 01a16449-f3a3-7a52-9c4a-9052b32812f7
---
A secretary agent definition and a lead-brief skill.

The secretary is an agent definition in the operator's personal library: it runs the teams of every project. It answers the operator's questions by reading the tree in place — lead answers, task specs, commits; assigns addressed work; files ideas and tasks into the graph after searching; subscribes to the roots it gave birth to or the operator named. The lead brief: the operator does not read a lead's chat; milestones, decisions, and questions go to the secretary via `send_message`, turn progress to nobody. The secretary hands the brief in the assignment to each lead it births and each lead it subscribes to. So the brief is a section of the definition itself, not a separate skill: nobody would load a skill for a lead the operator started.

Done: a `secretary` definition in the server data directory's personal library (`agents/secretary.md`) — a `tagma` agent extension with "what is happening", assignments, team watching, and the lead brief sections. No commit: the file lives outside the repository.
