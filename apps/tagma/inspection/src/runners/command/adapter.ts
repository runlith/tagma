import { Result, Schema } from 'effect';
import {
  type FileEnding,
  type FilePlan,
  type FileSide,
  type ProgramAnswer,
  ProgramFinding,
  type ProgramInvocation,
} from '../../core/program.js';
import { countAnswer, fileInputs, noParameters } from '../files/counts.js';
import { sarifReading } from '../sarif/reading.js';

const TOOL = { name: 'command', version: '1' };

const Findings = Schema.Struct({ findings: Schema.Array(ProgramFinding) });

export const planCommand = (input: ProgramInvocation, sides: readonly FileSide[]): Result.Result<FilePlan, string> => {
  const params = noParameters(input, 'a command linter takes its options from its own argv');
  if (Result.isFailure(params)) return Result.fail(params.failure);
  const files = fileInputs(sides, () => true);
  if (Result.isFailure(files)) return Result.fail(files.failure);
  const targets = files.success.map((file) => file.path);
  return Result.succeed({ files: files.success, targets, args: targets });
};

const ended = (plan: FilePlan, ending: FileEnding | null): Result.Result<string | null, string> => {
  if (ending === null) return plan.targets.length === 0 ? Result.succeed(null) : Result.fail('the command did not run');
  if (ending.exitCode !== 0 && ending.exitCode !== 1) return Result.fail(`the command exited ${ending.exitCode}`);
  return Result.succeed(ending.stdout);
};

export const readSarifCommand = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  plan: FilePlan,
  ending: FileEnding | null,
): Result.Result<ProgramAnswer, string> => {
  const stdout = ended(plan, ending);
  if (Result.isFailure(stdout)) return Result.fail(stdout.failure);
  if (stdout.success === null) return countAnswer(input, sides, TOOL, plan, []);
  const reading = sarifReading(stdout.success, null, { pathEncoding: 'percent', documentVersion: '2.1.0' });
  return Result.isFailure(reading) ? Result.fail(reading.failure) : countAnswer(input, sides, TOOL, plan, reading.success.diagnostics);
};

export const readFindingsCommand = (
  input: ProgramInvocation,
  sides: readonly FileSide[],
  plan: FilePlan,
  ending: FileEnding | null,
): Result.Result<ProgramAnswer, string> => {
  const stdout = ended(plan, ending);
  if (Result.isFailure(stdout)) return Result.fail(stdout.failure);
  let json: unknown = { findings: [] };
  if (stdout.success !== null) {
    try {
      json = JSON.parse(stdout.success);
    } catch (error) {
      return Result.fail(`the command answered no findings JSON: ${String(error)}`);
    }
  }
  const decoded = Schema.decodeUnknownResult(Findings)(json);
  if (Result.isFailure(decoded)) return Result.fail(`the command's findings do not decode: ${decoded.failure.message}`);
  const targets = new Set(plan.targets);
  const bySide = new Map<string, ProgramFinding[]>();
  for (const finding of decoded.success.findings) {
    if (!targets.has(finding.path)) return Result.fail(`the command reported an unrequested file: ${finding.path}`);
    const slash = finding.path.indexOf('/');
    const side = finding.path.slice(0, slash);
    const path = finding.path.slice(slash + 1);
    const fingerprint = finding.fingerprint.split(finding.path).join(path);
    bySide.set(side, [...(bySide.get(side) ?? []), { ...finding, path, fingerprint }]);
  }
  return Result.succeed({
    request: input.request,
    checker: input.checker,
    tree: input.tree,
    base: input.base,
    run: { tool: TOOL.name, version: TOOL.version, capabilities: {} },
    readings: input.keys.flatMap((key) =>
      sides.map((side) => ({
        key: key.key,
        side: side.side,
        covered: side.whole ? { scope: 'reach' as const } : side.files.map((file) => file.path),
        findings: bySide.get(side.side) ?? [],
        unjudged: [],
      })),
    ),
  });
};
