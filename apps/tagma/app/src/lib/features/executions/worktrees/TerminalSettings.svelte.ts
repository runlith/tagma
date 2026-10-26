import { terminalPlaceLayouts, terminalSkipCloseConfirm } from '@tagma/server/executions/contract/wire/terminalBehavior';
import type { Scope } from '@runlith/layer/Scope';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import { type SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
import { parseStoredWorktrees, type StoredLayout, type StoredWorktrees } from './layout.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

type Entry = { readonly id: string; readonly value: unknown };

export class TerminalSettings {
  private entries: readonly Entry[] = [];
  private saved: string | null = null;
  private queued: StoredWorktrees | null = null;
  private writing = false;
  private failed = false;
  private readonly saving: Settings['write'];

  constructor(
    private readonly projectId: number,
    private readonly settings: Settings,
    private readonly notices: Notices,
    scope: Scope,
  ) {
    this.saving = settings.write.in(scope);
  }

  catalog(): readonly Entry[] | null {
    const watched = this.settings.catalog.key(this.projectId).watch();
    return (writtenCatalog(this.settings, this.projectId) ?? watched)?.entries ?? null;
  }

  heard(entries: readonly Entry[]): Map<string, StoredLayout> | null {
    this.entries = entries;
    const entry = entries.find((row) => row.id === terminalPlaceLayouts.id);
    return entry === undefined ? null : parseStoredWorktrees(entry.value);
  }

  async load(): Promise<Map<string, StoredLayout>> {
    const catalog = await this.settings.catalog.key(this.projectId).refresh({ throwOnError: true });
    if (catalog) this.entries = catalog.entries;
    const entry = catalog?.entries.find((row) => row.id === terminalPlaceLayouts.id);
    return parseStoredWorktrees(entry?.value ?? null);
  }

  asksClose(): boolean {
    const entry = this.entries.find((row) => row.id === terminalSkipCloseConfirm.id);
    return !(entry === undefined ? terminalSkipCloseConfirm.fallback : entry.value === true);
  }

  async stopAsking(): Promise<void> {
    try {
      await this.settings.write.run(
        { projectId: this.projectId, scope: 'project', key: terminalSkipCloseConfirm.id, value: true },
        { throwOnError: true },
      );
    } catch (error) {
      this.notices.refusal(error);
    }
  }

  standsAs(value: StoredWorktrees): void {
    this.saved = JSON.stringify(value);
  }

  save(value: StoredWorktrees): void {
    if (this.writing) this.queued = value;
    else void this.write(value);
  }

  private async write(first: StoredWorktrees): Promise<void> {
    this.writing = true;
    let value: StoredWorktrees | null = first;
    while (value !== null) {
      this.queued = null;
      const snapshot = JSON.stringify(value);
      if (snapshot !== this.saved) {
        try {
          const written = await this.saving.run(
            { projectId: this.projectId, scope: 'project', key: terminalPlaceLayouts.id, value },
            { throwOnError: true },
          );
          if (written !== undefined) this.entries = written.settings.entries;
          this.saved = snapshot;
          this.failed = false;
        } catch (error) {
          if (!this.failed) {
            this.failed = true;
            this.notices.background(error);
          }
        }
      }
      value = this.queued;
    }
    this.writing = false;
  }
}
