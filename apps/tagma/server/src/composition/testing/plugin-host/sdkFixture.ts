import { beforeBuild, definePlugin, schedule, tool, view } from '@runlith/tagma/plugin';
import { Schema } from 'effect';

const noted = async (data: string, line: string): Promise<void> => {
  const journal = Bun.file(`${data}/journal`);
  const before = (await journal.exists()) ? await journal.text() : '';
  await Bun.write(journal, `${before}${line} ${process.pid}\n`);
};

export default definePlugin({
  id: 'accept',
  title: 'Acceptance',
  views: { board: view('ui/Board.svelte') },
  tools: {
    echo: tool({
      description: 'Echoes the text it is given.',
      audience: 'agents',
      readOnly: true,
      input: Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct({ text: Schema.String }))),
      run: async ({ text }, ctx) => {
        await noted(ctx.dataOf(null), 'call');
        return { text, pid: process.pid, project: ctx.project };
      },
    }),
  },
  schedules: { beat: schedule({ every: '1h', run: (_tick, ctx) => noted(ctx.data, 'tick') }) },
  beforeBuild: {
    check: beforeBuild({ title: 'Acceptance check', run: async ({ offer }) => ({ verdict: 'stop', reason: `held ${offer}` }) }),
  },
});
