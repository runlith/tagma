---
id: 01a1428e-678b-7085-b4a2-da02dfc69ff0
title: A held task finishes on its own after submit_work tags an unrelated commit with its id
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "submit_work appended \"(2313c45f)\" to the subjects of ebded7c and 5f6807e (documented), and about four minutes later the journal recorded \"done 2313c45f\" with no session (event 918, 02:07:25Z). The task was finished by the server because an unrelated commit named it, and its open review criterion was skipped.",
    "command": "submit_work {checkout: \"/opt/workspaces/<project>\", paths: [\"tools/orchestrator-*\", \"package.json\", \"pnpm-workspace.yaml\", \"pnpm-lock.yaml\"], subject: \"chore: remove the unused orchestrator packages\"} while the session held task 2313c45f (graph-writing work, unrelated to the commit)",
    "expected": "The commit lands; the held task stays in_work until its holder finishes it with finish_block (its done criterion — an independent review — was still open)."
  }
---
Filed from another project.

Another project (35). The task was claimed by thread 01a141d0-594b-7d16-b6d7-776e77c5ad39; no finish_block was called by any session. The appended task id is documented on submit_work; the automatic finish is not, and the subject tag itself misattributes a cleanup commit to the held graph task because the session held only that one task.