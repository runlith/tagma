import type { ModeLookup } from '@runlith/agent/modes/ApprovalMode';
import type { PermissionSubject } from '@runlith/agent/permissions';
import type { ToolMedia } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Context, type Effect } from 'effect';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import type { CheckSubjectKind } from '../../../platform/contract/wire/operation.js';
import type { CallKey, OperationId } from '../../../platform/contract/wire/ids.js';
import type { SettleAnswer } from '../../../platform/contract/service/body.js';
import type { ModulePresentation, Voice } from '../../../platform/contract/service/presentation.js';
import type { DynamicOperationFailure } from './refusals.js';
import type { OperationRegistry } from './registry.js';
import type { Place, SubjectKind } from '../../../platform/contract/wire/place.js';
import type { SubjectPlace } from '../../../platform/contract/service/place.js';
import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export type ErasedBound<R> = {
  readonly place?: (input: unknown, caller: Caller) => Effect.Effect<Place | null, DynamicOperationFailure, R>;
  readonly files?: (input: unknown, caller: Caller) => readonly PermissionSubject[];
  readonly prepare?: (input: unknown, caller: Caller) => Effect.Effect<unknown, DynamicOperationFailure, R>;
  readonly execute: (input: unknown, prepared: unknown, caller: Caller) => Effect.Effect<unknown, DynamicOperationFailure, R>;
  readonly answer?: (value: unknown, input: unknown) => unknown;
  readonly voice?: Voice<unknown, unknown, R>;
  readonly display?: (answer: unknown) => ToolDisplay;
  readonly media?: (answer: unknown) => Effect.Effect<readonly ToolMedia[], never, R>;
  readonly settle?: (key: CallKey) => Effect.Effect<SettleAnswer, DynamicOperationFailure, R>;
};

export class OperationCatalog extends Context.Service<
  OperationCatalog,
  {
    readonly registry: OperationRegistry<OperationId>;
    readonly modes: ModeLookup;
    readonly bound: (id: OperationId) => ErasedBound<any> | undefined;
    readonly subjects: (kind: SubjectKind) => SubjectPlace | undefined;
    readonly subjectCalls: () => Context.Context<never>;
    readonly checks: (id: string) => CheckSubjectKind | null;
    readonly presentation: (id: OperationId) => ModulePresentation<any> | undefined;
    readonly refusals: RefusalWords;
  }
>()('tagma/invocation/OperationCatalog') {}
