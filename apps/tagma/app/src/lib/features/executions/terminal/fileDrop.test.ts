import { expect, test } from 'vitest';
import { fileDrop } from './fileDrop.js';

const shot = new File(['png'], 'shot.png', { type: 'image/png' });
const pasted = new File(['png'], 'image.png', { type: 'image/png' });
const archive = new File(['zip'], 'big.zip', { type: 'application/zip' });
const local = { pathOf: (file: File) => (file === shot ? '/Users/ana/Desktop/shot.png' : '') };

test('a dropped file keeps its own path where the machine knows it, is kept on the server where it does not, and one that fails is told beside the rest', async () => {
  const kept: string[] = [];
  const keeping = fileDrop(local, async (file) => {
    if (file === archive) throw new Error('A dropped file can be up to 64 MB.');
    kept.push(file.name);
    return `/srv/tagma/t1/drops/${file.name}`;
  });

  expect(await keeping([shot, archive, pasted])).toEqual({
    paths: ['/Users/ana/Desktop/shot.png', '/srv/tagma/t1/drops/image.png'],
    problems: ['big.zip: A dropped file can be up to 64 MB.'],
  });
  expect(kept).toEqual(['image.png']);
});
