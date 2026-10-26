import type { Platform } from '@runlith/layer/Platform';

import type { LocaleCode } from './types.js';

export type LocaleReader = (platform: Platform) => string | undefined;

export interface ResolveLocaleOptions {
  chosen?: string;
  languages?: readonly string[];
  supportedLocales: readonly LocaleCode[];
  defaultLocale: LocaleCode;
}

export function cookieLocale(name: string): LocaleReader {
  return (platform) => platform.cookies.get(name);
}

export function storedLocale(key: string): LocaleReader {
  return (platform) => platform.storage.local.getItem(key) ?? undefined;
}

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase();
}

function findSupportedLocale(tag: string, supported: readonly LocaleCode[]): LocaleCode | undefined {
  const normalizedTag = normalizeLocale(tag);
  const normalizedSupported = supported.map((locale) => locale.toLowerCase());

  const exactIndex = normalizedSupported.indexOf(normalizedTag);
  if (exactIndex >= 0) return supported[exactIndex];

  const base = normalizedTag.split('-')[0] ?? normalizedTag;
  const baseIndex = normalizedSupported.indexOf(base);
  if (baseIndex >= 0) return supported[baseIndex];

  return undefined;
}

export function resolveLocale(options: ResolveLocaleOptions): LocaleCode {
  if (options.chosen) {
    const match = findSupportedLocale(options.chosen, options.supportedLocales);
    if (match) return match;
  }

  for (const language of options.languages ?? []) {
    const match = findSupportedLocale(language, options.supportedLocales);
    if (match) return match;
  }

  return options.defaultLocale;
}
