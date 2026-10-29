---
id: 01a15a9c-2d4e-7e70-910f-e6651cabb6bb
title: enforce_rule refuses ambiguous-name with two identical candidates when the same block id exists in two projects, with no way out
ord: 123
tags: ["reflection"]
fields:
  {
    "actual": "ambiguous-name: unblock twice \"876818ad9402\" — the full id is identical; enforce_rule has no project parameter (passing project refuses body-shape), so there is no way to call the law-lab rule",
    "command": "enforce_rule {blockId: \"18ad9402\", base: \"3d752dc5b47b\", strictness: \"gate\", absorb: \"all\", owner: \"7b8d8888\"} from the runlith thread; the rule lives in law-lab (39), its copy with the same id is in project 40, a law-lab clone",
    "expected": "A project can be named (as in read_enforcement, which answered with project: law-lab), or the candidates differ by project"
  }
---
Filed from project `runlith`.

Project 40 is a law-lab clone registered by a CLI without TAGMA_SERVER_URL; blocks in it carry the same ids. read_enforcement accepts `project` and works; enforce_rule does not. The unblock way out should tell candidates apart by project, and the door should accept project like its neighbouring operations.
