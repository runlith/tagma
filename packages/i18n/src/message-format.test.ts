import { describe, expect, test } from 'vitest';

import { MessageFormatError, parseMessage, renderMessage, type RenderContext } from './message-format.js';

function context(params: Record<string, unknown>, locale = 'ru'): RenderContext {
  return {
    params,
    resolveMissing: (name) => `{${name}}`,
    selectPluralCategory: (value, type) => new Intl.PluralRules(locale, { type }).select(value),
    formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
  };
}

function format(template: string, params: Record<string, unknown> = {}, locale = 'ru'): string {
  return renderMessage(parseMessage(template), context(params, locale));
}

const DAYS_RU = '{count, plural, one {# день} few {# дня} many {# дней} other {# дней}}';
const DAYS_EN = '{count, plural, one {# day} other {# days}}';

describe('parseMessage', () => {
  test('plain text is a single node', () => {
    expect(parseMessage('Просто текст')).toEqual([{ kind: 'text', value: 'Просто текст' }]);
  });

  test('reads a simple argument', () => {
    expect(parseMessage('Привет, {name}!')).toEqual([
      { kind: 'text', value: 'Привет, ' },
      { kind: 'arg', name: 'name' },
      { kind: 'text', value: '!' },
    ]);
  });

  test('argument names may carry dots and colons', () => {
    expect(parseMessage('{model.reward.bonus.fs} и {alias:appName}')).toEqual([
      { kind: 'arg', name: 'model.reward.bonus.fs' },
      { kind: 'text', value: ' и ' },
      { kind: 'arg', name: 'alias:appName' },
    ]);
  });

  test('tolerates whitespace around the argument header and selectors', () => {
    expect(format('{ count , plural , one {день}  other {дней} }', { count: 1 })).toBe('день');
  });

  test('keeps # as text outside a plural branch', () => {
    expect(format('#1 в списке')).toBe('#1 в списке');
  });

  test('keeps # as text inside a select branch', () => {
    expect(format('{kind, select, a {# нет} other {—}}', { kind: 'a' })).toBe('# нет');
  });

  describe('malformed templates', () => {
    const cases: Array<[string, string]> = [
      ['незакрытый аргумент', 'Привет, {name'],
      ['лишняя закрывающая', 'Привет}'],
      ['пустое имя', 'Привет, {}!'],
      ['неподдерживаемый тип', '{d, date, short}'],
      ['ветка без тела', '{count, plural, one}'],
      ['аргумент без веток', '{count, plural}'],
      ['незакрытая ветка', '{count, plural, one {день other {дней}}'],
    ];

    test.each(cases)('%s', (_name, template) => {
      expect(() => parseMessage(template)).toThrow(MessageFormatError);
    });
  });
});

describe('apostrophes (ICU 4.8)', () => {
  test('a lone apostrophe stays literal', () => {
    expect(format("Don't stop")).toBe("Don't stop");
    expect(format("Rock 'n' Roll")).toBe("Rock 'n' Roll");
  });

  test('a doubled apostrophe becomes one', () => {
    expect(format("Don''t")).toBe("Don't");
  });

  test('an apostrophe before a syntax character quotes it', () => {
    expect(format("'{'не аргумент'}'")).toBe('{не аргумент}');
    expect(format("'#' не число")).toBe('# не число');
  });

  test('an unterminated quote runs to the end', () => {
    expect(format("'{ хвост")).toBe('{ хвост');
  });
});

