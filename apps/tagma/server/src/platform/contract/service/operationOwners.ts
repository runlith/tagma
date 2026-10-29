import { Context } from 'effect';

export class OperationOwners extends Context.Service<
  OperationOwners,
  {
    readonly of: (operationOrTool: string) => string | null;
  }
>()('tagma/platform/OperationOwners') {}
