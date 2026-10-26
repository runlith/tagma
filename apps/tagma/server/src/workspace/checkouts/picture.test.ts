import { describe, expect, test } from 'bun:test';
import { pictureType } from './picture.js';

describe('pictureType', () => {
  test('names the picture kinds a browser draws', () => {
    expect(pictureType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(pictureType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(pictureType(Uint8Array.from([...'GIF89a'].map((char) => char.charCodeAt(0))))).toBe('image/gif');
    expect(pictureType(Uint8Array.from([0x00, 0x00, 0x01, 0x00]))).toBe('image/x-icon');
  });

  test('an SVG is named by its root element, however the file opens', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(pictureType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(pictureType(bytes('\uFEFF<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg>\n<svg></svg>'))).toBe('image/svg+xml');
    expect(pictureType(bytes('<svgish></svgish>'))).toBeNull();
    expect(pictureType(bytes('<html><svg></svg></html>'))).toBeNull();
  });

  test('text answers no picture', () => {
    expect(pictureType(Uint8Array.from([0x68, 0x69]))).toBeNull();
    expect(pictureType(new Uint8Array(0))).toBeNull();
  });
});
