import { COMMIT_ID } from '@tagma/server/workspace/contract/wire/history';
import type { MarkedExtension } from 'marked';

const BARE = /(?<![\p{L}\p{N}_./\\:@#~-])[0-9a-f]{7,64}(?![\p{L}\p{N}_/\\-]|\.[\p{L}\p{N}])/gu;

export type CommitMatch = { readonly index: number; readonly raw: string };

export function* commitMatches(text: string): Generator<CommitMatch> {
  for (const hit of text.matchAll(BARE)) {
    if (/\d/.test(hit[0]) && /[a-f]/.test(hit[0])) yield { index: hit.index, raw: hit[0] };
  }
}

export const commitCodes: MarkedExtension = {
  renderer: {
    codespan({ text }: { text: string }) {
      return COMMIT_ID.test(text) ? `<code data-commit="${text}">${text}</code>` : false;
    },
  },
  extensions: [
    {
      name: 'commit',
      level: 'inline',
      start(src) {
        return commitMatches(src).next().value?.index;
      },
      tokenizer(src) {
        if (this.lexer.state.inLink) return undefined;
        const match = commitMatches(src).next().value;
        if (match?.index !== 0) return undefined;
        return { type: 'commit', raw: match.raw };
      },
      renderer(token) {
        return `<span data-commit="${token.raw}">${token.raw}</span>`;
      },
    },
  ],
};
