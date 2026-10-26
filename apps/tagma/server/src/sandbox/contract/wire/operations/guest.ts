import { Schema } from 'effect';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { GuestLimits, SANDBOX_STATES, SandboxSource } from '../sandbox.js';
import { optionalFields } from './fields.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const SANDBOX_READING = {
  sandbox: Schema.String,
  state: Schema.Literals(SANDBOX_STATES),
  boundThreadId: Schema.NullOr(Schema.String),
  host: Schema.Struct({ kind: Schema.Literal('sandbox'), id: Schema.String }),
  source: Schema.NullOr(SandboxSource),
  image: Schema.NullOr(Schema.String),
  platform: Schema.NullOr(Schema.String),
  limits: Schema.NullOr(GuestLimits),
  exclusions: Schema.NullOr(Schema.Array(Schema.String)),
  failureReason: Schema.NullOr(Schema.String),
  exportPath: Schema.NullOr(Schema.String),
  preparedAt: Schema.NullOr(Schema.String),
};

const IMPORTED = {
  path: Schema.String,
  created: Schema.Boolean,
  digest: Schema.String,
  lines: Schema.Int,
  from: Schema.String,
  comments: Schema.String,
  recorded: Schema.Boolean,
};

export const GUEST_OPERATIONS = {
  prepare_sandbox: operation('prepare_sandbox', {
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
    answer: arms({ prepared: SANDBOX_READING }),
    meaning:
      'Prepare an isolated guest from one project commit or one prepared tree, without host-file, network or graph access. Returns a host binding usable by any agent.',
    grammar:
      'Pass the returned `host: {kind, id}` to a spawn or new thread. Copies the tree and runs setup; may take minutes. The graph directory is excluded by default; `exclude` replaces that list. `empty` creates a guest without a checkout. `preparedTree` seeds the guest from an immutable artifact and admits no other source or recipe input: the artifact decides the bytes, the image and the platform.',
    input: Schema.Struct({
      commit: Schema.optional(
        Schema.String.annotate({
          description: 'The commit the tree is taken from — a sha, a prefix, a branch, HEAD. Omitted: HEAD as it stands now.',
        }),
      ),
      empty: Schema.optional(Schema.Boolean.annotate({ description: 'A guest with no tree at all.' })),
      preparedTree: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          description:
            'A ready prepared tree to copy, as `build_prepared_tree` answered it. Excludes commit, empty, exclude, setup and target.',
        }),
      ),
      exclude: Schema.optional(
        Schema.Array(Schema.String).annotate({
          description: 'Paths the snapshot leaves out, relative to the root; omitted, the graph directory alone.',
        }),
      ),
      setup: Schema.optional(
        Schema.Array(Schema.Array(Schema.String)).annotate({
          description: 'Commands run inside the guest as argv; one that fails fails the preparation.',
        }),
      ),
      dependencies: Schema.optional(
        Schema.Array(Schema.String).annotate({
          description: 'Paths inside the guest whose digests are recorded as input evidence.',
        }),
      ),
      limits: Schema.optional(GuestLimits.annotate({ description: 'Ceilings of the guest: process count, memory (`2g`), cpus (`2`).' })),
    }),
    refusals: ['sandbox-unavailable', 'prepared-tree-unavailable', 'selection-shape', 'unknown-project'],
    confirmation: (input: {
      readonly commit?: string | undefined;
      readonly empty?: boolean | undefined;
      readonly preparedTree?: string | undefined;
    }) => ({
      summary:
        input.preparedTree !== undefined
          ? `Prepare a sandbox from prepared tree ${input.preparedTree}?`
          : input.empty
            ? 'Prepare an empty sandbox?'
            : `Prepare a sandbox at ${input.commit ?? 'HEAD'}?`,
    }),
    confirmLabel: 'Prepare',
    presentation: {
      running: 'Preparing a sandbox',
      done: 'Prepared a sandbox',
    },
    subjects: () => [],
  }),
  import_output: operation('import_output', {
    approval: ASKS_IN_REVIEW,
    doors: { http: true },
    tool: { capability: 'sandbox', needs: ['shared'] },
    callers: 'thread',
    subject: 'none',
    place: 'machine',
    waits: [],
    lifetimes: ['workspace'],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ imported: IMPORTED }),
    meaning:
      'Import one file a workload produced in a sandbox into this checkout, against the destination’s expected base, as an ordinary recorded write.',
    grammar:
      'A guest is where the workload is the only writer, so what it left there is attributable; the bytes land through the same door `write` uses, and the change record carries the text replaced and the text written — nothing is promoted and no commit learns a new trick. `expect` is `absent`, or the destination’s digest as a refusal or an earlier import answered it: a destination that moved since it was read refuses and names what stands there now, and a path carrying another session’s uncommitted work refuses and names them, whether or not that session is over. The guest is SEALED before a byte is read — stopped, then exported to host bytes — so a sandbox a thread is bound to refuses rather than being stopped under it, and the sandbox is held for the read so nothing releases it mid-act.',
    input: Schema.Struct({
      sandbox: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The sandbox the file was produced in, as its preparation answered it.',
      }),
      from: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The path inside the guest’s tree, relative to its root.',
      }),
      to: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'Where the bytes land in this checkout.',
      }),
      expect: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'What the destination holds now: `absent`, or the digest this door answered for it.',
      }),
    }),
    refusals: ['expected-base', 'destination-path', 'import-source', 'sandbox-unavailable', 'no-record', 'not-found', 'unknown-project'],
    confirmation: (input: { readonly sandbox: string; readonly from: string; readonly to: string; readonly expect: string }) => ({
      summary: `Import ${input.from} from sandbox ${input.sandbox} to ${input.to}?`,
      facts: [{ label: 'Expected base', value: input.expect }],
    }),
    confirmLabel: 'Import',
    presentation: {
      running: 'Importing output',
      done: 'Imported output',
    },
    subjects: () => [],
  }),
  read_sandbox: operation('read_sandbox', {
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
    answer: arms({ ok: { ...optionalFields(SANDBOX_READING), sandboxes: Schema.optional(Schema.Array(Schema.Struct(SANDBOX_READING))) } }),
    meaning:
      'Read a sandbox’s state, holder, source and release export path. Omit id to list this project’s sandboxes with remaining guest or storage resources.',
    input: Schema.Struct({
      id: Schema.optional(Schema.String.annotate({ description: 'The sandbox, as its preparation answered it.' })),
    }),
    refusals: ['not-found', 'sandbox-unavailable', 'unknown-project'],
    confirmation: (input: { readonly id?: string | undefined }) => ({
      summary: input.id === undefined ? 'Read this project’s sandboxes?' : `Read sandbox ${input.id}?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a sandbox',
      done: 'Read a sandbox',
      many: (count) => `Read ${count} sandboxes`,
    },
    subjects: () => [],
  }),
  release_sandbox: operation('release_sandbox', {
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
    answer: arms({ released: { sandbox: Schema.String, path: Schema.String } }),
    meaning: 'Export an unheld sandbox to this machine, then remove its guest and storage. Returns the export path.',
    grammar: 'A sandbox bound to a thread refuses release until that thread is deleted.',
    input: Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The sandbox to release.' }),
    }),
    refusals: ['not-found', 'sandbox-busy', 'sandbox-unavailable', 'unknown-project'],
    confirmation: (input: { readonly id: string }) => ({
      summary: `Release sandbox ${input.id}? Its tree is exported, then the guest is removed.`,
    }),
    confirmLabel: 'Release',
    presentation: {
      running: 'Releasing a sandbox',
      done: 'Released a sandbox',
    },
    subjects: () => [],
  }),
};
