import type { ContentBlock } from '@runlith/acp/content';

export const textOf = (content: ReadonlyArray<ContentBlock>): string =>
  content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'resource_link':
          return `[${block.name}](${block.uri})`;
        case 'resource':
          return 'text' in block.resource ? block.resource.text : `[${block.resource.uri}]`;
        default:
          return `[${block.type}]`;
      }
    })
    .join('');
