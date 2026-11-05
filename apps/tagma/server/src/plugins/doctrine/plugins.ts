import type { Section } from '../../platform/contract/wire/section.js';

export const plugins: Section = (ctx) => `## Plugins

A plugin extends Tagma: a directory in Tagma's format holds \`tagma-plugin.json\` — its id, title, options, the process serving its tools over stdio MCP in any language, and its contributions by point; a Claude Code, Codex or Agent Plugins package installs beside it. One you build for the operator goes into this project's \`.tagma-plugins/<id>/\`. ${ctx.op('install_plugin')} installs one from its folder, a git URL or a marketplace entry; ${ctx.op('enable_plugin')} runs it in this project or in every project; ${ctx.op('uninstall_plugin')} removes it and keeps its data. A plugin's process runs once for the whole machine while any project enables it. ${ctx.op('read_plugins')} answers each one's state, a refused or failed row saying why. Writing, wiring and debugging one — the process, its views, what it calls in Tagma: the plugins skill.
`;
