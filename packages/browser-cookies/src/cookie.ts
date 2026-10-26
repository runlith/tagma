export type SameSite = 'Strict' | 'Lax' | 'None';

export type Priority = 'Low' | 'Medium' | 'High';

export type Scheme = 'Unset' | 'NonSecure' | 'Secure';

export type PartitionKey = { readonly topLevelSite: string; readonly hasCrossSiteAncestor: boolean };

export type Cookie = {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number | null;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: SameSite | null;
  readonly partitionKey: PartitionKey | null;
  readonly priority: Priority | null;
  readonly scheme: Scheme | null;
  readonly port: number | null;
};

export type Reading = { readonly cookies: readonly Cookie[]; readonly unreadable: number };

export const hostOf = (domain: string): string => (domain.startsWith('.') ? domain.slice(1) : domain).toLowerCase();

export const keyOf = (cookie: Cookie): string =>
  [
    cookie.name,
    cookie.domain.toLowerCase(),
    cookie.path,
    cookie.partitionKey?.topLevelSite ?? '',
    cookie.partitionKey?.hasCrossSiteAncestor ?? '',
  ].join('\u0000');

export const siteOf = (raw: string): string | null => {
  if (!URL.canParse(raw)) return null;
  const site = new URL(raw);
  const plain =
    (site.protocol === 'http:' || site.protocol === 'https:') &&
    site.hostname !== '' &&
    site.username === '' &&
    site.password === '' &&
    site.port === '' &&
    site.pathname === '/' &&
    site.search === '' &&
    site.hash === '';
  return plain ? site.origin : null;
};
