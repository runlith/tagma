import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

const HIDDEN_KEY = 'tagma.settingsColumnHidden';
const LAST_KEY = 'tagma.settingsSection';
const LAST_SCOPE_KEY = 'tagma.settingsScope';

export class SettingsColumn extends Service<SettingsColumn>()('SettingsColumn', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new SettingsColumn(platform.storage.local);
  }

  open = $state(true);
  room = $state(true);
  last = $state<string | null>(null);
  lastScope = $state<SettableScope | null>(null);

  constructor(private readonly storage: PlatformStorage) {
    super();
    this.open = storage.getItem(HIDDEN_KEY) !== 'true';
    this.last = storage.getItem(LAST_KEY);
    const scope = storage.getItem(LAST_SCOPE_KEY);
    this.lastScope = scope === 'project' || scope === 'user' ? scope : null;
  }

  get shown(): boolean {
    return this.open && this.room;
  }

  toggle(): void {
    this.open = !this.open;
    this.storage.setItem(HIDDEN_KEY, String(!this.open));
  }

  fit(room: boolean): void {
    this.room = room;
  }

  visit(section: string, scope: SettableScope): void {
    if (this.last !== section) {
      this.last = section;
      this.storage.setItem(LAST_KEY, section);
    }
    if (this.lastScope !== scope) {
      this.lastScope = scope;
      this.storage.setItem(LAST_SCOPE_KEY, scope);
    }
  }
}
