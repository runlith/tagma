import { expect, test } from 'vitest';
import { browserPlatform } from './browser.js';

const written = (key: string | null, newValue: string | null, storageArea: Storage = localStorage): void =>
  void window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue, storageArea }));

test('a write another window makes to the watched key reaches this window, a removal or a clear as null', () => {
  const { storage } = browserPlatform();
  const heard: (string | null)[] = [];
  const stop = storage.local.watch('tagma.strip', (value) => heard.push(value));

  written('tagma.strip', '{"order":[1]}');
  written('tagma.places', '{}');
  written('tagma.strip', '{}', sessionStorage);
  written('tagma.strip', null);
  written(null, null);
  stop();
  written('tagma.strip', 'after');

  expect(heard).toEqual(['{"order":[1]}', null, null]);
});
