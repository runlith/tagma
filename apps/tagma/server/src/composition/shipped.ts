import { DEFAULT_CATALOGS } from '../catalogs/contract/wire/registry.js';
import type { Vocabulary } from '../graph/contract/wire/tags/table.js';
import { vocabularyOf } from '../graph/vocabulary/served.js';
import { TagIndex } from '../graph/vocabulary/tagIndex.js';
import type { SettingDeclarationsAnswer } from '../settings/contract/wire/declarations.js';
import { resolveCatalog } from '../settings/resolution.js';
import { BEHAVIOUR_REGISTRY } from './manifest.js';
import { SHIPPED_CATALOGS, settingDeclarations } from './settings.js';

export const shippedVocabulary = (catalogs: readonly string[]): Vocabulary =>
  vocabularyOf(
    new TagIndex(
      catalogs.flatMap((id) => SHIPPED_CATALOGS.byId(id)?.tags ?? []),
      BEHAVIOUR_REGISTRY,
      [],
      undefined,
      null,
      SHIPPED_CATALOGS,
    ),
    catalogs,
    [],
    [],
  );

export const shippedSettings = (): SettingDeclarationsAnswer => {
  const declared = settingDeclarations();
  return { sections: declared.sections, ...resolveCatalog(declared.keys, []) };
};

if (import.meta.main)
  process.stdout.write(JSON.stringify({ vocabulary: shippedVocabulary(DEFAULT_CATALOGS), settings: shippedSettings() }));
