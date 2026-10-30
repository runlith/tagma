import type { McpDeclarationStart } from '$lib/features/mcp/Repo.js';

export type Address =
  | { readonly kind: 'empty' }
  | { readonly kind: 'source'; readonly source: string }
  | { readonly kind: 'service'; readonly start: McpDeclarationStart }
  | { readonly kind: 'program'; readonly start: McpDeclarationStart };

const HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
const SHORT = /^[\w.-]+\/[\w.-]+$/u;
const LOCAL = /^(?:\/|~|\.{1,2}\/|[A-Za-z]:[\\/])/u;

const nameOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'server';

export function addressOf(typed: string): Address {
  const text = typed.trim();
  if (text === '') return { kind: 'empty' };
  if (SHORT.test(text)) return { kind: 'source', source: `https://github.com/${text}.git` };
  if (URL.canParse(text) && /^https?:$/u.test(new URL(text).protocol)) {
    const url = new URL(text);
    if (url.pathname.endsWith('.git') || HOSTS.includes(url.host)) return { kind: 'source', source: text };
    const label = url.host.split('.').filter((part) => !['www', 'mcp', 'api'].includes(part))[0] ?? url.host;
    return { kind: 'service', start: { transport: 'http', name: nameOf(label), url: text } };
  }
  if (LOCAL.test(text) || !/\s/u.test(text)) return { kind: 'source', source: text };
  const [command = '', ...rest] = text.split(/\s+/u);
  const named = rest.find((word) => !word.startsWith('-')) ?? command;
  return {
    kind: 'program',
    start: {
      transport: 'stdio',
      name: nameOf(
        named
          .split('/')
          .at(-1)
          ?.replace(/@[^@]*$/u, '') ?? named,
      ),
      command,
      args: rest.join(' '),
    },
  };
}
