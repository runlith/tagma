import { Effect } from 'effect';
import type { PageId } from '../contract/wire/ids.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { calling, OPERATOR } from './world.js';

export type Rgb = readonly [number, number, number];

export const pixelOf = (page: PageId, mediaType: 'image/png' | 'image/jpeg', data: string, x: number, y: number) =>
  calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(async () => {
          const image = new Image();
          image.src = ${JSON.stringify(`data:${mediaType};base64,${data}`)};
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return Array.from(context.getImageData(${x}, ${y}, 1, 1).data.slice(0, 3));
        })()`,
      },
      undefined,
      OPERATOR,
    ),
  ).pipe(Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as Rgb) : ([-1, -1, -1] as const))));

export const amber = ([red, green, blue]: Rgb): boolean => red > 200 && green > 120 && green < 210 && blue < 140;

export const neutral = ([red, green, blue]: Rgb): boolean => Math.max(red, green, blue) - Math.min(red, green, blue) < 16;
