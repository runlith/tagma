type Reading = {
  readonly status: string;
  readonly key?: { readonly description: string };
  readonly map?: Readonly<Record<string, unknown>>;
};

export function liveAssembledParams(repository: string, key: string): unknown {
  const run = Bun.spawnSync(['tagma', 'op', 'read_inspections', '--json', JSON.stringify({ key, map: true })], { cwd: repository });
  if (run.exitCode !== 0) throw new Error(`tagma op read_inspections failed: ${run.stderr.toString().trim()}`);
  const reading = JSON.parse(run.stdout.toString()) as Reading;
  if (reading.status !== 'ok' || reading.map === undefined || reading.key === undefined)
    throw new Error(`read_inspections answered ${reading.status} with no description of ${key} or no module map`);
  const { params } = JSON.parse(reading.key.description) as { readonly params: Readonly<Record<string, unknown>> };
  const { problems: _problems, ...map } = reading.map;
  return { ...params, map };
}
