---
id: 01a13ae2-e8d4-788e-a105-08a292d9ddaa
title: A graph read of the global project asks the operator in trust mode
ord: 160
tags: ["reflection"]
fields:
  {
    "actual": "The read stopped on a confirm question \"Search blocks for “ab317873”? — Other project: This call acts on knowledge held in project 8.\" The run waited 12 s on the operator for a 16 ms read; the operator had to step in.",
    "command": "search_blocks {\"query\":\"ab317873\",\"project\":\"global\",\"history\":true} from a runlith thread (home project 5) in Trust mode",
    "expected": "A read of the global graph — whose law already rides every project's prompt and which the prompt tells agents to consult — runs without a question."
  }
---
Filed from project `runlith`.

Thread 01a13ad9-62d0-709e-8021-29b44a8e3ed8, records #163–#165.

Chain: `GRAPH_READ_APPROVAL = { ...ASKS_NEVER, when: [OTHER_PROJECT] }` (apps/tagma/server/src/graph/contract/wire/operations/shared.ts:107); `graphRaises` raises `other-project` for every projectId other than `actor.projectId`, global included (shared.ts:79–88); `OTHER_PROJECT` has `asksFrom: 'trust'` (packages/agent/src/permissions/vocabulary.ts:72), so it asks in trust and review, only bypass passes. Spec 1013e071 already says the global project is not a place of law; the approval condition does not share that exemption. The fact also names the project by id ("project 8") instead of its name.