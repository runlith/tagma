---
id: 01a1686c-5470-7689-9c11-7bb50b599f2e
title: Unanswered sightings under an answered reflection vanish from read_reflections
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "read_reflections shows 102 rows; query_blocks counts 146 unanswered reflections. 27 of the 44 nested ones sit under answered parents (e.g. 38da7749 under answered 3c2ed99d, cf7839ff under answered d7c9afe2, a6377375, f943ca0f) and are visible in no triage list.",
    "command": "read_reflections(limit=268) beside query_blocks(tags=[reflection], sort created asc) in runlith",
    "expected": "Every unanswered reflection is reachable from read_reflections: answering a parent either settles its sightings or leaves them as standing rows."
  }
---
Filed from project `runlith`.

file_reflection already refuses `ontoId` onto an answered entry (`already-answered`, reflections/filing.ts, since e44faca5f4); these children were filed while their parent stood open, and answering the parent left them unanswered. read_reflections drops every reflection child regardless of the parent's state (graph/work/filedReflections.ts `standing`), so once the parent is answered its unanswered children are visible in no triage list. Found during a full reflection triage on 2026-10-23.