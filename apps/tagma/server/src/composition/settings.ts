import { Effect } from 'effect';
import { MODULES } from '@tagma/server/composition/modules';
import type { SettingControlSource } from '../platform/contract/service/manifest.js';
import type { SettingControlReader } from '../platform/contract/wire/setting.js';
import type { SettingContribution } from '../settings/contract/wire/declarations.js';
import { graphCatalogs } from '../catalogs/contract/wire/settings.js';
import { catalogs } from '../catalogs/install.js';
import { COLLECTED_SETTINGS } from './manifest.js';

export const SHIPPED_CATALOGS = catalogs(graphCatalogs);

const byOrder = (left: { readonly order: number }, right: { readonly order: number }): number => left.order - right.order;

export const settingDeclarations = (controls?: ReadonlyMap<string, SettingControlReader>): SettingContribution => ({
  sections: [...COLLECTED_SETTINGS.sections].sort(byOrder),
  keys: [...COLLECTED_SETTINGS.keys].sort(byOrder),
  controls,
});

type ControlServices<M> = M extends { readonly settingControls: readonly SettingControlSource<infer R>[] } ? R : never;

export const declaredSettings = Effect.map(Effect.context<ControlServices<(typeof MODULES)[number]>>(), (context) =>
  settingDeclarations(
    new Map(
      MODULES.flatMap((module) =>
        'settingControls' in module ? module.settingControls.map((source) => [source.id, () => source.read(context)] as const) : [],
      ),
    ),
  ),
);

export const SETTING_DECLARATIONS = settingDeclarations();
