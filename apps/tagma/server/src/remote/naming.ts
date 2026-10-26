const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'Chromebook'],
  [/Linux/, 'Linux'],
];

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/EdgiOS|EdgA|Edg\//, 'Edge'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/OPiOS|OPR\//, 'Opera'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const first = (table: readonly (readonly [RegExp, string])[], agent: string): string | undefined =>
  table.find(([pattern]) => pattern.test(agent))?.[1];

export const deviceName = (agent: string | undefined): string => {
  const system = agent === undefined ? undefined : first(SYSTEMS, agent);
  const browser = agent === undefined ? undefined : first(BROWSERS, agent);
  return [system ?? 'Device', browser].filter((part) => part !== undefined).join(' · ');
};
