import { Effect } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { SettingContribution, SettingDeclarationsAnswer } from './contract/wire/declarations.js';
import { resolveCatalog, type SettingLayer } from './resolution.js';

export const catalog =
  (declarations: SettingContribution, layers: (projectId?: number) => Effect.Effect<SettingLayer[], StoreFailure>) =>
  (projectId?: number): Effect.Effect<SettingDeclarationsAnswer, StoreFailure> =>
    layers(projectId).pipe(
      Effect.map((chain) => {
        const { entries, rejections } = resolveCatalog(declarations.keys, chain, declarations.controls);
        return { sections: declarations.sections, entries, rejections };
      }),
    );
