import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ToolAnswer, type ToolOutputSource, type ToolShown } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { boundDisplayText, TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import { utf8ByteLength } from '@runlith/utils/utf8';
import type { RemovalReport, RemovalResult } from './model';

export const makeReport = Effect.fn('DeleteTool.report')(function* (directory: string, verbose: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const counts: Record<RemovalResult['status'], number> = { removed: 0, absent: 0, skipped: 0, failed: 0, unprocessed: 0, unknown: 0 };
  let rows: RemovalResult[] = [];
  let bytes = 0;
  let source: ToolOutputSource | undefined;
  let sealed = false;
  let retained = false;
  let pending = 0;
  let detailBytes = 0;
  const details: string[] = [];
  const shown: ToolShown[] = [];

  const count = (row: RemovalResult): void => {
    counts[row.status]++;
    if (row.record === 'pending') pending++;
  };

  const append = Effect.fn('DeleteTool.reportAppend')(function* (row: RemovalResult) {
    count(row);
    if (row.status === 'removed' || (row.removed ?? 0) > 0) shown.push({ path: row.path, entry: true, as: 'wrote' });
    yield* listed(row, true);
  });

  const entry = (row: RemovalResult): Effect.Effect<void, PlatformError> => {
    count(row);
    return verbose || row.status !== 'removed' || row.record === 'pending' ? listed(row, false) : Effect.void;
  };

  const listed = Effect.fnUntraced(function* (row: RemovalResult, root: boolean) {
    rows.push(row);
    const line = JSON.stringify(row);
    const size = utf8ByteLength(line) + 1;
    if (
      (root || verbose || row.status === 'failed' || row.status === 'unknown' || row.status === 'skipped' || row.record === 'pending') &&
      detailBytes < TOOL_OUTPUT_MAX_BYTES
    ) {
      details.push(boundDisplayText(line));
      detailBytes += size;
    }
    bytes += size;
    if (source === undefined && bytes <= TOOL_OUTPUT_MAX_BYTES) return;
    const text = rows.map((one) => JSON.stringify(one)).join('\n') + '\n';
    if (source === undefined) {
      const path = yield* fs.makeTempFile({ directory, prefix: 'tagma-delete-', suffix: '.jsonl' });
      source = {
        path,
        byteLength: 0,
        lineCount: 0,
        format: 'text',
        retained: () => {
          retained = true;
        },
      };
    }
    yield* fs.writeFileString(source.path, text, { flag: 'a' });
    source = { ...source, byteLength: source.byteLength + utf8ByteLength(text), lineCount: source.lineCount + rows.length };
    rows = [];
    bytes = 0;
  });

  const statusOf = (ending: RemovalReport['status']): RemovalReport['status'] =>
    ending === 'completed' && (counts.failed > 0 || pending > 0) ? 'partial' : ending;

  const snapshot = (ending: RemovalReport['status'], display?: ToolDisplay, notice?: string) => {
    const status = statusOf(ending);
    const report: RemovalReport = { status, counts: { ...counts }, pendingConfirmations: pending, results: rows, reportPath: source?.path };
    const summary = `Deletion ${status}: ${counts.removed} removed, ${counts.absent} absent, ${counts.skipped} skipped, ${counts.failed} failed, ${counts.unprocessed} unprocessed, ${counts.unknown} unknown.${notice === undefined ? '' : ` ${notice}`}`;
    const text = `${summary}${pending > 0 ? ` ${pending} record confirmations pending.` : ''}${details.length === 0 ? '' : `\n${boundDisplayText(details.join('\n'))}`}${source === undefined ? '' : `\nComplete JSON Lines report: ${source.path}.`}`;
    return new ToolAnswer(report, display, {
      text,
      source: verbose ? source : undefined,
      shown,
      ...(status === 'cancelled' || status === 'unknown'
        ? { ending: status }
        : status === 'partial'
          ? { refusal: { code: 'partial-deletion', reason: summary } }
          : {}),
    });
  };

  const answer = Effect.fn('DeleteTool.reportAnswer')(function* (ending: RemovalReport['status'], display?: ToolDisplay) {
    if (source !== undefined && !sealed) {
      const text = JSON.stringify({ status: statusOf(ending), counts, pendingConfirmations: pending }) + '\n';
      yield* fs.writeFileString(source.path, text, { flag: 'a' });
      source = { ...source, byteLength: source.byteLength + utf8ByteLength(text), lineCount: source.lineCount + 1 };
      sealed = true;
    }
    return snapshot(ending, display);
  });

  return {
    append,
    entry,
    answer,
    snapshot,
    dispose: () => (source === undefined || !retained ? Effect.void : fs.remove(source.path, { force: true })),
  };
});

export type RemovalJournal = Effect.Success<ReturnType<typeof makeReport>>;
