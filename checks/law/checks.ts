import { Schema } from 'effect';
import type { Implementation, ReadingScope } from '@tagma/inspection/node/reading';
import type { InspectionMemo } from '@tagma/inspection/node/memo';
import type { Adapters } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import { effectStyle as declaredStyle } from './effect-style/declaration';
import { uiTokens as declaredTokens } from './ui-tokens/declaration';
import { environment as declaredEnvironment } from './environment/declaration';

export const checked = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  implementation: Implementation<S['Type']>,
  value: unknown,
) => {
  const params = Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value);
  return {
    selects: (path: string) => implementation.selects(params, path),
    read: (tree: Tree, paths: readonly string[], adapters: Adapters, memo: InspectionMemo, scope: ReadingScope) =>
      implementation.read(params, tree, paths, adapters, { take: () => undefined }, memo, scope),
  };
};

export const checkOf = async (id: string, params: unknown) => {
  switch (id) {
    case 'effect-style':
      return checked(declaredStyle.params, (await import('./effect-style/implementation')).effectStyle, params);
    case 'ui-tokens':
      return checked(declaredTokens.params, (await import('./ui-tokens/implementation')).uiTokens, params);
    case 'environment':
      return checked(declaredEnvironment.params, (await import('./environment/implementation')).environment, params);
    default:
      throw new Error(`unknown law check: ${id}`);
  }
};
