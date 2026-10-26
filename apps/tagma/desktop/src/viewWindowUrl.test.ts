import { expect, test } from 'bun:test';
import { revealedUrl, surfacePage, viewWindowUrl } from './viewWindowUrl.js';

const surface = new URL('http://127.0.0.1:5173');

test('a view window opens only a view route of the surface', () => {
  expect(viewWindowUrl(surface, '/_desktop/view/tagma/doom/game')?.toString()).toBe('http://127.0.0.1:5173/_desktop/view/tagma/doom/game');
  expect(viewWindowUrl(surface, '/_desktop/view/../chat')).toBeNull();
  expect(viewWindowUrl(surface, '/chat')).toBeNull();
  expect(viewWindowUrl(surface, '//evil.example/_desktop/view/x')).toBeNull();
  expect(viewWindowUrl(surface, 'https://evil.example/_desktop/view/x')).toBeNull();
  expect(viewWindowUrl(surface, 42)).toBeNull();
});

test('a route of the surface is a page, while every resource the server serves, however spelled, is not', () => {
  expect(surfacePage(new URL('/tagma/chat/abc', surface))).toBe(true);
  expect(surfacePage(new URL('/api/files/preview?path=x', surface))).toBe(false);
  expect(surfacePage(new URL('/a/report', surface))).toBe(false);
  expect(surfacePage(new URL('/%61pi/threads/t/attachments/a', surface))).toBe(false);
});

test('a view asks the main window to show only an app route of the surface', () => {
  expect(revealedUrl(surface, '/tagma/chat/abc?branch=x')?.pathname).toBe('/tagma/chat/abc');
  expect(revealedUrl(surface, '//evil.example/chat')).toBeNull();
  expect(revealedUrl(surface, 'https://evil.example/chat')).toBeNull();
  expect(revealedUrl(surface, '/_desktop/dictation')).toBeNull();
  expect(revealedUrl(surface, '/tagma/../_desktop/dictation')).toBeNull();
  expect(revealedUrl(surface, '/%5fdesktop/dictation')).toBeNull();
  expect(revealedUrl(surface, '/%E0%A4%A')).toBeNull();
});
