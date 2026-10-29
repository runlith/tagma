---
id: 01a15b9b-8daa-7a54-9a49-9a786962b5e0
title: "A thread working in a foreign project cannot run its programs: check_rules answers terminal-foreign-project with no way out"
ord: 88
tags: ["reflection"]
fields:
  {
    "actual": "`the inspection failed … checker was not admitted: terminal-foreign-project: thread … works project 5; this call addresses project 39 … nothing here is retried and no key answers it`; the answer still writes `submit_work would land this change` and `no violation`",
    "command": "check_rules {project: \"law-lab\", checkout: \"/opt/workspaces/law-lab\", inspection: \"no-console\", over: \"change\"} from a thread with home runlith (5); no-console is Linters.eslint in law-lab tagma.config.ts",
    "expected": "eslint runs in the law-lab checkout on the call's behalf, like built-in checks, and answers with findings"
  }
---
Filed from project `runlith`.

Built-in checks from the same thread in law-lab work (step 5, `domain-no-ui`), programs do not: program execution is bound to the thread's project. Consequences: an orchestrator cannot try on, enable (`enforce_rule` measures by program), or land a change under a program rule in another project; no way out is named in the refusal. The second defect in the same answer: an inspection failure sits next to "would land" and "no violation" rows, and the reader sees a clean result.
