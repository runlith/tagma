import { describe, expect, test } from 'bun:test';
import { highlightLines } from './colours';
import { highlightLinesOffThread } from './offThread';

const SAMPLE = 'export function greet(name: string) {\n  return "hi " + name;\n}';

describe('the thread is optional', () => {
  test('answers the coloured lines in place, exactly as the in-thread call does', async () => {
    expect(await highlightLinesOffThread(SAMPLE, 'typescript', 'reader')).toEqual(await highlightLines(SAMPLE, 'typescript'));
  });

  test('answers in place for a language the bundle does not carry', async () => {
    expect(await highlightLinesOffThread('alpha\nbeta', 'brainfuck', 'reader')).toEqual(new Map());
  });
});

type ColouredText = [number, string[]][] | null;

async function throughTheDoor(): Promise<{
  burst: ColouredText[];
  shared: boolean;
  sharedText: ColouredText;
  abandoned: ColouredText;
  answered: string[];
  hugeLines: number;
}> {
  const door = JSON.stringify(`${import.meta.dir}/offThread.ts`);
  const spawned = Bun.spawn(
    [
      'bun',
      '-e',
      `globalThis.window = globalThis;
       const door = await import(${door});
       const text = (colours) =>
         colours === undefined ? null : [...colours].map(([at, tokens]) => [at, tokens.map((token) => token.text)]);
       await door.highlightLinesOffThread('const warm = 1;', 'typescript', 'warm');

       const files = Array.from({ length: 2 }, (_, index) => 'const file' + index + ' = ' + index + ';');
       const burst = await Promise.all(
         files.map((code) => door.highlightLinesOffThread(code, 'typescript', 'one reader')),
       );

       const one = 'const shared = 1;\\nconst pair = 2;';
       const [a, b] = await Promise.all([
         door.highlightLinesOffThread(one, 'typescript', 'reader a'),
         door.highlightLinesOffThread(one, 'typescript', 'reader b'),
       ]);

       // 'reader a' walks away from a text 'reader b' is still waiting on, so the tokenization happens either way.
       const held = 'const held = 1;\\nconst still = 2;';
       const alsoHeld = door.highlightLinesOffThread(held, 'typescript', 'reader b');
       const walkedAway = door.highlightLinesOffThread(held, 'typescript', 'reader a');
       const movedOn = door.highlightLinesOffThread('const elsewhere = 3;', 'typescript', 'reader a');
       const abandoned = await walkedAway;
       await Promise.all([alsoHeld, movedOn]);

       const answered = [];
       const hugeCode = Array.from({ length: 90 }, (_, index) => 'const huge' + index + ' = ' + index + ';' + ' '.repeat(350)).join('\\n');
       const huge = door.highlightLinesOffThread(hugeCode, 'typescript', 'file reader').then((colours) => {
         answered.push('huge');
         return colours;
       });
       const small = door.highlightLinesOffThread('const small = 1;', 'typescript', 'feed reader').then(() => {
         answered.push('small');
       });
       const [hugeColours] = await Promise.all([huge, small]);

       console.log(JSON.stringify({
         burst: burst.map(text),
         shared: a === b,
         sharedText: text(a),
         abandoned: text(abandoned),
         answered,
         hugeLines: hugeColours.size,
       }));
       process.exit(0);`,
    ],
    { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, error] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text()]);
  if ((await spawned.exited) !== 0) throw new Error(error);
  return JSON.parse(out);
}

let doorReading: ReturnType<typeof throughTheDoor> | undefined;

describe('who is asking, and what is being asked about', () => {
  test('supersedes a reader by its own last ask and shares one tokenization between two readers', async () => {
    const { burst, shared, sharedText, abandoned } = await (doorReading ??= throughTheDoor());

    expect(burst[0]).toBeNull();
    expect(burst[1]?.length).toBeGreaterThan(0);

    expect(shared).toBe(true);
    expect(sharedText?.length).toBeGreaterThan(0);

    expect(abandoned).not.toBeNull();
    expect(abandoned?.length).toBeGreaterThan(0);
  });

  test('colours a multi-slice text whole while a small ask queued behind it answers first', async () => {
    const { answered, hugeLines } = await (doorReading ??= throughTheDoor());

    expect(answered).toEqual(['small', 'huge']);
    expect(hugeLines).toBe(90);
  });
});
