import type { Words } from '../../../platform/contract/wire/refusal.js';

export const INSTALL_WORDS = {
  'no-offer': { text: 'This version is not offered any more. Look for updates again in a moment.' },
  'offer-unavailable': { text: 'Tagma cannot install this version on this Mac right now.' },
  'install-running': { text: 'Tagma is already installing an update. Wait for it to finish.' },
  'install-restarting': { text: 'Tagma is restarting onto the update. Wait a moment.' },
  offline: { text: 'Tagma could not reach the update server. Check the internet connection, then try again.' },
  'source-unreadable': { text: 'The update information could not be read. Try again later.' },
  'platform-unavailable': { text: 'This update is not available for this machine. Check for updates later.' },
  'nothing-installing': { text: 'Nothing is being installed.' },
} as const satisfies Readonly<Record<string, Words>>;

export const QUIT_WORDS = {
  'channel-unnamed': { text: 'Another Tagma holds this Mac and cannot be asked to stop. Quit it from its own window.' },
  'host-stayed': { text: 'Tagma stopped, but some of its terminals or commands may still run. Stop Tagma again to end them.' },
  'chain-unproven': { text: 'Tagma may have started again. Press Stop again.' },
} as const satisfies Readonly<Record<string, Words>>;

export const RESTART_WORDS = {
  'successor-left': { text: 'Tagma could not start again and keeps running as it was. Try again.' },
  'host-unprepared': { text: 'The execution host cannot take this version, so Tagma keeps running as it was.' },
  'no-successor': { text: 'There is no installed version of Tagma to restart onto.' },
} as const satisfies Readonly<Record<string, Words>>;
