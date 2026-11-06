import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { Platform } from '@runlith/layer/Platform';
import { browserPlatform } from '@runlith/layer/Platform/browser';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { storedShell } from '$lib/features/shell/shell.js';
import { BrowserWorkers } from '$lib/shared/workers/BrowserWorkers.js';
import { ServiceWorkers } from '$lib/shared/workers/ServiceWorkers.js';
import { ClientBuild } from '$lib/wire/ClientBuild.js';
import { dev } from '$app/environment';
import { updated } from '$app/state';
import { appLayers } from './composition.js';
import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
import { adoptedSheet, UtilitiesSheet, unshownSheet } from '$lib/features/plugin-views/UtilitiesSheet.js';
import { FileSaver } from '$lib/shared/FileSaver.js';
import type { BrowserPlatform } from './hostOs.js';
import { hostOf } from './host.js';

const liveBrowser = (): BrowserPlatform | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } });

const touchScreen = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (hover: none)').matches;

const installedApp = (): boolean =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true);

const REVOKE_AFTER_MS = 4_000;

function saveInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replaceAll(/[/\\:*?"<>|]/gu, '-');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

const desktop = window.tagmaDesktop;

export const WINDOW = Layer.mergeAll(
  appLayers(desktop),
  Layer.of(ExternalLinks, { open: (url) => void window.open(url, '_blank', 'noopener,noreferrer') }),
  Layer.of(FileSaver, { save: saveInBrowser }),
  Layer.of(ClientBuild, { behind: () => updated.check() }),
  Layer.of(ServiceWorkers, new BrowserWorkers(dev ? 'module' : 'classic')),
  Layer.provide(UtilitiesSheet, function* () {
    if (dev) return unshownSheet;
    const platform = yield* Platform;
    const origin = yield* ServerOrigin;
    return adoptedSheet(async (address) => {
      const answer = await platform.fetch(new URL(address, origin.http));
      if (!answer.ok) throw new Error(`${address} answered ${answer.status}`);
      return answer.text();
    });
  }),
  Host.of(hostOf(desktop?.operatingSystem, liveBrowser(), storedShell(browserPlatform().storage.local), touchScreen(), installedApp())),
  ServerOrigin.of(window.location.origin),
);
