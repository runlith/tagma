import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import { mount, unmount, untrack } from 'svelte';
import { refusedOutcome, type WriteOutcome } from '../SettingsCatalog.svelte.js';
import type { SettingsRepo } from '../SettingsRepo.js';
import SettingChip from './SettingChip.svelte';

export class SettingChips {
  constructor(
    private readonly repo: SettingsRepo,
    readonly projectId: number,
  ) {}

  private readonly entries = $derived.by(() => {
    const catalog = this.repo.catalog.key(this.projectId).data;
    if (catalog === undefined) return undefined;
    return new Map(catalog.entries.filter((entry) => entry.control?.kind !== 'machine').map((entry) => [entry.id, entry]));
  });

  private readonly keys = $derived(this.entries === undefined ? '' : [...this.entries.keys()].join('\n'));

  entry(id: string): SettingEntry | undefined {
    return this.entries?.get(id);
  }

  attach(root: HTMLElement, context: Map<unknown, unknown>): (() => void) | undefined {
    if (this.keys === '') return undefined;
    return untrack(() => {
      const placed: { code: HTMLElement; holder: HTMLElement; chip: ReturnType<typeof mount> }[] = [];
      for (const code of root.querySelectorAll<HTMLElement>('code')) {
        if (
          code.parentElement?.closest('pre, a, [data-path], [data-setting-chip]') ||
          this.entries?.get(code.textContent ?? '') === undefined
        )
          continue;
        const holder = document.createElement('span');
        holder.dataset['settingChip'] = '';
        code.replaceWith(holder);
        placed.push({
          code,
          holder,
          chip: mount(SettingChip, { target: holder, props: { id: code.textContent ?? '', chips: this }, context }),
        });
      }
      return () => {
        for (const { code, holder, chip } of placed) {
          void unmount(chip);
          holder.replaceWith(code);
        }
      };
    });
  }

  refresh(): void {
    void this.repo.catalog.key(this.projectId).refresh();
  }

  async write(key: string, scope: SettableScope, value: unknown): Promise<WriteOutcome> {
    try {
      const written = await this.repo.write.run({ projectId: this.projectId, scope, key, value }, { throwOnError: true });
      if (written !== undefined) this.repo.catalog.key(this.projectId).setCache(written.settings);
      return { kind: 'saved' };
    } catch (caught) {
      return refusedOutcome(caught);
    }
  }
}

export function writeScope(entry: SettingEntry): SettableScope {
  if (entry.from !== 'default') return entry.from;
  return entry.scopes.includes('user') ? 'user' : (entry.scopes[0] ?? 'project');
}
