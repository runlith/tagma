import { realpathSync } from 'node:fs';
import { Schema } from 'effect';
import { agentSkillLine, SKILL_REFERENCE_INSTRUCTIONS, SKILL_REQUEST_INSTRUCTIONS } from '@runlith/agent/AgentSkill';
import { withdrawn, worldStateSection, type PackedWorldStateSection } from '@runlith/agent/WorldState';

const skillSummaries = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    description: Schema.String,
    references: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) }))),
  }),
);
const instructionFiles = Schema.Array(Schema.Struct({ path: Schema.String, body: Schema.String }));

export type SkillSummary = (typeof skillSummaries.Type)[number];

export type WorldState = {
  readonly skills: readonly SkillSummary[];
  readonly contextFiles: readonly {
    readonly path: string;
    readonly body: string;
  }[];
  readonly scratch: string;
};

const SKILL_HOW_TO = [
  SKILL_REQUEST_INSTRUCTIONS,
  'A skill is loaded IFF its current instruction payload is present in model-visible message history.',
  'Load a skill when the task needs its specialized guidance or tools, not merely a matching keyword.',
  'Call `load_skill` before using it: loading returns its instructions, unlocks its tools, and never changes the system prompt;',
  'a skill already loaded answers a short note instead of repeating its body.',
  'If compaction removes the payload, or the skill on disk changed, it is locked again and must be loaded',
  "before matching work. If no skill matches and none is explicitly requested, DON'T load one.",
  'A skill is switched off for Tagma agents by naming it in the `skills.disabled` setting, of this project or of the operator: its directory stays, and other harnesses keep reading it.',
].join(' ');

export function worldStateSections(world: WorldState): PackedWorldStateSection[] {
  return [scratchSection(world.scratch), instructionFilesSection(world.contextFiles), skillCatalogSection(world.skills)];
}

export function scratchSection(scratch: string): PackedWorldStateSection {
  const said = (path: string) => `Scratch: ${path}. Bare filenames passed to operations resolve here; files last until this thread ends.`;
  return worldStateSection({
    id: 'scratch',
    codec: Schema.String,
    read: () => scratch,
    baseline: (current) => said(current),
    update: (_previous, current) => said(current),
  });
}

const standing = Schema.Struct({ worktree: Schema.NullOr(Schema.String), path: Schema.String });

const spelled = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export function placementSection(workingRoot: string, projectRoot: string): PackedWorldStateSection {
  const named = (path: string) =>
    path
      .split('/')
      .filter((part) => part !== '')
      .at(-1) ?? path;
  const where = (current: typeof standing.Type) =>
    current.worktree === null
      ? `the project's main checkout at ${current.path}`
      : `the worktree ${current.worktree} at ${current.path}, not the project's main checkout at ${projectRoot}`;
  return worldStateSection({
    id: 'placement',
    codec: standing,
    read: () =>
      spelled(workingRoot) === spelled(projectRoot)
        ? { worktree: null, path: projectRoot }
        : { worktree: named(workingRoot), path: workingRoot },
    baseline: (current) => `Checkout: ${where(current)}. Commands and file tools run here.`,
    update: (previous, current) =>
      `You now stand in ${where(current)}; files you read before the move were in ${previous === undefined ? 'another tree' : where(previous)}.`,
  });
}

const failedSetup = Schema.Struct({
  worktree: Schema.String,
  step: Schema.String,
  reason: Schema.String,
  execution: Schema.NullOr(Schema.Struct({ execution: Schema.String, incarnation: Schema.Int })),
});

export type FailedSetup = typeof failedSetup.Type;

export function setupSection(failed: FailedSetup | null): PackedWorldStateSection {
  const told = (current: FailedSetup) => {
    const where =
      current.execution === null
        ? 'No execution of it can be read.'
        : `Read what it printed with read_output execution ${current.execution.execution} incarnation ${current.execution.incarnation}.`;
    return `The setup of the worktree ${current.worktree} failed at its ${current.step} step, and you work in it as it stands: ${current.reason} ${where}`;
  };
  return worldStateSection({
    id: 'worktree-setup',
    codec: failedSetup,
    read: () => failed ?? withdrawn,
    baseline: told,
    update: (_previous, current) => told(current),
  });
}

export function skillCatalogSection(skills: readonly SkillSummary[]): PackedWorldStateSection {
  const summaries = skills.map((skill) => ({
    id: skill.id,
    description: skill.description,
    references: skill.references?.map(({ name, description }) => ({ name, description })),
  }));
  return worldStateSection({
    id: 'skills',
    codec: skillSummaries,
    read: () => (summaries.length === 0 ? withdrawn : summaries),
    baseline: (current) => `${renderSkills(current)}\n\n${SKILL_HOW_TO}${referencesTold(current)}`,
    update: (_previous, current) =>
      `The available skills have changed. This list supersedes the previous one.\n\n${renderSkills(current)}${referencesTold(current)}`,
    removed: () => 'The previous skill catalog and its loading instructions are withdrawn.',
  });
}

export function instructionFilesSection(
  contextFiles: readonly { readonly path: string; readonly body: string }[],
): PackedWorldStateSection {
  const files = contextFiles.map((file) => ({
    path: file.path,
    body: file.body,
  }));
  return worldStateSection({
    id: 'instructions',
    codec: instructionFiles,
    read: () => (files.length === 0 ? withdrawn : files),
    baseline: (current) => renderFiles(current),
    update: (_previous, current) => `These instructions replace all previously provided project instructions.\n\n${renderFiles(current)}`,
    removed: () => 'The previously provided project instructions no longer apply.',
  });
}

const referencesTold = (current: readonly SkillSummary[]): string =>
  current.some((skill) => (skill.references?.length ?? 0) > 0) ? `\n\n${SKILL_REFERENCE_INSTRUCTIONS}` : '';

function renderSkills(current: readonly SkillSummary[]): string {
  return ['Skills available in this project:', ...current.map(agentSkillLine)].join('\n');
}

function renderFiles(current: readonly { path: string; body: string }[]): string {
  return current.map((file) => `Instructions from ${file.path}, as this repository carries them:\n\n${file.body}`).join('\n\n');
}
