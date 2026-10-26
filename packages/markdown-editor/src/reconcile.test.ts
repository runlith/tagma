import { describe, expect, test } from 'vitest';
import { reconcileMarkdown } from './reconcile.js';

describe('reconcileMarkdown', () => {
  test('no semantic change returns the original bytes verbatim', () => {
    const original = '*   old-style   list\n- another\n';
    const canonical = '- old-style list\n- another\n';
    const result = reconcileMarkdown({
      originalSource: original,
      baseCanonical: canonical,
      edited: canonical,
      roundTrip: () => {
        throw new Error('must not re-parse when nothing changed');
      },
    });
    expect(result).toBe(original);
  });

  test('an edit lands in place while untouched non-canonical lines keep their bytes', () => {
    const original = '* star bullet stays\n\nsecond paragraph\n';
    const base = '- star bullet stays\n\nsecond paragraph\n';
    const edited = '- star bullet stays\n\nsecond paragraph grew\n';
    const result = reconcileMarkdown({
      originalSource: original,
      baseCanonical: base,
      edited,
      roundTrip: (value) => value.replace(/^\* /m, '- '),
    });
    expect(result).toBe('* star bullet stays\n\nsecond paragraph grew\n');
  });

  test('a failed render-equivalence proof falls back to the canonical edit', () => {
    const original = '* star bullet\n';
    const base = '- star bullet\n';
    const edited = '- star bullet edited\n';
    const result = reconcileMarkdown({
      originalSource: original,
      baseCanonical: base,
      edited,
      roundTrip: () => null,
    });
    expect(result).toBe(edited);
  });

  test('a CRLF source keeps its CRLF endings through an edit', () => {
    const original = 'first line\r\n\r\nsecond line\r\n';
    const base = 'first line\n\nsecond line\n';
    const edited = 'first line\n\nsecond line grew\n';
    const result = reconcileMarkdown({
      originalSource: original,
      baseCanonical: base,
      edited,
      roundTrip: (value) => value,
    });
    expect(result).toBe('first line\r\n\r\nsecond line grew\r\n');
  });
});
