import type { DesktopDictation as Bridge, GlobalState } from '@tagma/desktop/bridge';
import type { SettingEntry } from '@tagma/server/settings/contract/wire/catalog';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { DesktopDictation } from '$lib/shared/desktop/DesktopDictation.js';
import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { SPEECH } from '../values.js';
import { chordOf, DEFAULT_CHORD } from './chord.js';

type Settings = ReturnType<typeof SettingsRepo.use>;

export class Global extends Service<Global>()('GlobalDictation', { tier: 'app' }) {
  static *make() {
    return new Global(yield* SettingsRepo, yield* Workspace, yield* DesktopDictation.optional(), yield* Scope);
  }

  state = $state.raw<GlobalState>({ kind: 'off' });
  private sent: string | undefined;

  constructor(
    private readonly settings: Settings,
    private readonly workspace: Workspace,
    readonly desktop: Bridge | undefined,
    scope: Scope,
  ) {
    super();
    if (desktop === undefined) return;
    void desktop.state().then((state) => (this.state = state));
    scope.defer(desktop.onState((state) => (this.state = state)));
    $effect(() => {
      const projectId = this.workspace.contextProject?.id;
      if (projectId === undefined) return;
      const loaded = this.settings.catalog.key(projectId).data;
      const catalog = writtenCatalog(this.settings, projectId) ?? loaded;
      if (catalog === undefined) return;
      untrack(() => this.arm(desktop, catalog.entries));
    });
  }

  prompt(): void {
    this.desktop?.prompt();
  }

  private arm(desktop: Bridge, entries: readonly SettingEntry[]): void {
    const on = entries.find((entry) => entry.id === SPEECH.globalDictation)?.value === true;
    const written = entries.find((entry) => entry.id === SPEECH.globalKey)?.value;
    const chord = on ? (chordOf(typeof written === 'string' ? written : DEFAULT_CHORD) ?? chordOf(DEFAULT_CHORD)) : null;
    const key = chord === null ? null : { code: chord.code, alt: chord.alt, ctrl: chord.ctrl, meta: chord.meta };
    const told = JSON.stringify(key);
    if (told === this.sent) return;
    this.sent = told;
    desktop.arm(key);
  }
}
