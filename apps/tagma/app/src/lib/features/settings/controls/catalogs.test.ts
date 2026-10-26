import { terminalThemeDark, terminalThemeLight } from '@tagma/server/executions/contract/wire/terminalAppearance';
import { expect, test } from 'vitest';
import { catalogTheme } from '$lib/shared/terminalThemes.js';
import { catalogEntries, catalogGroups, type ChoicesPort } from './catalogs.js';

const NO_MODELS: ChoicesPort = { entries: () => [] };

test('every terminal theme offered is a name the catalogue resolves', () => {
  const entries = catalogEntries('terminal-theme', NO_MODELS);
  expect(entries.length).toBeGreaterThan(0);

  for (const entry of entries) {
    expect(catalogTheme(entry.value), `${entry.value} is offered and not held`).toBeDefined();
  }
});

test('both theme keys can be set to what they fall back to', () => {
  const offered = catalogEntries('terminal-theme', NO_MODELS).map((entry) => entry.value);

  expect(offered).toContain(terminalThemeDark.fallback);
  expect(offered).toContain(terminalThemeLight.fallback);
});

test('the grouping holds every entry once, each under its own group', () => {
  const entries = catalogEntries('terminal-theme', NO_MODELS);
  const grouped = catalogGroups(entries).flatMap((group) => group.entries.map((entry) => ({ under: group.label, value: entry.value })));

  expect(grouped.map((row) => row.value).sort()).toEqual(entries.map((entry) => entry.value).sort());
  for (const row of grouped) {
    expect(entries.find((entry) => entry.value === row.value)?.group).toBe(row.under);
  }
});
