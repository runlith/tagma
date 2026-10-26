import { describe, expect, it, vi } from 'vitest';
import { ConsoleErrorBoundaryReporter } from './reporter.js';

describe('ConsoleErrorBoundaryReporter', () => {
  it('dedups reports within a time window', () => {
    const now = vi.fn<() => number>();
    now.mockReturnValueOnce(1_000);
    now.mockReturnValueOnce(1_500);

    const reporter = new ConsoleErrorBoundaryReporter({ dedupWindowMs: 1_000, now });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = reporter.report(new Error('boom'), {
      id: 'acme:slot:x',
      context: { owner: 'acme', routeKey: '/', buildId: 'build-1' },
    });

    const second = reporter.report(new Error('boom'), {
      id: 'acme:slot:x',
      context: { owner: 'acme', routeKey: '/', buildId: 'build-1' },
    });

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(second.errorId).toBe(first.errorId);
    expect(second.suppressedCount).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('stops deduping after the window expires', () => {
    const now = vi.fn<() => number>();
    now.mockReturnValueOnce(10_000);
    now.mockReturnValueOnce(10_500);
    now.mockReturnValueOnce(12_000);

    const reporter = new ConsoleErrorBoundaryReporter({ dedupWindowMs: 1_000, now });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = reporter.report('boom', {
      id: 'acme:slot:x',
      context: { owner: 'acme', routeKey: '/', buildId: 'build-1' },
    });

    const second = reporter.report('boom', {
      id: 'acme:slot:x',
      context: { owner: 'acme', routeKey: '/', buildId: 'build-1' },
    });

    const third = reporter.report('boom', {
      id: 'acme:slot:x',
      context: { owner: 'acme', routeKey: '/', buildId: 'build-1' },
    });

    expect(first.suppressed).toBe(false);
    expect(second.suppressed).toBe(true);
    expect(third.suppressed).toBe(false);
    expect(third.errorId).toBe(first.errorId);
    expect(errorSpy).toHaveBeenCalledTimes(2);

    errorSpy.mockRestore();
  });
});
