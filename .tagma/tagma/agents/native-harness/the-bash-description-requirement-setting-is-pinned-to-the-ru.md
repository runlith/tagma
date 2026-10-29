---
id: 01a14644-63f0-7577-95c9-9e2841d7e50f
title: The bash description-requirement setting is pinned to the run and does not block execution
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a145f0-2b2f-7556-a046-8c7d705ec1f0",
    "status": "done"
  }
---
Add agent.commandDescription (required | optional), default required, for user and project; the value is pinned when the run opens. The bash declaration follows the setting, acceptance always allows a missing description and uses the command's short head in the title. Check: contract tests of both schemas and of execution without a description, the choice unchanged inside the run, bun run typecheck, and one independent Sol xhigh review; finish with a commit, do not restart the running server.
