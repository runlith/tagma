import type { PluginOptionValues } from '@tagma/server/plugins/contract/wire/settings';

export function optionsWith(current: PluginOptionValues, plugin: string, key: string, value: string): PluginOptionValues {
  const { [key]: replaced, ...kept } = current[plugin] ?? {};
  const own = value === '' ? kept : { ...kept, [key]: value };
  const { [plugin]: former, ...others } = current;
  return Object.keys(own).length === 0 ? others : { ...others, [plugin]: own };
}
