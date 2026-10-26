import { Context } from 'effect';

export const CallStage = Context.Reference<(detail: string) => void>('tagma/platform/CallStage', {
  defaultValue: () => () => undefined,
});
