import type { PageFamily } from '@runlith/paging';
import type { ChangeTarget } from '@runlith/files/change';
import type { Approval, PermissionSubject, Raised } from '@runlith/agent/permissions';
import type { Claim, ClaimTarget } from '@runlith/agent/tool';
import type { ToolWords } from '@runlith/agent/tool/words';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Schema } from 'effect';
import type { Actor } from './actor.js';
import type { AgentTool } from './capability.js';
import { OperationId } from './ids.js';
import type { OperationPlace } from './place.js';

export type OperationConfirmation = {
  readonly summary: string;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly consequence?: string;
};

export type OperationEffect = 'read' | 'write' | 'external';

export type OperationClaims<Input = any> = {
  readonly reads?: (input: Input) => readonly ClaimTarget[];
  readonly writes?: (input: Input) => readonly ClaimTarget[];
};

export const operationClaims = (claims: OperationClaims, input: unknown): readonly Claim[] => [
  ...(claims.reads?.(input) ?? []).map((on): Claim => ({ on, access: 'read' })),
  ...(claims.writes?.(input) ?? []).map((on): Claim => ({ on, access: 'write' })),
];

export const operationWrites = (entry: Operation): boolean =>
  entry.claims === undefined ? entry.mutates === true : entry.claims.writes !== undefined;

export type OperationSubject = 'head' | 'tree' | 'file' | 'none';
export type CheckSubjectKind = Exclude<OperationSubject, 'none'>;

export type OperationIdentity = 'none' | 'revision' | 'manual' | { readonly key: 'call' | 'request' };

export type OperationWait = 'ticket' | 'reader' | 'tree-permit' | 'entry-gate' | 'identity-lane' | 'unit' | 'recovery-unit' | 'graph-open';

export type DeadlineKind =
  | 'large'
  | 'pass-wait'
  | 'wait-input'
  | 'landing'
  | 'inspection'
  | 'program'
  | 'external'
  | 'model'
  | 'operator-wait';

export type OperationLifetime = 'workspace' | 'run';

export type OperationDoors = {
  readonly http?: boolean | 'perform';
  readonly socket?: boolean;
};

export type OperationCallers = 'any' | 'thread' | 'operator';

export type FieldBound = { readonly capped: number } | { readonly summary: string } | { readonly retained: true };

export type GraphUse = { readonly graph?: 'none' };

type OperationShape = GraphUse & {
  readonly meaning: string;
  readonly grammar?: string;
  readonly params: Schema.Codec<any, unknown, never, never>;
  readonly refusals: readonly string[];
  readonly confirmation: (input: any, prepared?: any) => OperationConfirmation;
  readonly confirmLabel: string;
  readonly presentation: ToolWords;
  readonly called?: (input: any) => ToolDisplay;
  readonly subjects: (input: any, prepared: any, actor: Actor) => readonly PermissionSubject[];
  readonly claims?: OperationClaims;
  readonly approval: Approval;
  readonly raises?: (input: any, prepared: any, actor: Actor) => readonly Raised[];
  readonly mutates?: true;
  readonly external?: true;
  readonly checks?: 'tree';
  readonly negative?: (answer: unknown) => boolean;
  readonly answer?: Schema.Top;
  readonly effect?: OperationEffect;
  readonly subject?: OperationSubject;
  readonly identity?: OperationIdentity;
  readonly waits?: readonly OperationWait[];
  readonly watches?: (input: any) => boolean;
  readonly deadline?: DeadlineKind;
  readonly page?: PageFamily;
  readonly bounds?: Readonly<Record<string, FieldBound>>;
  readonly lifetimes?: readonly OperationLifetime[];
  readonly place: OperationPlace;
  readonly filePlace?: ChangeTarget;
  readonly doors?: OperationDoors;
};

type OperationOffer =
  | { readonly callers: 'operator'; readonly tool?: never }
  | { readonly callers: Exclude<OperationCallers, 'operator'>; readonly tool: AgentTool | undefined };

export type Operation = OperationShape &
  OperationOffer &
  (
    | {
        readonly intent: 'destructive';
        readonly destructiveConsequence: (input: any) => string;
      }
    | {
        readonly intent?: never;
        readonly destructiveConsequence?: never;
      }
  );

export function operationNotes(entry: Operation): string {
  return [
    ...(entry.grammar === undefined ? [] : [entry.grammar]),
    ...(entry.refusals.length === 0 ? [] : [`Refuses: ${entry.refusals.join(', ')}.`]),
  ].join('\n\n');
}

export function operationText(entry: Operation): string {
  return [entry.meaning, entry.grammar].filter((text) => text !== undefined).join('\n\n');
}

type DeclarationShape<Input extends Schema.Top = Schema.Codec<any, unknown>, Answer extends AnswerArms<any> = AnswerArms<any>> = Omit<
  OperationShape,
  | 'params'
  | 'answer'
  | 'effect'
  | 'subject'
  | 'identity'
  | 'waits'
  | 'watches'
  | 'lifetimes'
  | 'doors'
  | 'mutates'
  | 'checks'
  | 'negative'
  | 'confirmation'
  | 'subjects'
  | 'claims'
  | 'raises'
  | 'called'
