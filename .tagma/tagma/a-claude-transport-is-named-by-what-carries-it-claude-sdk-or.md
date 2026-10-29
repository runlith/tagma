---
id: 01a189e2-d10c-700a-aac5-4cb9def695d6
title: A Claude transport is named by what carries it — Claude SDK or Claude CLI — never by a bare "Claude Code"
ord: 1223
tags: ["rule"]
---
Claude SDK: a thread on the Agent SDK runner over ACP. Claude CLI: a thread in the terminal TUI, or a `claude -p` call. The provider `claude-code` serves both, so "Claude Code" alone does not say which one runs. Other vendors' transports are named the same way: SDK, ACP or CLI.