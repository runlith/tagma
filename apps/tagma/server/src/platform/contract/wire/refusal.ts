import { errorChain } from '@runlith/utils/error';
import { walking } from '@runlith/paging';
import { Data, Schema } from 'effect';
import * as HttpApiSchema from 'effect/http-api/HttpApiSchema';
import { type Right, rightSchema } from './right.js';

export type Unblock = readonly [string, ...string[]];

export const SETTINGS_PAGES = ['microphone', 'system-audio', 'accessibility'] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export const wordsSchema = Schema.Struct({
  text: Schema.String,
  settings: Schema.optional(Schema.Literals(SETTINGS_PAGES)),
});
export type Words = typeof wordsSchema.Type;

export class GateRefusal<Code extends string = string> extends Data.TaggedError('GateRefusal')<{
  readonly code: string;
  readonly reason: string;
  readonly unblock: Unblock;
  readonly inputFile?: string;
  readonly words?: Words;
  readonly field?: string;
  readonly right?: Right;
}> {
  declare readonly code: Code;

  constructor(code: Code, reason: string, unblock: Unblock, inputFile?: string, words?: Words, field?: string, right?: Right) {
    super({ code, reason, unblock, inputFile, words, field, right });
  }

  saying(words: Words): GateRefusal<Code> {
    return new GateRefusal(this.code, this.reason, this.unblock, this.inputFile, words, this.field, this.right);
  }

  about(field: string): GateRefusal<Code> {
    return new GateRefusal(this.code, this.reason, this.unblock, this.inputFile, this.words, field, this.right);
  }

  lacking(right: Right): GateRefusal<Code> {
    return new GateRefusal(this.code, this.reason, this.unblock, this.inputFile, this.words, this.field, right);
  }

  override get message(): string {
    return `${this.code}: ${this.reason}`;
  }
}

export const cursorRefusal = (refused: 'bad-cursor' | 'cursor-stale'): GateRefusal<'bad-cursor' | 'cursor-stale'> =>
  refused === 'bad-cursor'
    ? new GateRefusal('bad-cursor', 'this cursor is not one this read minted', ['ask again with no cursor to open a new walk'])
    : new GateRefusal('cursor-stale', 'this cursor was minted under another narrowing', [
        'hand the cursor back to the exact call that answered it, unchanged',
        'ask again with no cursor to open a new walk',
      ]);

export const walks = walking(cursorRefusal);

export type ReferenceRefusal = 'bad-name' | 'ambiguous-name';

export const GIT_REFUSALS = ['git-refused', 'git-unreadable', 'git-incomplete', 'git-not-admitted'] as const;

export type GitRefusal = (typeof GIT_REFUSALS)[number];

export type CallerRefusal =
  | 'project-required'
  | 'unknown-project'
  | 'ambiguous-project'
  | 'place-mismatch'
  | 'instructions-unread'
  | 'thread-required'
  | 'session-unproven'
  | 'external-refused'
  | 'plugin-not-enabled'
  | 'world-unavailable'
  | 'files'
  | 'global-missing'
  | 'no-home'
  | 'graph-pool'
  | 'mirror-down'
  | 'no-checkout'
  | 'not-served'
  | 'duplicate-identity'
  | 'tree-missing'
  | 'tree-empty'
  | 'permission-denied'
  | 'bad-name'
  | 'ambiguous-name'
  | 'not-found'
  | 'deleted'
  | 'scope-outside-project'
  | 'operator-only'
  | 'approval-pending'
  | 'unanswered'
  | 'declined'
  | 'no-approver'
  | 'mode-unknown'
  | 'right-missing'
  | GitRefusal;

export type FloorRefusal =
  | 'tree-mid-merge'
  | 'graph-pool'
  | 'graph-unmerged'
  | 'project-retired'
  | 'vocabulary-newer'
  | 'vocabulary-older'
  | 'detached-checkout'
  | 'stealth-dependency'
  | 'stealth-supersede'
  | 'stealth-module';

export type CatalogRefusal =
  | 'unknown-catalog'
  | 'field-invalid'
  | 'layer-forbidden'
  | 'type-collision'
  | 'candidate-stale'
  | 'carriers-invalid';

export type OpenRefusal = CallerRefusal | FloorRefusal | CatalogRefusal | 'no-root';

export type FieldRefusal = ReferenceRefusal | OpenRefusal;

