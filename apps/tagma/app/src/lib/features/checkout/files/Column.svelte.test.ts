import { makeRouter, makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { Column } from './Column.svelte.js';

const point = { root: 'root-1' as never, path: 'src' };

test('a folder point stands while its navigation lands there, and a failed or diverted navigation drops it', async () => {
  let url = new URL('https://tagma.test/runlith');
  const landing = new Column(makeStorage(), makeRouter({ url: () => url, goto: async (href) => void (url = new URL(href, url)) }));
  await landing.point(point, '/runlith/checkout?view=tree');
  expect(landing.pointed).toBe(point);

  const failing = new Column(makeStorage(), makeRouter({ goto: () => Promise.reject(new Error('refused')) }));
  await expect(failing.point(point, '/runlith/checkout?view=tree')).rejects.toThrow('refused');
  expect(failing.pointed).toBeNull();

  const diverted = new Column(makeStorage(), makeRouter({ url: new URL('https://tagma.test/runlith/graph') }));
  await diverted.point(point, '/runlith/checkout?view=tree');
  expect(diverted.pointed).toBeNull();
});
