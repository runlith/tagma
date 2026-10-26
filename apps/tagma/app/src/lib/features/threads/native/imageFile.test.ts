import { expect, test } from 'vitest';
import { imageFileName } from './imageFile.js';

test.each([
  [{ mime: 'image/png', url: '/a', filename: 'logo.png' }, 'image/png', 'logo.png'],
  [{ mime: 'image/png', url: '/a', filename: 'Screenshot of the page' }, 'image/png', 'Screenshot of the page.png'],
  [{ mime: 'image/png', url: '/a', filename: 'photo.JPEG' }, 'image/jpeg', 'photo.JPEG'],
  [{ mime: 'image/png', url: '/a' }, 'image/webp', 'Image.webp'],
  [{ mime: 'image/webp', url: '/a', filename: 'draw' }, '', 'draw.webp'],
])('a saved picture is named after its label with the extension of the bytes served: %#', (image, served, expected) => {
  expect(imageFileName(image, served)).toBe(expected);
});
