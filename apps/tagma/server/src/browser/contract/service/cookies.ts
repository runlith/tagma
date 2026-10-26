import type { CookieSource } from '@runlith/browser-cookies/source';
import { Context } from 'effect';

export class CookieSources extends Context.Service<CookieSources, { readonly all: readonly CookieSource[] }>()(
  'tagma/browser/CookieSources',
) {}
