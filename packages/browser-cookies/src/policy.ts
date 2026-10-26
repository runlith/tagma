import { getDomain } from 'tldts';
import { type Cookie, hostOf, keyOf } from './cookie.js';

export const KEPT_OUT = 'google.com';

export type Plan = {
  readonly cookies: readonly Cookie[];
  readonly google: number;
  readonly domains: readonly string[];
  readonly covers: (domain: string) => boolean;
};

export const planImport = (read: readonly Cookie[], now: number): Plan => {
  const registrable = new Map<string, string>();
  const siteOf = (host: string): string => {
    let site = registrable.get(host);
    if (site === undefined) {
      site = getDomain(host, { allowPrivateDomains: true }) ?? host;
      registrable.set(host, site);
    }
    return site;
  };
  const kept = new Map<string, Cookie>();
  let google = 0;
  for (const cookie of read) {
    if (cookie.expires !== null && cookie.expires <= now) continue;
    if (siteOf(hostOf(cookie.domain)) === KEPT_OUT) {
      google += 1;
      continue;
    }
    kept.set(keyOf(cookie), cookie);
  }
  const hosts = new Set<string>();
  for (const cookie of kept.values()) hosts.add(hostOf(cookie.domain));
  const above = new Set<string>();
  for (const host of hosts) {
    const site = siteOf(host);
    for (let at = host; at !== site && at.includes('.');) {
      at = at.slice(at.indexOf('.') + 1);
      above.add(at);
    }
  }
  const covers = (domain: string): boolean => {
    const host = hostOf(domain);
    if (above.has(host)) return true;
    const site = siteOf(host);
    for (let at = host; ; at = at.slice(at.indexOf('.') + 1)) {
      if (hosts.has(at)) return true;
      if (at === site || !at.includes('.')) return false;
    }
  };
  return { cookies: [...kept.values()], google, domains: [...new Set([...hosts].map(siteOf))].sort(), covers };
};
