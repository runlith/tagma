const SEARCH = 'https://www.google.com/search?q=';

const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/iu;

const DOMAIN = /^[^\s/:]+\.[a-z][a-z0-9-]+(:\d+)?([/?#].*)?$/iu;

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/iu;

const SEARCH_ORIGIN = new URL(SEARCH).origin;

export type Search = { readonly kind: 'search'; readonly url: string; readonly query: string };

export type Target = { readonly kind: 'go'; readonly url: string } | Search;

export type AddressParts = {
  readonly scheme: string;
  readonly host: string;
  readonly rest: string;
  readonly query: string | null;
};

export type Completion = { readonly text: string; readonly url: string };

export const searchOf = (query: string): Search => ({ kind: 'search', url: `${SEARCH}${encodeURIComponent(query)}`, query });

export const targetOf = (typed: string): Target | null => {
  const text = typed.trim();
  if (text === '') return null;
  if (/^(https?:\/\/|about:|blob:)/iu.test(text)) return { kind: 'go', url: text };
  if (/\s/u.test(text)) return searchOf(text);
  if (LOCAL.test(text)) return { kind: 'go', url: `http://${text}` };
  if (DOMAIN.test(text)) return { kind: 'go', url: `https://${text}` };
  return searchOf(text);
};

export const addressOf = (typed: string): string | null => targetOf(typed)?.url ?? null;

export const editable = (url: string): string => (url === 'about:blank' ? '' : url);

const web = (url: string): URL | null => {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
};

const decoded = (text: string): string => {
  try {
    return decodeURI(text);
  } catch (error) {
    if (error instanceof URIError) return text;
    throw error;
  }
};

const bare = (host: string): string => host.replace(/^www\./iu, '');

export const partsOf = (url: string): AddressParts => {
  const parsed = web(url);
  if (parsed === null) return { scheme: '', host: url, rest: '', query: null };
  const plain = parsed.protocol === 'https:' || LOOPBACK.test(parsed.hostname);
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return {
    scheme: plain ? '' : `${parsed.protocol}//`,
    host: bare(parsed.host),
    rest: decoded(`${path}${parsed.search}${parsed.hash}`),
    query: parsed.origin === SEARCH_ORIGIN && parsed.pathname === '/search' ? parsed.searchParams.get('q') : null,
  };
};

export const shownOf = (url: string): string => {
  const parts = partsOf(url);
  return `${parts.scheme}${parts.host}${parts.rest}`;
};

export const originOf = (url: string): string | null => web(url)?.origin ?? null;

export const hrefOf = (url: string): string => web(url)?.href ?? url;

export const completion = (typed: string, urls: Iterable<string>): Completion | null => {
  if (typed === '' || /[\s/]/u.test(typed)) return null;
  const lower = typed.toLowerCase();
  for (const url of urls) {
    const parsed = web(url);
    if (parsed === null) continue;
    const host = [bare(parsed.host), parsed.host].find((form) => form.length > typed.length && form.toLowerCase().startsWith(lower));
    if (host !== undefined) return { text: typed + host.slice(typed.length), url: `${parsed.origin}/` };
  }
  return null;
};
