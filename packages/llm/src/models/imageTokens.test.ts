import { describe, expect, test } from 'bun:test';
import { modelImageTokens } from './imageTokens';

describe('modelImageTokens', () => {
  test('dimensions give the provider own relation', () => {
    expect(modelImageTokens({ size: { width: 1024, height: 768 } })).toBe(1_049);
    expect(modelImageTokens({ size: { width: 64, height: 64 } })).toBe(5);
  });

  test('a picture past what the provider bills stops growing', () => {
    const huge = modelImageTokens({ size: { width: 8_000, height: 8_000 } });
    const beyond = modelImageTokens({ size: { width: 16_000, height: 16_000 } });
    expect(huge).toBe(beyond);
  });

  test('without dimensions the encoded size is a floor, not a claim', () => {
    expect(modelImageTokens({ byteLength: 750_000 })).toBe(1_000);
    expect(modelImageTokens({})).toBe(0);
  });
});
