import { createHash } from 'node:crypto';
import { Array as Arr, Effect, Schema, SchemaGetter, SchemaIssue } from 'effect';

const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)).pipe(Schema.brand('Digest'));

const ROLES_0_2 = ['runtime', 'cli', 'server', 'migrations', 'surface', 'executions'] as const;
const STORES_0_2 = ['machine-store', 'host-store', 'graph', 'journal'] as const;
const RELEASE_NUMBER_0_2 = /^\d+(\.\d+){0,2}$/u;

const change0_2 = Schema.Struct({ store: Schema.Literals(STORES_0_2), release: Schema.NonEmptyString });

const part0_2 = Schema.Struct({
  role: Schema.Literals(ROLES_0_2),
  path: Schema.NonEmptyString,
  kind: Schema.Literals(['file', 'link']),
  bytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  digest: Digest,
});

const manifest0_2 = Schema.Struct({
  version: Schema.Literal(1),
  identity: Schema.Struct({ digest: Digest, build: Schema.NonEmptyString, tree: Schema.optional(Schema.NonEmptyString) }),
  platform: Schema.Struct({ os: Schema.NonEmptyString, arch: Schema.NonEmptyString }),
  origin: Schema.optional(Schema.Struct({ checkout: Schema.NonEmptyString })),
  irreversible: Schema.optional(Schema.Array(change0_2)),
  parts: Schema.Array(part0_2).check(Schema.isMinLength(1)),
});

const insideClosure0_2 = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith('/') &&
  ![...path].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f) &&
  path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

type Closure = {
  readonly identity: { readonly digest: string };
  readonly platform: { readonly os: string; readonly arch: string };
  readonly parts: ReadonlyArray<{ readonly role: string; readonly kind: string; readonly digest: string; readonly path: string }>;
};

const identity0_2 = (manifest: Pick<Closure, 'platform' | 'parts'>): string => {
  const input = [
    `platform ${manifest.platform.os} ${manifest.platform.arch}`,
    ...manifest.parts.map((part) => `part ${part.role} ${part.kind} ${part.digest} ${part.path}`).sort(),
  ].join('\n');
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
};

const closureIssue0_2 = (manifest: Closure): string | undefined => {
  const seen = new Set<string>();
  const roles = new Set<string>();
  for (const part of manifest.parts) {
    if (!insideClosure0_2(part.path)) return `the part ${part.path} is named outside the closure`;
    if (seen.has(part.path)) return `the part ${part.path} is named twice`;
    seen.add(part.path);
    roles.add(part.role);
  }
  const missing = ROLES_0_2.find((role) => !roles.has(role));
  if (missing !== undefined) return `the closure names no ${missing}`;
  const produced = identity0_2(manifest);
  return produced === manifest.identity.digest
    ? undefined
    : `the manifest declares ${manifest.identity.digest} and its contents produce ${produced}`;
};

const attempt0_2 = Schema.Struct({
  from: Schema.NullOr(Schema.String),
  to: Schema.String,
  starts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  copied: Schema.Boolean,
  ended: Schema.NullOr(
    Schema.Struct({
      detail: Schema.String,
      data: Schema.Literals(['untouched', 'restored', 'unrestored', 'kept']),
      words: Schema.optional(
        Schema.Struct({ text: Schema.String, settings: Schema.optional(Schema.Literals(['microphone', 'system-audio', 'accessibility'])) }),
      ),
      left: Schema.optional(Schema.String),
    }),
  ),
});

const returned0_2 = Schema.Struct({ left: Schema.String, to: Schema.String });

const door0_2 = Schema.Literals(['local', 'remote']);
const cut0_2 = Schema.Struct({ build: Schema.String, digest: Schema.String });
const process0_2 = Schema.Struct({
  pid: Schema.Int,
  source: Schema.Struct({
    cut: Schema.NullOr(
      Schema.Struct({
        startedAt: Schema.String,
        revision: Schema.NullOr(Schema.Struct({ head: Schema.String, dirty: Schema.Boolean })),
      }),
    ),
    installation: Schema.NullOr(cut0_2),
  }),
});

