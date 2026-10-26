import { expect, test } from 'bun:test';
import type { Cookie } from './cookie.js';
import { planImport } from './policy.js';

const cookie = (domain: string, name: string, expires: number | null = null): Cookie => ({
  name,
  value: 'v',
  domain,
  path: '/',
  expires,
  secure: true,
  httpOnly: false,
  sameSite: null,
  partitionKey: null,
  priority: null,
  scheme: null,
  port: null,
});

test('the plan keeps google.com out and replaces imported domains with their parents and children inside the registrable domain', () => {
  const plan = planImport(
    [
      cookie('.google.com', 'SID'),
      cookie('accounts.google.com', 'LSID'),
      cookie('app.example.com', 'a'),
      cookie('alice.github.io', 'pages'),
      cookie('.gone.example', 'old', 10),
    ],
    100,
  );
  expect(plan.google).toBe(2);
  expect(plan.cookies.map((held) => held.name)).toEqual(['a', 'pages']);
  expect(plan.domains).toEqual(['alice.github.io', 'example.com']);
  expect(
    ['.example.com', 'app.example.com', 'deep.app.example.com', 'other.example.com', 'bob.github.io', '.github.io'].map(plan.covers),
  ).toEqual([true, true, true, false, false, false]);
});
