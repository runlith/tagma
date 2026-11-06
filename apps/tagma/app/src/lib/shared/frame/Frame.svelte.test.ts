// @vitest-environment jsdom
import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import Frame from './Frame.svelte';

const framed = (props: Partial<ComponentProps<typeof Frame>> = {}) => {
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(Frame, { target, props: { src: 'https://site.example/', title: 'Site', ...props } });
  flushSync();
  const iframe = target.querySelector('iframe')!;
  return {
    iframe,
    done: () => {
      unmount(app);
      target.remove();
    },
  };
};

test('a frame without a protocol shows its page with the sandbox and allow of a plugin view, and media adds the devices', () => {
  const plain = framed();
  expect(plain.iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups');
  expect(plain.iframe.getAttribute('allow')).toBe('fullscreen; autoplay; encrypted-media; picture-in-picture');
  plain.done();

  const media = framed({ media: true });
  expect(media.iframe.getAttribute('allow')).toBe('fullscreen; autoplay; encrypted-media; picture-in-picture; camera; microphone');
  media.done();
});
