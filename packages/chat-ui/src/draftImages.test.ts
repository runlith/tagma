// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import {
  type ChatDraftImage,
  chatDraftImageAttachment,
  chatDraftImageFilename,
  chatDraftImageMediaType,
  stageDraftImages,
} from './draftImages';

describe('staging images into a chat draft', () => {
  test('accepts the media types the wire carries and refuses the rest', () => {
    expect(chatDraftImageMediaType('image/png')).toBe('image/png');
    expect(chatDraftImageMediaType('image/svg+xml')).toBeNull();
    expect(chatDraftImageFilename('image/jpeg', 3)).toBe('image-3.jpg');
  });

  test('a staged image is shown by its own data url until the server has it', () => {
    expect(chatDraftImageAttachment(stagedImage())).toEqual({
      url: 'data:image/png;base64,a',
      filename: 'panel.png',
      mime: 'image/png',
    });
  });

  test('files that are not images the chat carries are refused as a group', async () => {
    const result = await stageDraftImages([], [file('notes.pdf', 'application/pdf', 10)]);

    expect(result).toEqual({ added: [], rejection: { reason: 'not-images' } });
  });

  test('dropping nothing is not a refusal', async () => {
    await expect(stageDraftImages([stagedImage()], [])).resolves.toEqual({ added: [] });
  });

  test('an oversized file the browser cannot redraw costs only itself: what fits still lands', async () => {
    const result = await stageDraftImages([], [file('huge.png', 'image/png', 21 * 1024 * 1024), file('small.png', 'image/png', 4)]);

    expect(result.added.map((image) => image.filename)).toEqual(['small.png']);
    expect(result.rejection).toEqual({ reason: 'too-large', maxBytes: 20 * 1024 * 1024 });
  });

  test('an image of a type the wire refuses and the browser cannot decode is unreadable, not a non-image', async () => {
    const result = await stageDraftImages([], [file('photo.heic', 'image/heic', 10)]);

    expect(result).toEqual({ added: [], rejection: { reason: 'unreadable' } });
  });

  test('a staged image owns its bytes, so the file it came from may vanish before the send', async () => {
    let readable = true;
    const source = new File([new Uint8Array([7, 8, 9])], 'telegram-cloud-photo.png', { type: 'image/png' });
    const original = source.arrayBuffer.bind(source);
    source.arrayBuffer = () => (readable ? original() : Promise.reject(new DOMException('gone', 'NotReadableError')));

    const result = await stageDraftImages([], [source]);
    readable = false;

    expect([...new Uint8Array(await result.added[0]!.file.arrayBuffer())]).toEqual([7, 8, 9]);
  });

  test('a file already unreadable when staged is refused as unreadable', async () => {
    const source = new File([new Uint8Array([1])], 'gone.png', { type: 'image/png' });
    source.arrayBuffer = () => Promise.reject(new DOMException('gone', 'NotReadableError'));

    expect(await stageDraftImages([], [source])).toEqual({ added: [], rejection: { reason: 'unreadable' } });
  });

  test('a name already in the draft is told apart, so every paste named image.png stays distinct', async () => {
    const result = await stageDraftImages(
      [{ ...stagedImage(), filename: 'image.png' }],
      [file('image.png', 'image/png', 4), file('image.png', 'image/png', 4)],
    );

    expect(result.added.map((image) => image.filename)).toEqual(['image-2.png', 'image-3.png']);
  });
});

function stagedImage(): ChatDraftImage {
  return {
    dataUrl: 'data:image/png;base64,a',
    file: file('panel.png', 'image/png', 1),
    filename: 'panel.png',
    id: 'img',
    mediaType: 'image/png',
    size: 1,
  };
}

function file(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}
