import { Schema } from 'effect';

export const SERVES_FROM = ['files', 'rows'] as const;
export type ServesFrom = (typeof SERVES_FROM)[number];

export const CHECKOUT_DIRECTORY = '.tagma';
export const GRAPH_COMMIT_PREFIX = 'tagma: graph @ ';
export const GRAPH_COMMIT_PATTERN = `^${GRAPH_COMMIT_PREFIX}[0-9]+( \\(.*\\))?$`;
export const WORKFLOWS_DIRECTORY = 'workflows';

export const inGraphTree = (path: string): boolean =>
  path.startsWith(`${CHECKOUT_DIRECTORY}/`) && !path.startsWith(`${CHECKOUT_DIRECTORY}/${WORKFLOWS_DIRECTORY}/`);

export const FORMAT_FILE = 'format.json';
export const VOCABULARY_FORMAT_KEY = 'vocabulary-format';

export const formatMarkerSchema = Schema.Struct({
  step: Schema.optional(Schema.NonEmptyString),
});
export type FormatMarker = typeof formatMarkerSchema.Type;

export const PROJECT_SETTINGS = ['strictProvenance', 'private'] as const;
export type ProjectSetting = (typeof PROJECT_SETTINGS)[number];

export const TREE_ORIGINS = 'tagma-checkouts';
export const TREE_SERVED = 'tagma-served';
export const TREE_MERGES = 'tagma-merges';
export const TREE_RETIRED = 'tagma-retired';

export const MIRROR_IDENTITY = 'mirror-identity';
export const mirrorIdentitySchema = Schema.Struct({
  projectId: Schema.Int,
  treeRoot: Schema.NonEmptyString,
  checkout: Schema.NonEmptyString,
  mode: Schema.Literals(['team', 'stealth']),
  branch: Schema.NullOr(Schema.NonEmptyString),
  gitDir: Schema.NullOr(Schema.NonEmptyString),
});
export type MirrorIdentity = typeof mirrorIdentitySchema.Type;

export function blocksRetiredKey(projectId: number): string {
  return `blocks-retired:${projectId}`;
}

export function rowsStepKey(projectId: number): string {
  return `rows-step:${projectId}`;
}

export function vocabularyRevisionKey(projectId: number): string {
  return `vocabulary-revision:${projectId}`;
}

export function phaseWordsKey(projectId: number): string {
  return `phase-words:${projectId}`;
}