describe('plural', () => {
  test.each([
    [1, '1 день'],
    [2, '2 дня'],
    [4, '4 дня'],
    [5, '5 дней'],
    [11, '11 дней'],
    [14, '14 дней'],
    [21, '21 день'],
    [22, '22 дня'],
    [25, '25 дней'],
    [101, '101 день'],
    [0, '0 дней'],
  ])('ru: %i', (count, expected) => {
    expect(format(DAYS_RU, { count })).toBe(expected);
  });

  test.each([
    [0, '0 days'],
    [1, '1 day'],
    [2, '2 days'],
    [21, '21 days'],
  ])('en: %i', (count, expected) => {
    expect(format(DAYS_EN, { count }, 'en')).toBe(expected);
  });

  test('# is formatted for the locale', () => {
    const grouped = new Intl.NumberFormat('ru').format(1000);
    expect(format(DAYS_RU, { count: 1000 })).toBe(`${grouped} дней`);
    expect(format(DAYS_RU, { count: 1000 })).not.toBe('1000 дней');
  });

  test('an exact selector wins over its category', () => {
    const template = '{count, plural, =0 {ни одного} =1 {последний} one {# день} other {# дней}}';
    expect(format(template, { count: 0 })).toBe('ни одного');
    expect(format(template, { count: 1 })).toBe('последний');
    expect(format(template, { count: 3 })).toBe('3 дней');
  });

  test('a missing category falls back to other', () => {
    expect(format('{count, plural, one {день} other {дней}}', { count: 3 })).toBe('дней');
  });

  test('a message without other falls back to the first branch', () => {
    expect(format('{count, plural, one {день}}', { count: 5 })).toBe('день');
  });

  test('a non-numeric count renders the neutral branch', () => {
    expect(format(DAYS_RU, { count: 'много' })).toBe('# дней');
    expect(format(DAYS_RU, {})).toBe('# дней');
  });

  test('a numeric string counts as its number', () => {
    expect(format(DAYS_RU, { count: '2' })).toBe('2 дня');
  });

  test('the count is also readable as a named argument', () => {
    expect(format('{count, plural, one {{count} день} other {{count} дней}}', { count: 5 })).toBe('5 дней');
  });

  test('other arguments render inside a branch', () => {
    const template = '{count, plural, one {{name}: # день} other {{name}: # дней}}';
    expect(format(template, { count: 3, name: 'Бонус' })).toBe('Бонус: 3 дней');
  });
});

describe('selectordinal', () => {
  test.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [21, '21st'],
  ])('en: %i', (count, expected) => {
    const template = '{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
    expect(format(template, { count }, 'en')).toBe(expected);
  });
});

describe('select', () => {
  const template = '{gender, select, male {выиграл} female {выиграла} other {выиграли}}';

  test('picks the matching branch', () => {
    expect(format(template, { gender: 'male' })).toBe('выиграл');
    expect(format(template, { gender: 'female' })).toBe('выиграла');
  });

  test('falls back to other for an unknown or missing value', () => {
    expect(format(template, { gender: 'x' })).toBe('выиграли');
    expect(format(template, {})).toBe('выиграли');
  });
});

describe('nesting', () => {
  test('plural inside select', () => {
    const template =
      '{gender, select, male {Он выиграл {count, plural, one {# приз} other {# призов}}} other {Они выиграли {count, plural, one {# приз} other {# призов}}}}';

    expect(format(template, { gender: 'male', count: 1 })).toBe('Он выиграл 1 приз');
    expect(format(template, { gender: 'x', count: 5 })).toBe('Они выиграли 5 призов');
  });

  test('select inside plural, and # belongs to the nearest plural', () => {
    const template = '{count, plural, one {# {kind, select, fs {фриспин} other {бонус}}} other {# бонусов}}';

    expect(format(template, { count: 1, kind: 'fs' })).toBe('1 фриспин');
    expect(format(template, { count: 1, kind: 'x' })).toBe('1 бонус');
  });
});

describe('arguments', () => {
  test('an absent argument goes through resolveMissing', () => {
    expect(format('Значение: {x} {y}', { x: 1 })).toBe('Значение: 1 {y}');
  });

  test('zero and an empty string are present values, not missing ones', () => {
    expect(format('{x}|{y}', { x: 0, y: '' })).toBe('0|');
  });

  test('null renders as text, matching the previous interpolation', () => {
    expect(format('{x}', { x: null })).toBe('null');
  });

  test('every occurrence of an argument is replaced', () => {
    expect(format('{x} и ещё {x}', { x: 7 })).toBe('7 и ещё 7');
  });

  test('resolveMissing receives the bare name', () => {
    const seen: string[] = [];
    const rendered = renderMessage(parseMessage('{a} {b}'), {
      ...context({}),
      resolveMissing: (name) => {
        seen.push(name);
        return name.toUpperCase();
      },
    });

    expect(seen).toEqual(['a', 'b']);
    expect(rendered).toBe('A B');
  });
});
