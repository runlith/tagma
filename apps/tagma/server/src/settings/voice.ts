import { sessionName, type SessionIdentity } from '../platform/contract/wire/session.js';
import { startLines } from '../platform/contract/wire/start.js';
import type { SettingEntry, SettingRejection } from './contract/wire/catalog.js';
import type { SettingWriteAnswer } from './contract/wire/operations.js';

type SettingsCatalog = {
  readonly sections: readonly { readonly id: string; readonly title: string; readonly description: string }[];
  readonly entries: readonly (Omit<SettingEntry, 'section'> & { readonly section: string })[];
  readonly rejections: readonly SettingRejection[];
};

type SettingsAnswer = {
  readonly status: 'ok';
  readonly project: { readonly id: number; readonly name: string };
  readonly settings: SettingsCatalog;
};

function settingsEntryLine(entry: SettingsCatalog['entries'][number], identity: SessionIdentity['Service']): string {
  const writer = entry.writer === undefined ? undefined : sessionName(entry.writer, identity);
  const by = writer === undefined ? '' : ` by ${writer}`;
  const value = ` = ${typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)}`;
  const options = entry.control?.kind === 'choice' ? entry.control.choices.map((choice) => `  ${choice.value} — ${choice.hint}`) : [];
  const holds =
    options.length > 0 && entry.control?.kind === 'choice' && entry.control.multiple !== true ? [] : [`  holds: ${entry.shape}`];
  return [`${entry.id}${value} [${entry.from}]${by}`, `  ${entry.description}`, ...holds, ...options].join('\n');
}

function settingsCatalogText(catalog: SettingsCatalog, identity: SessionIdentity['Service']): string {
  const lines: string[] = [];
  for (const section of catalog.sections) {
    const entries = catalog.entries.filter((entry) => entry.section === section.id);
    if (entries.length === 0) continue;
    lines.push(`${section.title} — ${section.description}`);
    for (const entry of entries) {
      lines.push(
        ...settingsEntryLine(entry, identity)
          .split('\n')
          .map((line) => `  ${line}`),
      );
    }
    lines.push('');
  }
  for (const rejection of catalog.rejections) {
    lines.push(`unreadable: ${rejection.key} in ${rejection.scope} scope — ${rejection.reason}`);
  }
  return lines.join('\n').trimEnd();
}

export function settingsText(answer: unknown, identity: SessionIdentity['Service']): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  if ('key' in answer) {
    const written = answer as SettingWriteAnswer;
    return [
      `project: ${written.project.name} (${written.project.id})`,
      `${written.key} = ${JSON.stringify(written.value)} [${written.from}]`,
      ...startLines(written),
    ].join('\n');
  }
  if (!('settings' in answer)) return null;
  const read = answer as SettingsAnswer;
  const catalog = settingsCatalogText(read.settings, identity);
  return [`project: ${read.project.name} (${read.project.id})\n\n${catalog}`, ...startLines(read)].join('\n');
}
