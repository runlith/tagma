---
id: 01a1313a-c595-7957-ae4a-5beefdf5787a
title: "A skill can be switched off only by moving its directory: no door, and Claude-Code-only skills from ~/.claude/skills reach native Tagma agents"
ord: 41
tags: ["reflection"]
fields:
  {
    "actual": "Tagma lists every directory in ~/.claude/skills to native agents. codex-delegation matched the operator's \"review gpt sol xhigh\" request and was loaded, steering the agent toward codex CLI instead of spawn_agent. The only way to switch it off was a shell `mv` of the directory out of ~/.claude/skills, which also removes it from Claude Code itself. Cost: an operator turn demanding the skill be removed.",
    "command": "operator: \"switch off this skill (codex-delegation) so I don't see it\" → agent ran `mv ~/.claude/skills/codex-delegation ~/.claude/skills-disabled/` through bash",
    "expected": "One act switches a skill off for Tagma's agents (per project or globally) and back on, the way enable_plugin does for plugins. A skill written for the Claude Code harness (\"Claude-only skill: tells Claude how to drive Codex\" through `codex exec` and Orca terminals) is not offered to native Tagma agents, which launch GPT models through spawn_agent."
  }
---
