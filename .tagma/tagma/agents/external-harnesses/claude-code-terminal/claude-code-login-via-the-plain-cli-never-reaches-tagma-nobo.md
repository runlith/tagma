---
id: 01a13608-ce1e-7a4a-bce8-76d09867742a
title: "Claude Code login via the plain CLI never reaches Tagma: nobody calls HarnessAccounts.discover in production, and launch trusts the stored signed: false"
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "harness-accounts.json still {directory: null, signed: false}, launch refuses unknown-account default every 15 s. discover() calls exist only in two itests.",
    "command": "The operator ran /login in the Claude Code CLI (Login successful, Claude Max), then the ACP thread on claude-code tried to start again.",
    "expected": "The default account (directory null) picks up the CLI login, and the launch proceeds."
  }
---
Filed from project `runlith`.

`providers/accounts/harnessAccounts.ts:58-105` (`existing`, `discover`) and `:267-290` (`launch`). The fix went to the acp-launch-fix agent, 01a13605-305b-7131-8d13-9f627d06eb07.
