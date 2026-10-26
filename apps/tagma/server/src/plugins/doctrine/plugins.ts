import type { Section } from '../../platform/contract/wire/section.js';

export const plugins: Section = (ctx) => `## Plugins

A plugin is an app inside Tagma: a directory holding \`plugin.json\` — its id, title, the process serving its tools over stdio MCP in any language, and its contributions by point (${ctx.op('read_plugin_schema')} answers what it may hold): \`.plugins/<id>/\` in the project, or \`plugins/<id>/\` in this server's data directory for the operator's own; one you build for the operator goes into this project's \`.plugins\`. ${ctx.op('install_plugin')} starts its one process for the whole machine and shows it to this project; ${ctx.op('enable_plugin')} shows or hides it per project; ${ctx.op('uninstall_plugin')} stops it and keeps its data. ${ctx.op('read_plugins')} answers each one's \`root\` and state, a refused or failed row saying why. Writing, wiring and debugging one — the process, its views, what it calls in Tagma: the plugins skill.
`;
