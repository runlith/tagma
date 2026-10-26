import { homedir } from 'node:os';
import { Effect, FileSystem, Path, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { type Build, BuildUnavailable } from './build.js';
import { chromeArgs, RELEASE } from './chrome.js';

const candidates = (path: Path.Path): readonly string[] => {
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      ];
    case 'linux':
      return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
    case 'win32':
      return [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
        .filter((root): root is string => root !== undefined)
        .map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    default:
      return [];
  }
};

export const makeInstalledChrome = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

  const unavailable = (reason: string) =>
    new BuildUnavailable({
      message: `Google Chrome is not available: ${reason}`,
      unblock: ['install Google Chrome, then open the page again', 'open the page in a profile whose build is chrome-for-testing'],
    });

  const reported = (executable: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(executable, ['--version'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const said = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString);
        yield* handle.exitCode;
        return said;
      }),
    ).pipe(
      Effect.provide(spawner),
      Effect.mapError((failure) => unavailable(`${executable} did not report its release: ${failure.message}`)),
    );

  const releaseOf = Effect.fnUntraced(function* (executable: string) {
    if (process.platform !== 'win32') return RELEASE.exec(yield* reported(executable))?.[1];
    const beside = yield* files.readDirectory(path.dirname(executable)).pipe(Effect.mapError((failure) => unavailable(failure.message)));
    return beside
      .filter((name) => RELEASE.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .at(0);
  });

  const launch = Effect.gen(function* () {
    for (const executable of candidates(path)) {
      if (!(yield* files.exists(executable).pipe(Effect.mapError((failure) => unavailable(failure.message))))) continue;
      const release = yield* releaseOf(executable);
      if (release === undefined) return yield* unavailable(`${executable} reports no release`);
      return { executable, args: (profileDir: string) => chromeArgs(release, profileDir) };
    }
    return yield* unavailable(`it is in none of ${candidates(path).join(', ')}`);
  }).pipe(Effect.withSpan('installedChrome.launch'));

  return { id: 'installed-chrome', launch } satisfies Build;
});
