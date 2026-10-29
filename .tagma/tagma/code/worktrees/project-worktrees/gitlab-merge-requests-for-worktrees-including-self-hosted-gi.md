---
id: 01a0d4a4-e086-711f-84c5-b2d8b886a5c5
title: GitLab merge requests for worktrees, including self-hosted GitLab
ord: 31
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Tagma opens PRs only on GitHub through `gh`. The operator works with a self-hosted, private GitLab, where open, close and link of merge requests would go through `glab` or the API.

What would inform the choice:
- how the instance authenticates (token, SSO) and whether `glab` reaches it;
- whether the MR API allows retargeting a source branch;
- how a private host is configured per project.

Until then, rename and PR acts on a GitLab remote act locally and say so.