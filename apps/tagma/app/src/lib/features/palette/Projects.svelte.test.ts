// @vitest-environment jsdom
import { stubFamily } from '@runlith/query/testing';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { PaletteModel } from './Palette.svelte.js';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function palette(): PaletteModel {
  const projects = ['runlith', 'orbit', 'polygon-orbit'].map((name, index) => ({ id: index + 1, name }));
  let model!: PaletteModel;
  stops.push(
    $effect.root(() => {
      model = new PaletteModel(
        { projects, active: null, contextProject: null } as never,
        { declared: [], statuses: [] } as never,
        { threads: stubFamily(), blocks: stubFamily(), commits: stubFamily() } as never,
        { catalog: stubFamily() } as never,
        () => [],
        () => ({}) as never,
        { aim: () => null },
        {} as never,
      );
    }),
  );
  flushSync();
  return model;
}

const found = (model: PaletteModel) =>
  model.sections.flatMap((section) => section.rows.flatMap((row) => (row.kind === 'project' ? [row.project.name] : [])));

test('a query finds registered projects by name, the ones it starts first, without a project open', () => {
  const model = palette();

  model.query = 'ORBI';
  expect(model.sections[0]?.group).toBe('projects');
  expect(found(model)).toEqual(['orbit', 'polygon-orbit']);

  model.query = 'nothing';
  expect(found(model)).toEqual([]);
});

test('an empty query lists projects only under their own chip', () => {
  const model = palette();
  expect(found(model)).toEqual([]);

  model.chip = 'projects';
  expect(found(model)).toEqual(['runlith', 'orbit', 'polygon-orbit']);
});
