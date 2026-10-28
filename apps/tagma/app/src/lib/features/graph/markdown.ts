import { BLOCK_REF, DEAD_REF } from '@tagma/server/graph/contract/wire/references';
import { THREAD_REF } from '@tagma/server/threads/contract/wire/references';
import { PROJECT_REF } from '@tagma/server/projects/contract/wire/references';
import { escapeHtml } from '@runlith/utils/text';
import type { MarkedExtension, Token, Tokens } from 'marked';
import { type MarkdownHtml, MarkdownRenderer } from '@runlith/markdown/render';
import { pathCodes } from '$lib/features/opening/pathCode.js';
import { commitCodes } from '$lib/features/checkout/commitCode.js';
import type { Addresses } from '$lib/features/workspace/Addresses.js';
import type { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';

import { readRef, type RefKind } from './references.js';

type RefToken = { type: 'ref'; raw: string; kind: RefKind; target: string; tokens?: Token[] };

function renderRef(addresses: Addresses, kind: RefKind, target: string, labelHtml: string | undefined): string {
  if (kind === 'project') {
    const labelled = labelHtml === undefined ? '' : ' data-project-label';
    return `<a data-project-ref="${target}"${labelled}>${labelHtml ?? `project ${target}`}</a>`;
  }
  if (kind === 'thread') {
    const labelled = labelHtml === undefined ? '' : ' data-thread-label';
    return `<a href="${addresses.thread(target)}" data-thread-ref="${target}"${labelled}>${labelHtml ?? target}</a>`;
  }
  const labelled = labelHtml === undefined ? '' : ' data-block-label';
  return `<a href="${addresses.block(target)}" data-block-ref="${target}"${labelled}>${labelHtml ?? target}</a>`;
}

const refLinks = (addresses: Addresses): MarkedExtension => ({
  renderer: {
    codespan({ text }: { text: string }) {
      const ref = readRef(text);
      if (!ref || ref.raw !== text) return false;
      return renderRef(addresses, ref.kind, ref.target, ref.label === undefined ? undefined : escapeHtml(ref.label));
    },
  },
  extensions: [
    {
      name: 'ref',
      level: 'inline',
      start(src: string): number | undefined {
        const index = src.indexOf('[[');
        return index < 0 ? undefined : index;
      },
      tokenizer(src: string): RefToken | undefined {
        const ref = readRef(src);
        if (!ref) return undefined;
        const token = { type: 'ref', raw: ref.raw, kind: ref.kind, target: ref.target } as const;
        if (ref.label === undefined) return token;
        const outer = this.lexer.state.inLink;
        this.lexer.state.inLink = true;
        const tokens = this.lexer.inlineTokens(ref.label);
        this.lexer.state.inLink = outer;
        return { ...token, tokens };
      },
      renderer(token) {
        const { kind, target, tokens } = token as RefToken;
        return renderRef(addresses, kind, target, tokens === undefined ? undefined : this.parser.parseInline(tokens));
      },
    },
  ],
});

const artifactLinks = (origin: ServerOrigin): MarkedExtension => ({
  renderer: {
    link(token: Tokens.Link) {
      const href = origin.artifact(token.href);
      if (href === null) return false;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      const text = this.parser.parseInline(token.tokens);
      return `<a href="${escapeHtml(href)}"${title} class="external-link" target="_blank" rel="noopener noreferrer" data-artifact>${text}</a>`;
    },
  },
});

const refAtoms: readonly RegExp[] = [BLOCK_REF, THREAD_REF, PROJECT_REF, DEAD_REF];

const renderers = new WeakMap<ServerOrigin, WeakMap<Addresses, MarkdownRenderer>>();

function rendererOf(origin: ServerOrigin, addresses: Addresses): MarkdownRenderer {
  const byAddresses = renderers.get(origin) ?? new WeakMap<Addresses, MarkdownRenderer>();
  renderers.set(origin, byAddresses);
  const held = byAddresses.get(addresses);
  if (held !== undefined) return held;
  const made = new MarkdownRenderer({ extensions: [pathCodes, commitCodes, refLinks(addresses), artifactLinks(origin)], atoms: refAtoms });
  byAddresses.set(addresses, made);
  return made;
}

export function renderBody(
  markdown: string,
  input: { key: string | undefined; streaming: boolean },
  origin: ServerOrigin,
  addresses: Addresses,
): MarkdownHtml[] {
  return rendererOf(origin, addresses).render({ text: markdown, key: input.key, streaming: input.streaming });
}
