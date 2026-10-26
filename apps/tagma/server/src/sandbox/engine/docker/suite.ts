import { afterAll as bunAfterAll, beforeAll as bunBeforeAll, describe as bunDescribe, test as bunTest } from 'bun:test';

type Hook = Parameters<typeof bunBeforeAll>[0];

const answers = (): boolean => {
  try {
    return (
      Bun.spawnSync(['docker', 'info', '--format', '{{.ServerVersion}}'], { stdout: 'ignore', stderr: 'ignore', timeout: 10_000 })
        .exitCode === 0
    );
  } catch {
    return false;
  }
};

export const dockerAnswers = answers();

export const describe = (name: string, body: () => void): void => {
  bunDescribe(name, () => {
    if (dockerAnswers) body();
    else bunTest.skip('requires a running Docker engine', () => {});
  });
};

export const test = bunTest.skipIf(!dockerAnswers);

export const beforeAll = (hook: Hook, timeout?: number): void => {
  if (dockerAnswers) bunBeforeAll(hook, timeout);
};

export const afterAll = (hook: Hook, timeout?: number): void => {
  if (dockerAnswers) bunAfterAll(hook, timeout);
};
