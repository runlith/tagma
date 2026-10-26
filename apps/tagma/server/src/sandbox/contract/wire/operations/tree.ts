import { Schema } from 'effect';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { PREPARED_TREE_STATES, PreparationNetwork, PreparedTreeSource, ReadinessAnswer } from '../preparedTree.js';
import { GuestLimits } from '../sandbox.js';
import { optionalFields } from './fields.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const PREPARED_TREE_READING = {
  preparedTree: Schema.String,
  state: Schema.Literals(PREPARED_TREE_STATES),
  source: Schema.NullOr(PreparedTreeSource),
  image: Schema.NullOr(Schema.String),
  platform: Schema.NullOr(Schema.String),
  network: Schema.NullOr(PreparationNetwork),
  setup: Schema.NullOr(Schema.Array(Schema.Array(Schema.String))),
  readiness: Schema.NullOr(Schema.Array(ReadinessAnswer)),
  exclusions: Schema.NullOr(Schema.Array(Schema.String)),
  dependencies: Schema.NullOr(Schema.Array(Schema.String)),
  dependencyDigest: Schema.NullOr(Schema.String),
  snapshotDigest: Schema.NullOr(Schema.String),
  archiveDigest: Schema.NullOr(Schema.String),
  archiveBytes: Schema.NullOr(Schema.Int),
  limits: Schema.NullOr(GuestLimits),
  resourcesReleased: Schema.Boolean,
  cleanupReason: Schema.NullOr(Schema.String),
  failureReason: Schema.NullOr(Schema.String),
  builtAt: Schema.NullOr(Schema.String),
};

export const TREE_OPERATIONS = {
  build_prepared_tree: operation('build_prepared_tree', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'sandbox' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ built: PREPARED_TREE_READING }),
    meaning:
      'Build an immutable prepared tree: dependencies installed in an isolated builder, sealed with their provenance, and reusable as an offline sandbox seed.',
    grammar:
      'The builder reaches ONLY the destinations `network` names, through a proxy on a private network — a setup command never grants itself one. The grant ends before the tree is sealed, and `readiness` runs offline in a copy of the sealed bytes. Reuse names the id this answers with; nothing is matched by a digest. May take many minutes.',
    input: Schema.Struct({
      commit: Schema.optional(
        Schema.String.annotate({
          description: 'The commit the tree is built from — a sha, a prefix, a branch, HEAD. Omitted: HEAD as it stands now.',
        }),
      ),
      empty: Schema.optional(Schema.Boolean.annotate({ description: 'Build on a tree with no source at all.' })),
      exclude: Schema.optional(
        Schema.Array(Schema.String).annotate({
          description: 'Paths the source leaves out, relative to the root; omitted, the graph directory alone.',
        }),
      ),
      setup: Schema.optional(
        Schema.Array(Schema.Array(Schema.String)).annotate({
          description: 'Commands run in the builder as argv, in order; one that fails fails the build.',
        }),
      ),
      readiness: Schema.optional(
        Schema.Array(Schema.Array(Schema.String)).annotate({
          description: 'Argv commands proving the sealed tree in an OFFLINE copy; one that fails publishes nothing.',
        }),
      ),
      dependencies: Schema.optional(
        Schema.Array(Schema.String).annotate({
          description: 'Paths inside the built tree whose digests are recorded as input evidence.',
        }),
      ),
      network: Schema.optional(
        Schema.Array(Schema.String.check(Schema.isMinLength(1))).annotate({
          description: 'Exact HTTPS hosts the build may reach, e.g. registry.npmjs.org. Omitted: no network at all.',
        }),
      ),
      image: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          description: 'The target image, which must ship this harness’s guest helper. Omitted: this installation’s own.',
        }),
      ),
      platform: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          description: 'The platform the target must be, e.g. linux/arm64. A different one refuses.',
        }),
      ),
      limits: Schema.optional(GuestLimits.annotate({ description: 'Ceilings of the builder: process count, memory (`2g`), cpus (`2`).' })),
    }),
    refusals: ['prepared-tree-unavailable', 'selection-shape', 'unknown-project'],
    confirmation: (input: {
      readonly commit?: string | undefined;
      readonly empty?: boolean | undefined;
      readonly setup?: readonly (readonly string[])[] | undefined;
      readonly readiness?: readonly (readonly string[])[] | undefined;
      readonly network?: readonly string[] | undefined;
      readonly image?: string | undefined;
    }) => ({
      summary: `Build a prepared tree at ${input.empty ? 'an empty source' : (input.commit ?? 'HEAD')}?`,
    }),
    confirmLabel: 'Build',
    presentation: {
      running: 'Building a prepared tree',
      done: 'Built a prepared tree',
    },
    subjects: () => [],
  }),
  read_prepared_tree: operation('read_prepared_tree', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'sandbox' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: { ...optionalFields(PREPARED_TREE_READING), preparedTrees: Schema.optional(Schema.Array(Schema.Struct(PREPARED_TREE_READING))) },
    }),
    meaning: 'Read a prepared tree’s provenance, state, failure and sealed output identity. Omit id to list this project’s trees.',
    grammar: 'A read starts no build and copies nothing; it answers what a build recorded.',
    input: Schema.Struct({
      id: Schema.optional(Schema.String.annotate({ description: 'The prepared tree, as its build answered it.' })),
    }),
    refusals: ['not-found', 'prepared-tree-unavailable', 'unknown-project'],
    confirmation: (input: { readonly id?: string | undefined }) => ({
      summary: input.id === undefined ? 'Read this project’s prepared trees?' : `Read prepared tree ${input.id}?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a prepared tree',
      done: 'Read a prepared tree',
      many: (count) => `Read ${count} prepared trees`,
    },
    subjects: () => [],
  }),
  release_prepared_tree: operation('release_prepared_tree', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'sandbox' },
    callers: 'any',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ released: PREPARED_TREE_READING }),
    meaning: 'Remove a prepared tree: its sealed archive and every build resource it still holds.',
    grammar:
      'Sandboxes already copied from it are untouched — they own their own trees. A copy being seeded right now keeps its input: the release records its intent, refuses, and finishes when that copy is done.',
    input: Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The prepared tree to release.' }),
    }),
    refusals: ['not-found', 'prepared-tree-busy', 'prepared-tree-unavailable', 'unknown-project'],
    confirmation: (input: { readonly id: string }) => ({
      summary: `Release prepared tree ${input.id}? Its sealed archive and build resources are removed.`,
    }),
    confirmLabel: 'Release',
    presentation: {
      running: 'Releasing a prepared tree',
      done: 'Released a prepared tree',
    },
    subjects: () => [],
  }),
};