const restart0_2 = Schema.Struct({
  id: Schema.String,
  heavy: Schema.optional(
    Schema.Struct({
      migrations: Schema.Array(Schema.Struct({ name: Schema.String, reason: Schema.String })),
      tables: Schema.Array(Schema.Struct({ name: Schema.String, maxRowid: Schema.NullOr(Schema.Finite), snapshot: Schema.Boolean })),
      files: Schema.Array(
        Schema.Struct({ owner: Schema.String, bytes: Schema.NullOr(Schema.Finite), hashPasses: Schema.NullOr(Schema.Finite) }),
      ),
    }),
  ),
  startup: Schema.NullOr(
    Schema.Struct({
      pid: Schema.Int,
      startedAt: Schema.Finite,
      readyAt: Schema.NullOr(Schema.Finite),
      expectedMs: Schema.NullOr(Schema.Finite),
      step: Schema.NullOr(Schema.Struct({ name: Schema.String, index: Schema.Int, total: Schema.Int })),
    }),
  ),
  predecessor: Schema.NullOr(process0_2),
  successor: Schema.NullOr(process0_2),
  phases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      pid: Schema.Int,
      startedAt: Schema.Finite,
      endedAt: Schema.NullOr(Schema.Finite),
      durationMs: Schema.NullOr(Schema.Finite),
      outcome: Schema.NullOr(Schema.Literals(['completed', 'failed', 'interrupted'])),
    }),
  ),
  points: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      at: Schema.Finite,
      pid: Schema.Int,
      door: Schema.NullOr(door0_2),
      migrations: Schema.NullOr(Schema.Int),
    }),
  ),
  frames: Schema.Array(
    Schema.Struct({
      door: door0_2,
      projectId: Schema.Int,
      threadId: Schema.String,
      at: Schema.Finite,
      intervalMs: Schema.NullOr(Schema.Finite),
    }),
  ),
  windows: Schema.Array(
    Schema.Struct({
      restartId: Schema.String,
      clientId: Schema.String,
      door: door0_2,
      projectId: Schema.Int,
      threadId: Schema.String,
      durationMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
      receivedAt: Schema.Finite,
      exceeded: Schema.Boolean,
    }),
  ),
  failure: Schema.NullOr(Schema.Struct({ at: Schema.Finite, pid: Schema.Int, detail: Schema.String })),
  hostEnded: Schema.optionalKey(Schema.Struct({ at: Schema.Finite, executions: Schema.NullOr(Schema.Int), detail: Schema.String })),
  unreleased: Schema.optionalKey(Schema.Struct({ at: Schema.Finite, detail: Schema.String })),
});

const release0_2 = Schema.Struct({
  release: Schema.String.check(Schema.isPattern(RELEASE_NUMBER_0_2)),
  platforms: Schema.Record(
    Schema.String,
    Schema.Struct({
      archive: Schema.NonEmptyString,
      sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
      size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  irreversible: Schema.Boolean,
  stores: Schema.Struct({
    'machine-store': Schema.Array(Schema.String),
    'host-store': Schema.Array(Schema.String),
    graph: Schema.Array(Schema.String),
    journal: Schema.Array(Schema.String),
  }),
  changes: Schema.Array(change0_2),
});

const feed0_2 = Schema.Struct({ releases: Schema.NonEmptyArray(release0_2) });

const byteCount0_2 = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const installing0_2 = Schema.Struct({
  offer: Schema.String,
  title: Schema.String,
  target: Schema.String,
  since: Schema.String,
  log: Schema.String,
  then: Schema.NullOr(Schema.Literals(['restart'])),
  steps: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, weight: Schema.Number })),
  step: Schema.String,
  progress: Schema.NullOr(Schema.Struct({ done: byteCount0_2, total: Schema.NullOr(byteCount0_2) })),
  tail: Schema.NullOr(Schema.String),
  usually: Schema.NullOr(Schema.Number),
});

const installed0_2 = Schema.Struct({
  offer: Schema.String,
  title: Schema.String,
  target: Schema.String,
  outcome: Schema.Literals(['landed', 'failed', 'stopped']),
  build: Schema.NullOr(Schema.String),
  detail: Schema.String,
  endedAt: Schema.String,
  log: Schema.String,
  since: Schema.NullOr(Schema.String),
  tail: Schema.Array(Schema.String),
  then: Schema.NullOr(Schema.Literals(['restart'])),
  restartRefused: Schema.NullOr(Schema.String),
});

const update0_2 = Schema.Struct({
  feed: Schema.NullOr(feed0_2),
  installing: Schema.NullOr(installing0_2),
  installed: Schema.NullOr(installed0_2),
  took: Schema.NullOr(Schema.Number),
});

const member0_2 = Schema.Struct({ projectId: Schema.Number, groupId: Schema.Number, ord: Schema.Number });

const setting0_2 = Schema.Struct({
  id: Schema.Number,
  scope: Schema.Literals(['user', 'project']),
  key: Schema.String,
  projectId: Schema.NullOr(Schema.Number),
  value: Schema.NullOr(Schema.String),
  declined: Schema.optional(Schema.Boolean),
  updatedAt: Schema.String,
});

const registry0_2 = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      repoKey: Schema.String,
      rootPath: Schema.String,
      storage: Schema.Literals(['stealth', 'team', 'plain']),
      createdAt: Schema.String,
      strictProvenance: Schema.optional(Schema.Boolean),
      private: Schema.optional(Schema.Boolean),
      kind: Schema.optional(Schema.Literals(['folder', 'global', 'group'])),
      global: Schema.optional(Schema.Boolean),
      removedAt: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  members: Schema.optional(Schema.Array(member0_2)),
  settings: Schema.Array(setting0_2),
});

