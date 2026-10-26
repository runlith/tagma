import { Result, Schema } from 'effect';
import type { Diagnostic } from '../files/counts.js';
import { versionProblem } from '../files/version.js';

const Log = Schema.Struct({
  version: Schema.NonEmptyString,
  runs: Schema.Tuple([
    Schema.Struct({
      tool: Schema.Struct({
        driver: Schema.Struct({
          name: Schema.NonEmptyString,
          version: Schema.optional(Schema.NonEmptyString),
          semanticVersion: Schema.optional(Schema.NonEmptyString),
        }),
      }),
      invocations: Schema.optional(
        Schema.Array(
          Schema.Struct({
            executionSuccessful: Schema.Boolean,
            toolExecutionNotifications: Schema.optional(Schema.Array(Schema.Unknown)),
            toolConfigurationNotifications: Schema.optional(Schema.Array(Schema.Unknown)),
          }),
        ),
      ),
      results: Schema.Array(
        Schema.Struct({
          ruleId: Schema.NonEmptyString,
          level: Schema.optional(Schema.Unknown),
          message: Schema.Struct({ text: Schema.String }),
          fixes: Schema.optional(Schema.Array(Schema.Struct({ description: Schema.optional(Schema.Struct({ text: Schema.String })) }))),
          suppressions: Schema.optional(Schema.Array(Schema.Unknown)),
          locations: Schema.Tuple([
            Schema.Struct({
              physicalLocation: Schema.Struct({
                artifactLocation: Schema.Struct({ uri: Schema.NonEmptyString, uriBaseId: Schema.optional(Schema.String) }),
                region: Schema.Struct({ startLine: Schema.Int.check(Schema.isGreaterThan(0)) }),
              }),
            }),
          ]),
        }),
      ),
    }),
  ]),
});

type Tool = { readonly name: string; readonly minimum: string };

type Dialect = {
  readonly documentVersion: '2.1.0' | 'tool';
  readonly suppressed?: 'drop';
  readonly uriBaseId?: string;
  readonly pathEncoding?: 'percent' | 'literal';
};

type SarifDiagnostic = Diagnostic & { readonly level: unknown };

type Reading = { readonly version: string | null; readonly diagnostics: readonly SarifDiagnostic[]; readonly reported: number };

export const sarifReading = (
  stdout: string,
  tool: Tool | null,
  dialect: Dialect = { documentVersion: '2.1.0' },
): Result.Result<Reading, string> => {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    return Result.fail(`invalid SARIF JSON: ${String(error)}`);
  }
  const decoded = Schema.decodeUnknownResult(Log)(json);
  if (Result.isFailure(decoded)) return Result.fail(`SARIF does not decode: ${decoded.failure.message}`);
  const run = decoded.success.runs[0];
  const driverVersion = run.tool.driver.semanticVersion ?? run.tool.driver.version;
  const version = dialect.documentVersion === 'tool' ? decoded.success.version : (driverVersion ?? null);
  if (dialect.documentVersion !== 'tool' && decoded.success.version !== dialect.documentVersion)
    return Result.fail(`SARIF is not version ${dialect.documentVersion}`);
  if (tool !== null) {
    if (run.tool.driver.name !== tool.name) return Result.fail(`SARIF is not from ${tool.name}`);
    if (version === null) return Result.fail(`${tool.name} did not report its version; version ${tool.minimum} or newer is required`);
    const unsupported = versionProblem(tool.name, version, tool.minimum);
    if (unsupported !== null) return Result.fail(unsupported);
    if (driverVersion !== undefined && driverVersion !== version) return Result.fail(`${tool.name} reported conflicting versions`);
  }
  if (
    run.invocations?.some(
      (one) =>
        !one.executionSuccessful ||
        (one.toolExecutionNotifications?.length ?? 0) > 0 ||
        (one.toolConfigurationNotifications?.length ?? 0) > 0,
    )
  )
    return Result.fail('SARIF reports an incomplete invocation');
  const findings: SarifDiagnostic[] = [];
  for (const result of run.results) {
    if ((result.suppressions?.length ?? 0) > 0) {
      if (dialect.suppressed === 'drop') continue;
      return Result.fail(`${result.ruleId} was suppressed`);
    }
    const location = result.locations[0].physicalLocation;
    if (location.artifactLocation.uriBaseId !== undefined && location.artifactLocation.uriBaseId !== dialect.uriBaseId)
      return Result.fail('a SARIF URI base is unsupported');
    let path: string;
    try {
      path = dialect.pathEncoding === 'literal' ? location.artifactLocation.uri : decodeURIComponent(location.artifactLocation.uri);
    } catch (error) {
      return Result.fail(`invalid SARIF URI: ${String(error)}`);
    }
    if (
      path.startsWith('file:') ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => part === '..' || part === '.')
    )
      return Result.fail(`SARIF path is not scratch-relative: ${path}`);
    const fix = result.fixes?.find((one) => one.description !== undefined && one.description.text.trim() !== '')?.description?.text;
    findings.push({ id: result.ruleId, path, line: location.region.startLine, message: result.message.text, fix, level: result.level });
  }
  return Result.succeed({ version, diagnostics: findings, reported: run.results.length });
};
