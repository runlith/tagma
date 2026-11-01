import {
  type AutoSaveMode,
  autoSave,
  autoSaveDelay,
  DEFAULT_AUTO_SAVE_DELAY_MS,
  DEFAULT_AUTO_SAVE_MODE,
  AUTO_SAVE_MODES,
} from '@tagma/server/checkout-files/contract/wire/settings';
import { Service } from '@runlith/layer/key';
import { SettingsRepo, writtenCatalog } from '$lib/features/settings/SettingsRepo.js';

export type AutoSavePolicy = { readonly mode: AutoSaveMode; readonly delay: number };

const isMode = (value: unknown): value is AutoSaveMode => AUTO_SAVE_MODES.some((mode) => mode === value);

export class AutoSave extends Service<AutoSave>()('AutoSave', { tier: 'app' }) {
  static *make() {
    return new AutoSave(yield* SettingsRepo);
  }

  private readonly policies = new Map<number, AutoSavePolicy>();

  constructor(private readonly settings: SettingsRepo) {
    super();
  }

  policyOf(projectId: number): AutoSavePolicy {
    const entries = (writtenCatalog(this.settings, projectId) ?? this.settings.catalog.key(projectId).data)?.entries;
    const mode = entries?.find((entry) => entry.id === autoSave.id)?.value;
    const delay = entries?.find((entry) => entry.id === autoSaveDelay.id)?.value;
    const next: AutoSavePolicy = {
      mode: isMode(mode) ? mode : DEFAULT_AUTO_SAVE_MODE,
      delay: typeof delay === 'number' && delay > 0 ? delay : DEFAULT_AUTO_SAVE_DELAY_MS,
    };
    const known = this.policies.get(projectId);
    if (known?.mode === next.mode && known.delay === next.delay) return known;
    this.policies.set(projectId, next);
    return next;
  }
}
