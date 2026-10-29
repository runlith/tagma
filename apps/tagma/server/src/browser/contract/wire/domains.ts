import { Schema } from 'effect';
import { PageId } from './ids.js';

export const DomainPattern = Schema.String.check(
  Schema.isPattern(
    /^(?:(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?|\[[a-fA-F0-9:.]+\])$/u,
  ),
);

export const DomainPolicy = Schema.Struct({ blocked: Schema.Array(DomainPattern), allowed: Schema.Array(DomainPattern) });
export type DomainPolicy = typeof DomainPolicy.Type;

export const RestrictionState = Schema.Struct({ restricted: Schema.Boolean, revision: Schema.Int.check(Schema.isGreaterThan(-1)) });
export type RestrictionState = typeof RestrictionState.Type;

export const Restriction = Schema.Struct({ page: PageId, ...RestrictionState.fields });
export type Restriction = typeof Restriction.Type;

export const DomainBlock = Schema.Struct({
  domain: Schema.String,
  setting: Schema.Literals(['browser.blockedDomains', 'browser.allowedDomains']),
});
export type DomainBlock = typeof DomainBlock.Type;

const matches = (domain: string, pattern: string): boolean => {
  const held = pattern.toLowerCase().replace(/\.$/u, '');
  return held.startsWith('*.') ? domain !== held.slice(2) && domain.endsWith(held.slice(1)) : domain === held;
};

export const domainBlock = (policy: DomainPolicy, url: string): DomainBlock | null => {
  if (url === 'about:blank' || url === 'about:srcdoc') return null;
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const domain = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (policy.blocked.some((pattern) => matches(domain, pattern))) return { domain, setting: 'browser.blockedDomains' };
  if (policy.allowed.length > 0 && !policy.allowed.some((pattern) => matches(domain, pattern)))
    return { domain: domain || parsed.protocol, setting: 'browser.allowedDomains' };
  return null;
};
