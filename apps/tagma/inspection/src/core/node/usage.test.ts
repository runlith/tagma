import { describe, expect, it } from 'bun:test';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import type { Tree } from '@runlith/code-facts/tree';
import { catalogOf } from '../catalog';
import type { Pack } from '../rule';
import { projectFacts } from './usage';

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => path in texts,
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new UnsupportedSource(path, 'unread');
    return text;
  },
  paths: () => Object.keys(texts),
});

const rule = (id: string) => ({ id }) as unknown as Pack['rules'][number];

const shipped = catalogOf([
  { id: 'always', uses: {}, rules: [rule('a')] },
  { id: 'scripts', uses: { languages: ['js'] }, rules: [rule('b')] },
  { id: 'effects', uses: { packages: ['effect'] }, rules: [rule('c')] },
] as const satisfies readonly Pack[]);

describe('the packs a tree uses', () => {
  it('takes a pack with no condition always, a language pack where a file of it stands, and a package pack where a manifest names it', () => {
    expect(shipped.used(projectFacts(tree({ 'README.md': '' })))).toEqual(['always']);
    expect(shipped.used(projectFacts(tree({ 'src/main.ts': '', 'package.json': '{"name":"app"}' })))).toEqual(['always', 'scripts']);
    expect(shipped.used(projectFacts(tree({ 'packages/a/package.json': '{"name":"a","devDependencies":{"effect":"*"}}' })))).toEqual([
      'always',
      'effects',
    ]);
    expect(shipped.used(projectFacts(tree({ 'packages/effect/package.json': '{"name":"effect"}' })))).toEqual(['always', 'effects']);
  });

  it('refuses a manifest it cannot read rather than answering the pack absent', () => {
    expect(() => projectFacts(tree({ 'package.json': '{' }))).toThrow(UnsupportedSource);
    expect(() => projectFacts(tree({ 'package.json': '{"dependencies":["effect"]}' }))).toThrow(UnsupportedSource);
    expect(() => projectFacts({ has: () => false, read: () => '' })).toThrow(UnsupportedSource);
  });
});
