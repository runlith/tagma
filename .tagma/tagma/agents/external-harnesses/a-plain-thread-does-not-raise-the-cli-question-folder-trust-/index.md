---
id: 01a1424a-e721-7e2c-8986-a0532e5f9389
title: "A plain thread does not raise the CLI question (folder trust dialog) in Questions: the thread hangs \"working\", the question is visible only in the terminal"
ord: 181
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141bd-4d86-7052-9111-958c8dc139ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a141bd-1de3-79e9-903b-8de5136ee86c
  - kind: implements
    to: 01a141bd-0e7f-7dc8-8ef7-ab6a510a47c0
---
Thread `plain-probe` (`01a14246-a097-70c6-93b6-5d42ff6b0f06`, project polygon, profile `{"claude":{"home":"/opt/workspaces/.claude-classic","plain":true}}`) after `spawn_agent` stands on the Claude Code dialog "Accessing workspace: /opt/workspaces/polygon … Is this a project you created or one you trust? ❯ No, exit / Yes, I trust this folder". The agent list shows it working, with no question to the operator or the parent.

A question the CLI asks is the thread's question: it belongs in `Questions` with the widget's options, the thread goes `awaiting`, and the answer (operator's or parent's) goes as keystrokes into that widget, as with terminal threads carrying screen questions. Plain must not lose this: Tagma puts nothing into the agent, but it shows its CLI's questions. Also check the other first-run widgets (bypass-permissions, theme choice, login) — each is either a question or a declared birth refusal with a reason.

Done when: a plain thread on a fresh folder raises the trust question, the parent answers "Yes", and the turn runs to the report; test on the owner's layer.
