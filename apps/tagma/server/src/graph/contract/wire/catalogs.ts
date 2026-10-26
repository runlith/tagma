import { Context } from 'effect';
import type { SettingKey } from '../../../platform/contract/wire/setting.js';
import type { Catalog } from './tags/declaration.js';

export class Catalogs extends Context.Service<
  Catalogs,
  {
    readonly key: SettingKey<readonly string[]> | null;
    readonly all: readonly Catalog[];
    byId(id: string): Catalog | null;
    declaring(tagId: string): readonly string[];
  }
>()('tagma/graph/Catalogs') {}

export const NO_CATALOGS: Catalogs['Service'] = {
  key: null,
  all: [],
  byId: () => null,
  declaring: () => [],
};
