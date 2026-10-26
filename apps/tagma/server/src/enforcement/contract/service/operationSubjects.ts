import { Context } from 'effect';
import type { CheckSubjectKind } from '../../../platform/contract/wire/operation.js';

export class OperationSubjects extends Context.Service<
  OperationSubjects,
  {
    readonly of: (operation: string) => CheckSubjectKind | null;
  }
>()('tagma/enforcement/OperationSubjects') {}
