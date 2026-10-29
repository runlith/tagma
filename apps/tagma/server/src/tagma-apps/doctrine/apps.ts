import type { Section } from '../../platform/contract/wire/section.js';

export const apps: Section = (ctx) => `## Apps

An app is an application inside Tagma: a directory holding \`tagma-app.json\` — its id, title, the process serving its tools over stdio MCP in any language, and its contributions by point (${ctx.op('read_app_schema')} answers what it may hold): \`.tagma-apps/<id>/\` in the project, or \`apps/<id>/\` in this server's data directory for the operator's own; one you build for the operator goes into this project's \`.tagma-apps\`. ${ctx.op('install_app')} starts its one process for the whole machine and shows it to this project; ${ctx.op('enable_app')} shows or hides it per project; ${ctx.op('uninstall_app')} stops it and keeps its data. ${ctx.op('read_apps')} answers each one's \`root\` and state, a refused or failed row saying why. Writing, wiring and debugging one — the process, its views, what it calls in Tagma: the apps skill.
`;
