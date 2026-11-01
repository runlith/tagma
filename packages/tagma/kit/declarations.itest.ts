import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { RULE_SOURCES } from '@runlith/tagma/sources';
import { declarationsOf } from './declarations.js';
import { ruleSignatures } from './rules.js';

test('the published rules declarations expand every private type, wherever the doors use it', async () => {
  const doors = Object.entries(RULE_SOURCES).map(([key, url]) => ({ key, source: fileURLToPath(url) }));
  const declarations = await declarationsOf(doors);
  for (const text of Object.values(declarations)) expect(text).not.toContain('@tagma/');
  expect(declarations['@runlith/tagma/rules']).toContain("readonly mode?: ('change' | 'measure');");
  expect((await ruleSignatures()).defineProgram).toContain("readonly mode?: ('change' | 'measure');");
});
