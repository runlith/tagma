import { createRawSnippet, mount, unmount } from 'svelte';
import { expect, it } from 'vitest';

import Host from './test-utils/template-document/Host.svelte';

it("builds a component's elements in the document it mounts into", () => {
  const target = document.body.appendChild(document.createElement('div'));
  let owner: Document | null = null;
  const children = createRawSnippet(() => ({
    render: () => '<p></p>',
    setup: (node) => {
      owner = node.ownerDocument;
    },
  }));

  const host = mount(Host, { target, props: { children } });

  expect(owner).toBe(document);
  void unmount(host);
  target.remove();
});
