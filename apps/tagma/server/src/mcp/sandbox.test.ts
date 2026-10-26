import { expect, test } from 'bun:test';
import { sandboxPolicy } from './sandbox.js';

const FRAMERS = 'http://127.0.0.1:*';

const directives = (policy: string): ReadonlyMap<string, readonly string[]> =>
  new Map(
    policy.split(';').map((part) => {
      const [name = '', ...sources] = part.trim().split(/\s+/u);
      return [name, sources];
    }),
  );

test('a view that declares nothing reaches no network, no frame and no plugin, and may run wasm', () => {
  const policy = directives(sandboxPolicy({}, FRAMERS));
  expect(policy.get('connect-src')).toEqual(["'none'"]);
  expect(policy.get('frame-src')).toEqual(["'none'"]);
  expect(policy.get('object-src')).toEqual(["'none'"]);
  expect(policy.get('base-uri')).toEqual(["'self'"]);
  expect(policy.get('script-src')).toContain("'wasm-unsafe-eval'");
  expect(policy.get('worker-src')).toContain('blob:');
});

test('declared domains reach their directives and an entry that would inject a source or a directive is dropped', () => {
  const policy = directives(
    sandboxPolicy(
      {
        connectDomains: ['https://api.example.com', "https://x.example 'unsafe-eval'", 'wss://live.example.com'],
        resourceDomains: ['https://*.cdn.example.com', 'https://evil.example; script-src *'],
        frameDomains: ['https://player.example.com'],
      },
      FRAMERS,
    ),
  );
  expect(policy.get('connect-src')).toEqual(['https://api.example.com', 'wss://live.example.com']);
  expect(policy.get('img-src')).toContain('https://*.cdn.example.com');
  expect(policy.get('script-src')).not.toContain('*');
  expect(policy.get('frame-src')).toEqual(['https://player.example.com']);
  expect([...policy.keys()].filter((name) => name === 'script-src')).toHaveLength(1);
});

test('no declaration opens this machine or a bare address to a view', () => {
  const policy = directives(
    sandboxPolicy(
      {
        connectDomains: ['ws://127.0.0.1:5633', 'http://localhost:5633', '*.0.0.1', 'https://app.localhost', '10.0.0.5:80'],
        resourceDomains: ['http://127.0.0.1:5634'],
      },
      FRAMERS,
    ),
  );
  expect(policy.get('connect-src')).toEqual(["'none'"]);
  expect(policy.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
});