> & {
  readonly input: Input;
  readonly answer: Answer;
  readonly watches?: (input: Input['Type']) => boolean;
  readonly negative?:
    | readonly (DeclaredAnswer<Answer> extends { readonly status: infer Status extends string } ? Status : never)[]
    | ((answer: DeclaredAnswer<Answer>) => boolean);
  readonly confirmation: (input: Input['Type'], prepared?: any) => OperationConfirmation;
  readonly called?: (input: Partial<Input['Type']>) => ToolDisplay;
  readonly subjects: (input: Input['Type'], prepared: any, actor: Actor) => readonly PermissionSubject[];
  readonly claims?: OperationClaims<Input['Type']>;
  readonly raises?: (input: Input['Type'], prepared: any, actor: Actor) => readonly Raised[];
  readonly subject: OperationSubject;
  readonly waits: readonly OperationWait[];
  readonly lifetimes: readonly OperationLifetime[];
  readonly doors: OperationDoors;
} & OperationOffer &
  (
    | { readonly effect: 'read'; readonly identity: 'none' }
    | { readonly effect: 'write' | 'external'; readonly identity: Exclude<OperationIdentity, 'none'> }
  ) &
  (
    | { readonly intent: 'destructive'; readonly destructiveConsequence: (input: Input['Type']) => string }
    | { readonly intent?: never; readonly destructiveConsequence?: never }
  );

export type OperationDeclaration = DeclarationShape & { readonly id: OperationId };

export const operation = <
  const Id extends string,
  Input extends Schema.Codec<any, unknown>,
  Answer extends AnswerArms<any>,
  const Declaration extends DeclarationShape<Input, Answer>,
>(
  id: Id,
  declaration: Declaration &
    DeclarationShape<Input, Answer> &
    Record<Exclude<keyof Declaration, keyof DeclarationShape<Input, Answer>>, never> & {
      readonly doors: Record<Exclude<keyof Declaration['doors'], keyof OperationDoors>, never>;
    },
): Declaration & { readonly id: Id & OperationId } => ({
  ...declaration,
  id: OperationId.make(id) as Id & OperationId,
});

export const feedPlaceSchema = Schema.Struct({ projectId: Schema.Int, threadId: Schema.String });
export type FeedPlace = typeof feedPlaceSchema.Type;

export type FeedDeclaration = GraphUse & {
  readonly id: string;
  readonly input: Schema.Codec<any, unknown, never, never>;
  readonly event: Schema.Codec<any, unknown, never, never>;
  readonly refusals: readonly string[];
  readonly callers: OperationCallers;
  readonly external?: true;
  readonly local?: true;
  readonly stream?: false;
  readonly performs?: string;
  readonly answer?: (answer: any) => unknown;
  readonly admission?: 'project';
  readonly place?: typeof feedPlaceSchema;
  readonly window?: number;
};

export const feed = <const Id extends string, const Declaration extends Omit<FeedDeclaration, 'id'>>(id: Id, declaration: Declaration) => ({
  ...declaration,
  id,
});

export type EndpointDeclaration = {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  readonly path: string;
};

export const endpoint = <const Id extends string, const Declaration extends Omit<EndpointDeclaration, 'id'>>(
  id: Id,
  declaration: Declaration,
) => ({
  ...declaration,
  id,
});

declare const openAnswer: unique symbol;

export interface AnswerArms<Answer> extends Schema.Codec<Answer, unknown> {
  readonly [openAnswer]: true;
  readonly Rebuild: AnswerArms<Answer>;
}

type KnownAnswer<Answer> = Answer extends { readonly status: infer Status extends string }
  ? string extends Status
    ? never
    : Answer
  : Answer;

export type DeclaredAnswer<Answer extends Schema.Top> = KnownAnswer<Answer['Type']>;

type KnownArms<Arms extends Record<string, Schema.Struct.Fields>> = {
  readonly [K in keyof Arms]: Schema.Struct.Type<Arms[K]> & { readonly status: K };
}[keyof Arms];

const KNOWN = Symbol('known answer arms');

export const arms = <const Arms extends Record<string, Schema.Struct.Fields>>(declared: Arms) => {
  const known = Object.keys(declared);
  const strict = Object.entries(declared).map(([status, fields]) => Schema.Struct({ ...fields, status: Schema.Literal(status) }));
  const unknownArm = Schema.StructWithRest(
    Schema.Struct({ status: Schema.String.check(Schema.makeFilter((status: string) => !known.includes(status))) }),
    [Schema.Record(Schema.String, Schema.Unknown)],
  );
  return Object.assign(Schema.Union([...strict, unknownArm]), { [KNOWN]: Schema.Union(strict) }) as unknown as AnswerArms<
    KnownArms<Arms> | { readonly status: string; readonly [field: string]: unknown }
  >;
};

export const knownAnswer = <A extends Schema.Top>(answer: A): Schema.Codec<DeclaredAnswer<A>, unknown> =>
  ((answer as { readonly [KNOWN]?: Schema.Top })[KNOWN] ?? answer) as unknown as Schema.Codec<DeclaredAnswer<A>, unknown>;
