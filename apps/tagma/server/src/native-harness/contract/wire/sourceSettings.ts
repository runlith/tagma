import { Schema } from 'effect';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { nativeKey } from './settings.js';

const RESCAN_POLICIES = ['per-turn', 'manual', 'session-start'] as const;
export type RescanPolicy = (typeof RESCAN_POLICIES)[number];

export const contextFilesEnabled = nativeKey({
  id: 'agent.contextFiles.enabled',
  order: 660,
  title: 'Read instruction files',
  description: "Load a project's own instruction files into the agent's context.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const contextFileNames = nativeKey({
  id: 'agent.contextFiles.names',
  order: 670,
  title: 'Instruction file names',
  description: 'Ordered; the first name that exists in a directory is the one read there.',
  schema: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  fallback: ['TAGMA.md', 'AGENTS.md', 'CLAUDE.md'],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const skillProjectDirectories = nativeKey({
  id: 'skills.directories.project',
  order: 700,
  title: 'Project skill directories',
  description: 'Relative to the project root; later directories win a name collision.',
  schema: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  fallback: ['.agents/skills', '.claude/skills', '.codex/skills'],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const skillGlobalDirectories = nativeKey({
  id: 'skills.directories.global',
  order: 710,
  title: 'Global skill directories',
  description: 'Absolute or ~-relative; read before project directories, so a project can override by name.',
  schema: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  fallback: ['~/.agents/skills', '~/.claude/skills'],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const projectSkillsEnabled = nativeKey({
  id: 'skills.project.enabled',
  order: 680,
  title: 'Project skills',
  description: 'Offer skills found in the project directories below.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const globalSkillsEnabled = nativeKey({
  id: 'skills.global.enabled',
  order: 690,
  title: 'Global skills',
  description: 'Offer skills found in the global directories below.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const rescanPolicy = nativeKey({
  id: 'skills.rescan',
  order: 740,
  title: 'Re-read sources',
  description: 'When skill directories and instruction files are walked again.',
  schema: Schema.Literals(RESCAN_POLICIES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'per-turn', label: 'Every turn', hint: 'The directories are walked again before every turn.' },
      {
        value: 'manual',
        label: 'Manual',
        hint: 'Walked only when asked: Re-read here, or /refresh-instructions in a thread.',
      },
      { value: 'session-start', label: 'Session start', hint: 'Walked once when a thread starts.' },
    ],
  },
  fallback: 'per-turn' as RescanPolicy,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const ownSkillEnabled = nativeKey({
  id: 'skills.own.enabled',
  order: 720,
  title: "Tagma's own skill",
  description: "Offer the skill Tagma installs for external harnesses to Tagma's own agent too.",
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const skillsDisabled = nativeKey({
  id: 'skills.disabled',
  order: 730,
  title: 'Disabled skills',
  description: 'Skills kept out of the agent catalog by name, including built-in skills.',
  schema: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
  fallback: [],
  scopes: SETTABLE_SCOPES,
  merge: 'union',
});

export const SKILL_SCOPES = ['plugin', 'global', 'project', 'built-in'] as const;
export type SkillScope = (typeof SKILL_SCOPES)[number];

export const skillInventoryEntrySchema = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  path: Schema.NullOr(Schema.String),
  directory: Schema.NullOr(Schema.String),
  scope: Schema.Literals(SKILL_SCOPES),
  plugin: Schema.NullOr(Schema.String).annotate({
    description: 'The plugin that brings it, for a skill or command of the `plugin` scope.',
  }),
  enabled: Schema.Boolean,
  replacedBy: Schema.NullOr(Schema.Literals(SKILL_SCOPES)).annotate({
    description: 'The scope of the skill of the same name the catalog offers in its place; null when none stands in for it.',
  }),
});

export const workspaceInventorySchema = Schema.Struct({
  skills: Schema.Array(skillInventoryEntrySchema),
  contextFiles: Schema.Array(Schema.Struct({ path: Schema.String, name: Schema.String })),
  rejected: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
});
