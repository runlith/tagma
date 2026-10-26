import { Result, Schema } from 'effect';
import { sarifReading } from '../sarif/reading.js';

export type Diagnostic = {
  readonly id: string;
  readonly uri: string;
  readonly line: number;
  readonly message: string;
  readonly error: boolean;
};

export type SarifReading = { readonly version: string; readonly diagnostics: readonly Diagnostic[] };

const ruleIdOf = /^([^()\s]+)\(([^()\s]+)\)$/;
const isLevel = Schema.is(Schema.Literals(['error', 'warning', 'note', 'none']));

export const readSarif = (stdout: string, minimum: string): Result.Result<SarifReading, string> => {
  const reading = sarifReading(stdout, { name: 'oxlint', minimum }, { documentVersion: '2.1.0', pathEncoding: 'literal' });
  if (Result.isFailure(reading)) return Result.fail(reading.failure);
  const diagnostics: Diagnostic[] = [];
  for (const result of reading.success.diagnostics) {
    const rule = ruleIdOf.exec(result.id);
    if (rule === null) return Result.fail(`oxlint could not lint: ${result.id} ${result.message}`);
    if (!isLevel(result.level)) return Result.fail(`oxlint reported ${result.id} with an invalid diagnostic level`);
    diagnostics.push({
      id: `${rule[1]}/${rule[2]}`,
      uri: result.path,
      line: result.line,
      message: result.message,
      error: result.level === 'error',
    });
  }
  return Result.succeed({ version: reading.success.version!, diagnostics });
};
