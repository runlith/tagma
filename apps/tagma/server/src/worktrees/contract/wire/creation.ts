import * as Schema from 'effect/Schema';
import { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { ResourceAddress } from '@runlith/files/resource';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { RequestKey } from '../../../platform/contract/wire/ids.js';
import { RepositoryBinding } from '../../../workspace/contract/wire/repositories.js';
import { graphRemainderSchema } from '../../../graph/contract/wire/answers.js';

export const WorktreeRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('WorktreeRevision'));
export type WorktreeRevision = typeof WorktreeRevision.Type;

export const OPERATION_ID = RequestKey.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z0-9._-]+$/u),
  Schema.isPattern(/^(?!\.{1,2}$)/u),
).annotate({ description: 'Your own name for this creation, chosen before the call. The same name answers the same act.' });

const READ_REVISION = WorktreeRevision.annotate({
  description: 'The revision the operation stood at when you read it. A record that moved since refuses.',
});

const HEAD_REFS = 'refs/heads/';

export const WorktreeMode = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('new-branch'),
    branch: Schema.NonEmptyString,
    start: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('existing-branch'),
    branch: Schema.NonEmptyString,
  }),
  Schema.Struct({ kind: Schema.Literal('detached'), start: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('kind'));
export type WorktreeMode = typeof WorktreeMode.Type;

export const branchOf = (mode: WorktreeMode): string | null => (mode.kind === 'detached' ? null : mode.branch);

export const refOf = (mode: WorktreeMode): string | null => (mode.kind === 'detached' ? null : `${HEAD_REFS}${mode.branch}`);

export const startOf = (mode: WorktreeMode): string => (mode.kind === 'existing-branch' ? `${HEAD_REFS}${mode.branch}` : mode.start);

export const PROVISIONAL_NAME = 'thread';

export const branchSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .replace(/[-.]+$/, '');

export const namedBranch = (prefix: string, name: string): string => {
  const spelled = name.trim().replace(/\s+/g, '-');
  return spelled === '' || prefix === '' || spelled.startsWith(prefix) ? spelled : `${prefix}${spelled}`;
};

export const RenameRemote = Schema.Literals(['keep', 'move']);
export type RenameRemote = typeof RenameRemote.Type;

export const RenamedPullRequest = Schema.Struct({ number: Schema.Int, url: Schema.NonEmptyString });
export type RenamedPullRequest = typeof RenamedPullRequest.Type;

export const RenamedRemote = Schema.Union([
  Schema.Struct({ status: Schema.Literal('unpublished') }),
  Schema.Struct({
    status: Schema.Literal('moved'),
    remote: Schema.NonEmptyString,
    pullRequest: Schema.NullOr(
      Schema.Struct({ opened: RenamedPullRequest, closed: RenamedPullRequest, closing: Schema.NullOr(Schema.String) }),
    ),
    old: Schema.Struct({ deleted: Schema.Boolean, reason: Schema.NullOr(Schema.String) }),
  }),
  Schema.Struct({
    status: Schema.Literal('kept'),
    remote: Schema.NonEmptyString,
    branch: Schema.NonEmptyString,
    pullRequest: Schema.NullOr(RenamedPullRequest),
    reason: Schema.String,
  }),
]);
export type RenamedRemote = typeof RenamedRemote.Type;

export const WorktreeRenamed = Schema.Struct({
  rootId: RootId,
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  remote: RenamedRemote,
});
export type WorktreeRenamed = typeof WorktreeRenamed.Type;

export const WorktreeStatus = Schema.Literals(['pending', 'ready', 'failed', 'uncertain']);
export type WorktreeStatus = typeof WorktreeStatus.Type;

export const WorktreeEvidence = Schema.Struct({
  command: Schema.Array(Schema.String),
  ended: Schema.Literals(['exit', 'unstarted', 'lost', 'terminated']),
  status: Schema.NullOr(Schema.Int),
  message: Schema.String,
  overflow: Schema.Boolean,
  unproven: Schema.NullOr(Schema.String),
  destination: Schema.Literals(['absent', 'present', 'unreadable']),
  retained: Schema.NullOr(Schema.Array(Schema.Literals(['registration', 'ref', 'unreadable']))),
  graphLeft: Schema.optional(graphRemainderSchema),
});
export type WorktreeEvidence = typeof WorktreeEvidence.Type;

export const CREATION_FIELDS = {
  operationId: OPERATION_ID,
  repository: RepositoryBinding.annotate({
    description: 'The registered store, at the location revision you read. A store that moved since makes this stale.',
  }),
  destination: Schema.NonEmptyString.annotate({
    description: 'Absolute path the checkout will stand at. It must not exist; its parent must.',
  }),
  mode: WorktreeMode.annotate({
    description:
      'What the checkout stands on, stated explicitly: a branch created here, a branch that already exists, or an object on no branch.',
  }),
} as const;

export const PREPARATION_FIELDS = {
  ...CREATION_FIELDS,
  destination: Schema.optional(
    Schema.NonEmptyString.annotate({
      description:
        "Absolute path the checkout will stand at. It must not exist; its parent must. Omitted: a folder named for the branch — or for the operation on no branch — inside this project's worktree folder, which is made if it is missing.",
    }),
  ),
} as const;

export const WorktreeRequest = Schema.Struct({
  ...CREATION_FIELDS,
  projectId: Schema.Int,
});
export type WorktreeRequest = typeof WorktreeRequest.Type;

export const WorktreeIntent = Schema.Struct({
  ...WorktreeRequest.fields,
  namespaceId: NamespaceId,
  base: Schema.NonEmptyString,
  payloadDigest: Schema.NonEmptyString,
  status: WorktreeStatus,
  reserved: Schema.Boolean,
  producer: Schema.NullOr(Schema.NonEmptyString),
  rootId: Schema.NullOr(RootId),
  evidence: Schema.NullOr(WorktreeEvidence),
  abandonment: Schema.NullOr(Schema.String),
  revision: WorktreeRevision,
});
export type WorktreeIntent = typeof WorktreeIntent.Type;

export const WorktreeSubjects = Schema.Struct({
  namespaceId: NamespaceId,
  repository: RepositoryBinding,
  destination: ResourceAddress,
  ref: Schema.NullOr(Schema.NonEmptyString),
});
export type WorktreeSubjects = typeof WorktreeSubjects.Type;

export const WorktreePreparation = Schema.Struct({
  subjects: WorktreeSubjects,
  operation: WorktreeIntent,
});
export type WorktreePreparation = typeof WorktreePreparation.Type;

export const ObservedCheckout = Schema.Struct({
  path: Schema.NonEmptyString.annotate(placeRole('value')),
  witness: IdentityWitness,
  gitDirectory: Schema.NonEmptyString,
});
export type ObservedCheckout = typeof ObservedCheckout.Type;

export const RESOLUTION_FIELDS = {
  operationId: OPERATION_ID,
  observed: Schema.NonEmptyString.annotate({
    description: 'Absolute path of the checkout you observed.',
  }),
} as const;

export const ADOPTION_FIELDS = {
  operationId: OPERATION_ID,
  revision: READ_REVISION,
  observed: ObservedCheckout.annotate({
    description: 'The target as the recovery resolution answered it, identity included — not a path to look at again.',
  }),
} as const;

export const RELEASE_FIELDS = {
  operationId: OPERATION_ID,
  revision: READ_REVISION,
  reason: Schema.NonEmptyString.annotate({
    description: 'What you read that made this act finished with.',
  }),
} as const;

export const WorktreeRecoveryPreparation = Schema.Struct({
  subjects: WorktreeSubjects,
  observed: ObservedCheckout,
  operation: WorktreeIntent,
});
export type WorktreeRecoveryPreparation = typeof WorktreeRecoveryPreparation.Type;

export const WorktreeRecovery = Schema.Struct({ ...ADOPTION_FIELDS, projectId: Schema.Int });
export type WorktreeRecovery = typeof WorktreeRecovery.Type;
