import { DEFAULT_CATALOGS } from '../catalogs/contract/wire/registry.js';
import type { Vocabulary } from '../graph/contract/wire/tags/table.js';
import { vocabularyOf } from '../graph/vocabulary/served.js';
import { TagIndex } from '../graph/vocabulary/tagIndex.js';
import type { SettingDeclarationsAnswer } from '../settings/contract/wire/declarations.js';
import { resolveCatalog } from '../settings/resolution.js';
import { type Assembly, assemble } from './manifest.js';
import { SHIPPED_CATALOGS, settingDeclarations } from './settings.js';
import type { ServerParts } from './build.js';

const shippedVocabulary = (assembly: Assembly, catalogs: readonly string[]): Vocabulary =>
  vocabularyOf(
    new TagIndex(
      catalogs.flatMap((id) => SHIPPED_CATALOGS.byId(id)?.tags ?? []),
      assembly.behaviours,
      [],
      undefined,
      null,
      SHIPPED_CATALOGS,
    ),
    catalogs,
    [],
    [],
  );

const shippedSettings = (assembly: Assembly): SettingDeclarationsAnswer => {
  const declared = settingDeclarations(assembly.settings);
  return { sections: declared.sections, ...resolveCatalog(declared.keys, []) };
};

const shipped = async (parts: ServerParts) => {
  const assembly = await assemble(parts);
  return { vocabulary: shippedVocabulary(assembly, DEFAULT_CATALOGS), settings: shippedSettings(assembly) };
};

if (import.meta.main) {
  const { DEVELOPER } = await import('./developer/build.js');
  process.stdout.write(JSON.stringify(await shipped(await DEVELOPER.parts())));
}
