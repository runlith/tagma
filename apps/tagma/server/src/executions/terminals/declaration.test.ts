import { describe, expect, test } from 'bun:test';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { startDeclaration } from './declaration.js';

describe('startDeclaration', () => {
  const start = (
    over: {
      readonly lifetime?: 'call' | 'held';
      readonly transport?: 'pipes' | 'pty';
      readonly stdin?: 'pipe' | 'inherit' | 'ignore';
    } = {},
  ) =>
    startDeclaration({
      actor: Principal.make('starter'),
      operation: HostRequestKey.make('op-1'),
      lifetime: over.lifetime ?? 'held',
      transport: over.transport ?? 'pipes',
      stdin: over.stdin,
    });

  test('a declared written stdin on a held pipes start takes the starter binding', () => {
    const declared = start({ stdin: 'pipe' });
    expect(declared).toEqual({
      _tag: 'Interactive',
      interactive: { actor: Principal.make('starter'), binding: BindingId.make('start:op-1') },
    });
  });

  test('the same start without a declaration is bare', () => {
    expect(start()).toEqual({ _tag: 'Bare' });
  });

  test.each(['inherit', 'ignore'] as const)('a `%s` stdin declares nothing and is bare', (stdin) => {
    expect(start({ stdin })).toEqual({ _tag: 'Bare' });
  });

  test('a written stdin declared on a pty is refused, naming the pty', () => {
    const declared = start({ stdin: 'pipe', transport: 'pty' });
    expect(declared._tag).toBe('Refused');
    if (declared._tag !== 'Refused') return;
    expect(declared.refusal.code).toBe('terminal-start-no-lane');
    expect(declared.refusal.reason).toContain('pty');
  });

  test('a written stdin declared on a call-bound start is refused, naming the lifetime', () => {
    const declared = start({ stdin: 'pipe', lifetime: 'call' });
    expect(declared._tag).toBe('Refused');
    if (declared._tag !== 'Refused') return;
    expect(declared.refusal.code).toBe('terminal-start-no-lane');
    expect(declared.refusal.reason).toContain('call');
  });

  test('a pty start with no stdin is bare', () => {
    expect(start({ transport: 'pty' })).toEqual({ _tag: 'Bare' });
  });
});
