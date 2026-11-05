import type { Section } from '../../platform/contract/wire/section.js';

export const plugins: Section = (ctx) => `## Plugins

A plugin extends Tagma. One in Tagma's format is written in TypeScript against \`@runlith/tagma/plugin\`, and its build writes \`tagma-plugin.json\` — id, title, options, contributions by point — beside the bundled process serving its handlers; a Claude Code, Codex or Agent Plugins package installs beside it. One you build for the operator goes into this project's \`.tagma-plugins/<id>/\`. ${ctx.op('install_plugin')} installs one from its folder, a git URL or a marketplace entry; ${ctx.op('enable_plugin')} runs it in this project or in every project; ${ctx.op('uninstall_plugin')} removes it and keeps its data. A plugin's contributions stand while any project enables it; its one machine-wide process starts on the first call, tick or view that needs it and sleeps when quiet. ${ctx.op('read_plugins')} answers each one's state, a refused or failed row saying why. Writing, building and debugging one: the plugins skill.
`;
