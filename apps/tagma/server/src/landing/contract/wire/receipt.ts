import { Schema } from 'effect';
import { LandingUnjudged, RuleBodies, RuleCrossing, Watched } from '../../../enforcement/contract/wire/enforcement.js';
import { copyFailureSchema } from '../../../graph/contract/wire/answers.js';

const GraphMerge = Schema.Struct({
  branch: Schema.NonEmptyString,
  merged: Schema.NullOr(Schema.NonEmptyString),
  conflicts: Schema.Array(Schema.NonEmptyString),
});

export const GraphSync = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('synced'),
    merges: Schema.Array(GraphMerge),
    copyFailures: Schema.optional(Schema.Array(copyFailureSchema)),
  }),
  Schema.Struct({ status: Schema.Literal('carried') }),
  Schema.Struct({ status: Schema.Literal('unread'), reason: Schema.String }),
]);
export type GraphSync = typeof GraphSync.Type;

export type SubmitCarry = { readonly path: string; readonly holders: readonly string[] };

type LandedTask = { readonly name: string; readonly title: string };

const LEFT_REASONS = ['paths', 'written'] as const;

type LeftPath = { readonly path: string; readonly reason: (typeof LEFT_REASONS)[number] };

export const UNRECORDED_STEPS = ['receipt', 'stamp', 'discharge', 'reshape', 'tasks'] as const;

export type Unrecorded = { readonly step: (typeof UNRECORDED_STEPS)[number]; readonly reason: string };

export const HOOK_KEPT = ['conflict', 'moved', 'unreadable', 'link'] as const;

export const HookKept = Schema.Struct({
  path: Schema.String,
  why: Schema.Literals(HOOK_KEPT).annotate({
    description:
      'conflict: the working file moved where the hook edited it; moved: it changed while the edit was written; unreadable: binary or unreadable; link: a symlink or submodule. The working file stands as it was.',
  }),
});
export type HookKept = typeof HookKept.Type;

export type HookEdits = {
  readonly edited: readonly string[];
  readonly kept: readonly HookKept[];
  readonly unrecorded: readonly string[];
  readonly owed: readonly string[];
};

export const HOOK_FIELDS = {
  edited: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "Files whose working text now carries what the commit steps and the hooks changed; what the commit lacks of the hooks' edits stands as the caller's uncommitted work.",
    }),
  ),
  kept: Schema.optional(
    Schema.Array(HookKept).annotate({
      description: 'Files the commit steps or the hooks changed whose working files were left as they stood.',
    }),
  ),
  owed: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "Kept files the commit's form is still owed to: the change record writes the commit's text into each window of them once no session's lines stand there.",
    }),
  ),
};

export const FORMAT_SKIPPED = Schema.optional(
  Schema.Boolean.annotate({
    description:
      "True where the repository declares commit steps and this commit was made without them, on the operator's word (`withoutFormat`).",
  }),
);

export type SubmitReceipt =
  | {
      readonly status: 'landed';
      readonly checkout: string;
      readonly commit: string;
      readonly subject?: string;
      readonly committed: readonly string[];
      readonly carried: readonly SubmitCarry[];
      readonly tasks?: readonly LandedTask[];
      readonly unnamedTasks?: readonly string[];
      readonly left?: readonly LeftPath[];
      readonly unattributed?: readonly string[];
      readonly unsynced?: readonly string[];
      readonly unmatched?: readonly string[];
      readonly watched?: readonly Watched[];
      readonly rechecked?: readonly RuleCrossing[];
      readonly bodies?: RuleBodies;
      readonly unjudged?: readonly LandingUnjudged[];
      readonly unrecorded?: readonly Unrecorded[];
      readonly graph?: GraphSync;
      readonly edited?: readonly string[];
      readonly kept?: readonly HookKept[];
      readonly owed?: readonly string[];
      readonly formatSkipped?: boolean;
    }
  | {
      readonly status: 'nothing';
      readonly commits?: readonly string[];
      readonly unmatched?: readonly string[];
      readonly unrecorded?: readonly Unrecorded[];
      readonly edited?: readonly string[];
      readonly kept?: readonly HookKept[];
      readonly owed?: readonly string[];
    }
  | {
      readonly status: 'refused';
      readonly reason: string;
      readonly edited?: readonly string[];
      readonly kept?: readonly HookKept[];
      readonly owed?: readonly string[];
    };

