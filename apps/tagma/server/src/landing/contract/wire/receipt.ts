import { Schema } from 'effect';
import { CarriedViolation, LandingUnjudged, RuleBodies, RuleCrossing, Watched } from '../../../enforcement/contract/wire/enforcement.js';
import { type HolderStanding, holderStandingSchema } from '../../../graph/contract/wire/holders.js';

export type SubmitCarry = { readonly path: string; readonly holders: readonly string[] };

export const LANDED_BY = ['session', 'taking', 'carried'] as const;

export type LandedTask = {
  readonly name: string;
  readonly title: string;
  readonly holder: string;
  readonly by: (typeof LANDED_BY)[number];
  readonly standing?: HolderStanding;
};

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
      readonly left?: readonly string[];
      readonly unattributed?: readonly string[];
      readonly unsynced?: readonly string[];
      readonly unmatched?: readonly string[];
      readonly watched?: readonly Watched[];
      readonly carriedViolations?: readonly CarriedViolation[];
      readonly rechecked?: readonly RuleCrossing[];
      readonly bodies?: RuleBodies;
      readonly unjudged?: readonly LandingUnjudged[];
      readonly unrecorded?: readonly Unrecorded[];
      readonly edited?: readonly string[];
      readonly kept?: readonly HookKept[];
      readonly owed?: readonly string[];
      readonly formatSkipped?: boolean;
    }
  | {
      readonly status: 'nothing';
      readonly unattributed?: readonly string[];
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
      'Paths in this checkout that changed while a command of this session, or of a session it took, ran, and that no session’s record claims — another writer ran beside it, a restart cut its window, or its lines could not be written — and that still stand changed, left outside this commit. Overlap proves no author: read_changes names every session whose command met the change; name a path in `paths` and `whole` only when it is this session’s work.',
  }),
);

export const SubmitReceipt: Schema.Codec<SubmitReceipt> = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('landed'),
    checkout: Schema.NonEmptyString.annotate({ description: 'The registered id of the checkout this commit landed in.' }),
    commit: Schema.NonEmptyString,
    subject: Schema.optional(Schema.String.annotate({ description: 'The subject line of the commit.' })),
    committed: Schema.Array(Schema.String).annotate({ description: 'Paths whose lines this commit carried.' }),
    carried: Schema.Array(Schema.Struct({ path: Schema.String, holders: Schema.Array(Schema.NonEmptyString) })),
    tasks: Schema.optional(
      Schema.Array(
        Schema.Struct({
          name: Schema.String,
          title: Schema.String,
          holder: Schema.NonEmptyString,
          by: Schema.Literals(LANDED_BY),
          standing: Schema.optional(holderStandingSchema),
        }),
      ).annotate({
        description:
          'The tasks the caller declared this commit carries, held by this session or holders in taking. Each names its holder, how that holder’s lines came in and, where known, its standing. These tasks ride in its Task trailers; the landing ends none: finish_block names this commit for each one it completes.',
      }),
    ),
    unnamedTasks: Schema.optional(Schema.Array(Schema.String)).annotate({
      description:
        'This session’s held tasks, not attributed to this commit because the caller omitted tasks. Explicit tasks: [] suppresses this reminder.',
    }),
    left: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: 'Paths where lines of this session, or of a session it took, still stand uncommitted after this commit.',
      }),
    ),
    unattributed: UNATTRIBUTED,
    unsynced: Schema.optional(Schema.Array(Schema.String)),
    unmatched: Schema.optional(Schema.Array(Schema.String)),
    watched: Schema.optional(Schema.Array(Watched)),
    carriedViolations: Schema.optional(Schema.Array(CarriedViolation)),
    rechecked: Schema.optional(Schema.Array(RuleCrossing)).annotate({
      description:
        'Violations outside debt across the whole reach of an enforced inspection whose description this commit changes; the description change does not itself block the commit.',
    }),
    bodies: Schema.optional(RuleBodies),
    unjudged: Schema.optional(Schema.Array(LandingUnjudged)),
    unrecorded: Schema.optional(Schema.Array(Unrecorded)),
    formatSkipped: FORMAT_SKIPPED,
    ...HOOK_FIELDS,
  }),
  Schema.Struct({
    status: Schema.Literal('nothing'),
    unattributed: UNATTRIBUTED,
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