const FIELD_REFUSAL = {
  'bad-name': 'Unknown block name',
  'ambiguous-name': 'Name fits several blocks',
  'project-required': 'No project named',
  'unknown-project': 'Unknown project',
  'ambiguous-project': 'Project name fits several projects',
  'place-mismatch': 'Named places disagree',
  'instructions-unread': 'Instructions of the place not read yet',
  'thread-required': 'Only a thread can do this',
  'session-unproven': 'Session not recognized',
  'external-refused': 'Not open to external callers',
  'plugin-not-enabled': 'Plugin does not run here',
  'world-unavailable': 'Environment unavailable',
  files: 'Files could not be read',
  'global-missing': 'Shared graph missing',
  'no-home': 'Thread has no home project',
  'graph-pool': 'Graph busy',
  'mirror-down': 'Graph unavailable',
  'no-checkout': 'No checkout',
  'not-served': 'Not served here',
  'duplicate-identity': 'Same identity used twice',
  'tree-missing': 'Checkout folder missing',
  'tree-empty': 'Checkout is empty',
  'permission-denied': 'Permission denied',
  'not-found': 'Not found',
  deleted: 'Deleted',
  'scope-outside-project': 'Outside this project',
  'operator-only': 'Only you can do this',
  'approval-pending': 'Waiting for approval',
  unanswered: 'Approval went unanswered',
  declined: 'Declined',
  'no-approver': 'Nobody to approve it',
  'mode-unknown': 'Unknown approval mode',
  'right-missing': 'Not included in this access',
  'git-refused': 'Git refused',
  'git-unreadable': 'Git could not be read',
  'git-incomplete': 'Git answer incomplete',
  'git-not-admitted': 'Git not allowed here',
  'tree-mid-merge': 'Checkout is mid-merge',
  'detached-checkout': 'Checkout is detached',
  'graph-unmerged': 'Graph has an unfinished merge',
  'project-retired': 'Project removed',
  'vocabulary-newer': 'Graph is newer than this Tagma',
  'vocabulary-older': 'Graph needs an upgrade',
  'stealth-dependency': 'Team block would depend on a stealth one',
  'stealth-supersede': 'Stealth block cannot replace a team one',
  'stealth-module': 'A module card is never stealth',
  'unknown-catalog': 'Unknown catalog',
  'no-root': 'No root block',
  'field-invalid': 'Invalid field',
  'layer-forbidden': 'Layer not allowed',
  'type-collision': 'Type already declared',
  'candidate-stale': 'Changed meanwhile',
  'carriers-invalid': 'Invalid tag carriers',
} as const satisfies Record<FieldRefusal, string>;

export const isFieldRefusal = (code: string): code is FieldRefusal => Object.hasOwn(FIELD_REFUSAL, code);

export const OPEN_REFUSALS: readonly OpenRefusal[] = Object.keys(FIELD_REFUSAL) as OpenRefusal[];

export const PLATFORM_REFUSAL_WORDS: Readonly<Record<string, string>> = {
  ...FIELD_REFUSAL,
  'bad-cursor': 'Unknown page cursor',
  'cursor-stale': 'Page cursor out of date',
};

export type RefusalBody = {
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
  readonly words?: Words;
  readonly field?: string;
  readonly right?: Right;
  readonly causes?: ReadonlyArray<{ readonly tag: string; readonly message: string }>;
};

export function faultBody(text: string): RefusalBody | undefined {
  const parsed = ((): { code?: unknown; reason?: unknown; unblock?: unknown; words?: unknown; causes?: unknown } | undefined => {
    try {
      return JSON.parse(text) as { code?: unknown; reason?: unknown; unblock?: unknown; words?: unknown; causes?: unknown };
    } catch {
      return undefined;
    }
  })();
  if (typeof parsed?.code !== 'string' || typeof parsed.reason !== 'string') return undefined;
  const causes = Array.isArray(parsed.causes)
    ? parsed.causes.filter(
        (link): link is { readonly tag: string; readonly message: string } =>
          typeof link === 'object' &&
          link !== null &&
          typeof (link as { tag?: unknown }).tag === 'string' &&
          typeof (link as { message?: unknown }).message === 'string',
      )
    : [];
  return {
    code: parsed.code,
    reason: parsed.reason,
    unblock: Array.isArray(parsed.unblock) ? parsed.unblock.filter((way): way is string => typeof way === 'string') : [],
    words: Schema.is(wordsSchema)(parsed.words) ? parsed.words : undefined,
    causes,
  };
}

const refusalFields = {
  code: Schema.String,
  reason: Schema.String,
  unblock: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  inputFile: Schema.optional(Schema.String),
  words: Schema.optional(wordsSchema),
  field: Schema.optional(Schema.String).annotate({ description: 'The input entry this refusal is about, named by its id.' }),
  right: Schema.optional(rightSchema).annotate({ description: 'The right a `right-missing` refusal found short.' }),
};
export interface RefusalSchema extends Schema.Struct<typeof refusalFields> {}
export const refusalSchema: RefusalSchema = Schema.Struct(refusalFields).pipe(HttpApiSchema.status(409));
export const refusalBody = Schema.encodeSync(refusalSchema);

export const missingSchema = Schema.Struct({
  code: Schema.Literal('not-found'),
  reason: Schema.String,
  unblock: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
}).pipe(HttpApiSchema.status(404));

export const serverFaultBody = (defect: unknown): RefusalBody => {
  const causes = errorChain(defect);
  return {
    code: 'server-fault',
    reason: `this call broke inside the server: ${causes[0]?.message ?? 'nothing was reported'}`,
    causes,
    unblock: [
      'this is a Tagma defect, not a gate: file it with the reason above',
      'the server log carries the whole failure behind that line',
    ],
  };
};
