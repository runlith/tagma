import { Schema } from 'effect';
import { TAGMA_APP_ID_PATTERN } from '../../../tagma-apps/contract/wire/manifest.js';

export const TAGMA_APP_CAPABILITY_PREFIX = 'app:';

export const tagmaAppCapability = (app: string): string => `${TAGMA_APP_CAPABILITY_PREFIX}${app}`;

export const tagmaAppAgentId = (app: string, agent: string): string => `${app}.${agent}`;

export const TagmaAppAgentEntry = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(TAGMA_APP_ID_PATTERN), Schema.isMaxLength(40)).annotate({
    description: 'The agent inside the app; Tagma offers it as <app>.<id>.',
  }),
  path: Schema.String.check(Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/u)).annotate({
    description:
      'Its definition, a Markdown file with frontmatter, relative to the app directory. It names its capabilities; app:<app> is added to them.',
  }),
});
export type TagmaAppAgentEntry = typeof TagmaAppAgentEntry.Type;

export const TagmaAppAgentEntries = Schema.Array(TagmaAppAgentEntry).check(
  Schema.makeFilter((entries: readonly TagmaAppAgentEntry[]) => {
    const seen = new Set<string>();
    for (const { id } of entries) {
      if (seen.has(id)) return `the agent ${id} is listed twice`;
      seen.add(id);
    }
    return true;
  }),
);
export type TagmaAppAgentEntries = typeof TagmaAppAgentEntries.Type;