const Unrecorded = Schema.Struct({ step: Schema.Literals(UNRECORDED_STEPS), reason: Schema.String });

const UNATTRIBUTED = Schema.optional(
  Schema.Array(Schema.String).annotate({
    description:
      'Files this commit carried whose working text holds lines no tool recorded — edits made outside Tagma or by a command whose writer is unproven; they landed with the file.',
  }),
);

export const SubmitReceipt: Schema.Codec<SubmitReceipt> = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('landed'),
    checkout: Schema.NonEmptyString.annotate({ description: 'The registered id of the checkout this commit landed in.' }),
    commit: Schema.NonEmptyString,
    subject: Schema.optional(Schema.String.annotate({ description: 'The subject line of the commit.' })),
    committed: Schema.Array(Schema.String).annotate({ description: 'Paths this commit changed.' }),
    carried: Schema.Array(Schema.Struct({ path: Schema.String, holders: Schema.Array(Schema.NonEmptyString) })).annotate({
      description: "Committed files holding other writers' lines, with those writers.",
    }),
    tasks: Schema.optional(
      Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })).annotate({
        description:
          'The tasks the caller declared this commit carries, whoever holds them; they ride in its Task trailers. The landing ends none: finish_block names this commit for each one it completes.',
      }),
    ),
    unnamedTasks: Schema.optional(Schema.Array(Schema.String)).annotate({
      description:
        'This session’s held tasks, not attributed to this commit because the caller omitted tasks. Explicit tasks: [] suppresses this reminder.',
    }),
    left: Schema.optional(
      Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.Literals(LEFT_REASONS) })).annotate({
        description:
          'Files this session and its finished children changed that still differ from HEAD after this commit: `paths` left them out, or they were written again after the landing read them.',
      }),
    ),
    unattributed: UNATTRIBUTED,
    unsynced: Schema.optional(Schema.Array(Schema.String)),
    unmatched: Schema.optional(Schema.Array(Schema.String)),
    watched: Schema.optional(Schema.Array(Watched)),
    rechecked: Schema.optional(Schema.Array(RuleCrossing)).annotate({
      description:
        'Violations outside debt across the whole reach of an enforced inspection whose description this commit changes; the description change does not itself block the commit.',
    }),
    bodies: Schema.optional(RuleBodies),
    unjudged: Schema.optional(Schema.Array(LandingUnjudged)),
    unrecorded: Schema.optional(Schema.Array(Unrecorded)),
    graph: Schema.optional(GraphSync).annotate({
      description:
        "Present when this commit concluded a merge: the checkout's graph took in the merged branches' graph twins. A merge with conflicts waits in read_graph_recovery; resolve_graph_conflict publishes its resolution.",
    }),
    formatSkipped: FORMAT_SKIPPED,
    ...HOOK_FIELDS,
  }),
  Schema.Struct({
    status: Schema.Literal('nothing'),
    commits: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: 'The commits that already carried the lines of this session and its finished children, newest first.',
      }),
    ),
    unmatched: Schema.optional(Schema.Array(Schema.String)),
    unrecorded: Schema.optional(Schema.Array(Unrecorded)),
    ...HOOK_FIELDS,
  }),
  Schema.Struct({ status: Schema.Literal('refused'), reason: Schema.String, ...HOOK_FIELDS }),
]);

export const hookFields = (
  edits: HookEdits,
): { readonly edited?: readonly string[]; readonly kept?: readonly HookKept[]; readonly owed?: readonly string[] } => ({
  edited: edits.edited.length === 0 ? undefined : edits.edited,
  kept: edits.kept.length === 0 ? undefined : edits.kept,
  owed: edits.owed.length === 0 ? undefined : edits.owed,
});
