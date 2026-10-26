import type { SettingsPage } from '@tagma/server/platform/contract/wire/refusal';
import { Service } from '@runlith/layer/key';
import type { Act, Told } from '$lib/wire/told.js';
import { ExternalLinks, type LinkPort } from './ExternalLinks.js';

const PRIVACY = 'x-apple.systempreferences:com.apple.preference.security';

const HREF: Readonly<Record<SettingsPage, string>> = {
  microphone: `${PRIVACY}?Privacy_Microphone`,
  'system-audio': `${PRIVACY}?Privacy_AudioCapture`,
  accessibility: `${PRIVACY}?Privacy_Accessibility`,
};

export class SystemSettings extends Service<SystemSettings>()('SystemSettings', { tier: 'app' }) {
  static *make() {
    return new SystemSettings(yield* ExternalLinks);
  }

  constructor(private readonly links: LinkPort) {
    super();
  }

  open(page: SettingsPage): void {
    this.links.open(HREF[page]);
  }
}

export const actOf = (told: Told, systemSettings: SystemSettings | undefined): Act | undefined => {
  if (told.act !== undefined) return told.act;
  const page = told.settings;
  if (page === undefined || systemSettings === undefined) return undefined;
  return { label: 'Open Settings', run: () => systemSettings.open(page) };
};
