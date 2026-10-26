export type CookieSameSite = 'lax' | 'strict' | 'none';
export type CookiePriority = 'low' | 'medium' | 'high';

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAgeSeconds?: number;
  expires?: Date;
  sameSite?: CookieSameSite;
  secure?: boolean;
  partitioned?: boolean;
  priority?: CookiePriority;
}

export type CookieDeleteOptions = Pick<CookieOptions, 'path' | 'domain' | 'sameSite' | 'secure' | 'partitioned' | 'priority'>;

const MAX_COOKIE_STRING_LENGTH = 4096;
const MAX_COOKIE_ATTRIBUTE_VALUE_LENGTH = 1024;

function assertCookieAttributeValueLength(attributeName: string, value: string): void {
  if (value.length <= MAX_COOKIE_ATTRIBUTE_VALUE_LENGTH) return;
  throw new Error(
    `Cookies: attribute "${attributeName}" is too long (${value.length} chars). Browsers may ignore it, causing unexpected cookie behavior.`,
  );
}

function normalizePath(path: string | undefined): string {
  const resolved = path ?? '/';
  if (!resolved.startsWith('/')) {
    throw new Error(`Cookies: invalid path "${resolved}". Expected it to start with "/".`);
  }
  assertCookieAttributeValueLength('Path', resolved);
  return resolved;
}

function assertCookieName(name: string): void {
  if (!name) throw new Error('Cookies: name is empty.');
  if (/[;\s=]/.test(name)) {
    throw new Error(`Cookies: invalid name "${name}". It must not contain whitespace, ";" or "=".`);
  }

  if (name.startsWith('__Http-') || name.startsWith('__Host-Http-')) {
    throw new Error(`Cookies: "${name}" cannot be set from browser JS (HttpOnly prefix).`);
  }
}

function assertCookiePrefixInvariants(args: { name: string; path: string; domain: string | undefined; secure: boolean }): void {
  const { name, path, domain, secure } = args;

  if (name.startsWith('__Secure-') && !secure) {
    throw new Error(`Cookies: "${name}" requires secure=true (prefix "__Secure-").`);
  }

  if (!name.startsWith('__Host-')) return;

  if (!secure) throw new Error(`Cookies: "${name}" requires secure=true (prefix "__Host-").`);
  if (domain !== undefined) throw new Error(`Cookies: "${name}" must NOT set "domain" (prefix "__Host-").`);
  if (path !== '/') throw new Error(`Cookies: "${name}" requires path="/" (prefix "__Host-").`);
}

function formatSameSite(sameSite: CookieSameSite): string {
  switch (sameSite) {
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    case 'none':
      return 'None';
  }
}

function formatPriority(priority: CookiePriority): string {
  switch (priority) {
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
  }
}

export function normalizeMaxAgeSeconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Cookies: invalid maxAgeSeconds "${String(value)}". Expected a finite number.`);
  }
  const intValue = Math.trunc(value);
  if (intValue < 0) throw new Error('Cookies: maxAgeSeconds must be >= 0.');
  return intValue;
}

function assertDomain(domain: string | undefined): void {
  if (domain === undefined) return;
  if (!domain) throw new Error('Cookies: domain is empty.');
  if (/[;\s]/.test(domain)) {
    throw new Error(`Cookies: invalid domain "${domain}". It must not contain whitespace or ";".`);
  }
  assertCookieAttributeValueLength('Domain', domain);
}

function assertExpires(expires: Date | undefined): void {
  if (expires === undefined) return;
  if (!Number.isFinite(expires.getTime())) throw new Error('Cookies: invalid expires Date.');
  assertCookieAttributeValueLength('Expires', expires.toUTCString());
}

export function parseCookieString(cookieString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieString) return result;

  for (const part of cookieString.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    if (!name) continue;

    result[name] = decodeCookieValue(trimmed.slice(eqIndex + 1).trim());
  }

  return result;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieName(name);

  const path = normalizePath(options.path);
  assertDomain(options.domain);
  assertExpires(options.expires);

  const sameSite = options.sameSite ?? 'lax';
  const secure = options.secure ?? false;
  const partitioned = options.partitioned ?? false;
  const maxAgeSeconds = normalizeMaxAgeSeconds(options.maxAgeSeconds);

  if (sameSite === 'none' && !secure) {
    throw new Error('Cookies: SameSite=None requires secure=true in modern Chrome.');
  }

  if (partitioned) {
    if (sameSite !== 'none') throw new Error('Cookies: partitioned cookies require sameSite="none".');
    if (!secure) throw new Error('Cookies: partitioned cookies require secure=true.');
  }

  assertCookiePrefixInvariants({ name, path, domain: options.domain, secure });

  const parts: string[] = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${formatSameSite(sameSite)}`];

  if (options.domain !== undefined) parts.push(`Domain=${options.domain}`);
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${String(maxAgeSeconds)}`);
  if (options.expires !== undefined) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (secure) parts.push('Secure');
  if (partitioned) parts.push('Partitioned');
  if (options.priority !== undefined) parts.push(`Priority=${formatPriority(options.priority)}`);

  const cookieString = parts.join('; ');
  if (cookieString.length > MAX_COOKIE_STRING_LENGTH) {
    throw new Error(`Cookies: serialized cookie is too large (${cookieString.length} chars). Browsers typically limit a cookie to ~4KB.`);
  }

  return cookieString;
}