const changeNext = Schema.Struct({ store: Schema.String, release: Schema.NonEmptyString });

const manifestNext = Schema.Struct({
  ...manifest0_2.fields,
  origin: Schema.optional(Schema.Struct({ checkout: Schema.NonEmptyString, inputs: Schema.optional(Schema.Array(Schema.String)) })),
  irreversible: Schema.optional(Schema.Array(changeNext)),
  parts: Schema.Array(Schema.Struct({ ...part0_2.fields, role: Schema.String })).check(Schema.isMinLength(1)),
});

const processNext = Schema.Struct({ ...process0_2.fields, birth: Schema.optional(Schema.String) });

const restartNext = Schema.Struct({ ...restart0_2.fields, predecessor: Schema.NullOr(processNext), successor: Schema.NullOr(processNext) });

const releaseNext = Schema.Struct({ ...release0_2.fields, changes: Schema.Array(changeNext) });
const readableNext = Schema.is(releaseNext);

const feedNext = Schema.Struct({ releases: Schema.Array(Schema.Unknown) }).pipe(
  Schema.decodeTo(Schema.Struct({ releases: Schema.NonEmptyArray(releaseNext) }), {
    decode: SchemaGetter.transformEffect(({ releases }) => {
      const read = releases.filter(readableNext);
      return Arr.isReadonlyArrayNonEmpty(read)
        ? Effect.succeed({ releases: read })
        : Effect.fail(new SchemaIssue.InvalidValue({ message: 'no release reads' }, releases));
    }),
    encode: SchemaGetter.transform((feed) => feed),
  }),
);

const refusalNext = Schema.Struct({
  code: Schema.String,
  reason: Schema.String,
  unblock: Schema.Array(Schema.String),
  thread: Schema.optional(Schema.Struct({ projectId: Schema.Int, threadId: Schema.String })),
});

const placementNext = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('landed'),
    version: Schema.String,
    root: Schema.String,
    build: Schema.String,
    previous: Schema.NullOr(Schema.String),
    application: Schema.String,
    launcher: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal('held'),
    version: Schema.String,
    root: Schema.String,
    build: Schema.String,
    standing: Schema.NullOr(Schema.String),
    detail: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal('ask'),
    reason: Schema.Literals(['stepped-back', 'irreversible', 'failed']),
    said: Schema.String,
  }),
]);

const updateNext = Schema.Struct({
  ...update0_2.fields,
  feed: Schema.NullOr(feedNext),
  installed: Schema.NullOr(
    Schema.Struct({
      ...installed0_2.fields,
      refused: Schema.optional(refusalNext),
      placement: Schema.optional(placementNext),
    }),
  ),
  placement: Schema.optional(placementNext),
});

const registryNext = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      repoKey: Schema.String,
      rootPath: Schema.String,
      createdAt: Schema.String,
      kind: Schema.optional(Schema.Literals(['folder', 'global', 'group'])),
      global: Schema.optional(Schema.Boolean),
      removedAt: Schema.optional(Schema.NullOr(Schema.String)),
      strictProvenance: Schema.optional(Schema.Boolean),
      private: Schema.optional(Schema.Boolean),
      storage: Schema.Literals(['stealth', 'team', 'plain']),
    }),
  ),
  members: Schema.optional(Schema.Array(member0_2)),
  settings: Schema.Array(setting0_2),
});

const stepBackNext = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  carried: Schema.Boolean,
  failed: Schema.optional(
    Schema.Struct({
      detail: Schema.String,
      words: Schema.optional(
        Schema.Struct({ text: Schema.String, settings: Schema.optional(Schema.Literals(['microphone', 'system-audio', 'accessibility'])) }),
      ),
    }),
  ),
});

export const NEXT = {
  issued: [],
  manifest: manifestNext,
  roles: ROLES_0_2,
  identity: identity0_2,
  closureIssue: closureIssue0_2,
  attempt: attempt0_2,
  returned: returned0_2,
  restart: restartNext,
  feed: feedNext,
  update: updateNext,
  registry: registryNext,
  stepBack: stepBackNext,
} as const;

export const FROZEN = [
  {
    issued: ['0.2.0', '0.2.1', '0.2.2'],
    manifest: manifest0_2,
    roles: ROLES_0_2,
    identity: identity0_2,
    closureIssue: closureIssue0_2,
    attempt: attempt0_2,
    returned: returned0_2,
    restart: restart0_2,
    feed: feed0_2,
    update: update0_2,
    registry: registry0_2,
  },
  NEXT,
] as const;
