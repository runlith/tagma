import type { SettingControlReader, SettingKey, SettingSectionDeclaration } from '../../../platform/contract/wire/setting.js';
import type { SettingEntry, SettingRejection } from './catalog.js';

export type SettingContribution = {
  readonly sections: readonly SettingSectionDeclaration[];
  readonly keys: readonly SettingKey<unknown>[];
  readonly controls?: ReadonlyMap<string, SettingControlReader>;
};

export type SettingDeclarationsAnswer = {
  readonly sections: readonly SettingSectionDeclaration[];
  readonly entries: readonly SettingEntry[];
  readonly rejections: readonly SettingRejection[];
};
