import type { PluginOption, PluginPlace } from '../../plugins/contract/service/format.js';

const VARIABLE = /\$\{(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|CLAUDE_PROJECT_DIR|user_config\.([A-Za-z_][A-Za-z0-9_]*))\}/gu;

export const SENSITIVE_PLACEHOLDER = '[sensitive value]';

export type Substitution = { readonly sensitive: ReadonlySet<string> | null };

export const substituted = (text: string, place: PluginPlace, substitution: Substitution = { sensitive: null }): string =>
  text.replaceAll(VARIABLE, (whole, name: string, option: string | undefined) => {
    if (name === 'CLAUDE_PLUGIN_ROOT') return place.root;
    if (name === 'CLAUDE_PLUGIN_DATA') return place.data;
    if (name === 'CLAUDE_PROJECT_DIR') return place.project;
    if (option === undefined) return whole;
    if (substitution.sensitive?.has(option) === true) return SENSITIVE_PLACEHOLDER;
    return place.options[option] ?? whole;
  });

export const contentSubstitution = (options: readonly PluginOption[]): Substitution => ({
  sensitive: new Set(options.filter((option) => option.sensitive).map((option) => option.key)),
});

export const optionEnvironment = (place: PluginPlace): Record<string, string> =>
  Object.fromEntries(Object.entries(place.options).map(([key, value]) => [`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`, value]));

export const pluginEnvironment = (place: PluginPlace): Record<string, string> => ({
  CLAUDE_PLUGIN_ROOT: place.root,
  CLAUDE_PLUGIN_DATA: place.data,
});
