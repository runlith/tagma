export async function decodedPicture(source: Blob): Promise<HTMLImageElement | null> {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(source);
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    return picture.naturalWidth > 0 && picture.naturalHeight > 0 ? picture : null;
  } catch {
    return null;
  } finally {
    if (url !== null) URL.revokeObjectURL(url);
  }
}

export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob !== null && blob.type === type ? blob : null), type, quality);
  });
}

export async function pngOf(source: Blob): Promise<Blob> {
  if (source.type === 'image/png') return source;
  const picture = await decodedPicture(source);
  if (picture === null) throw new Error('The image cannot be decoded.');
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) throw new Error('The browser gave no canvas to redraw the image.');
  const { canvas } = context;
  canvas.width = picture.naturalWidth;
  canvas.height = picture.naturalHeight;
  context.drawImage(picture, 0, 0);
  const png = await canvasBlob(canvas, 'image/png');
  if (png === null) throw new Error('The image cannot be encoded as PNG.');
  return png;
}

export async function copyPicture(read: () => Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || navigator.clipboard === undefined) {
    throw new Error('The browser gives this page no clipboard: it does only over HTTPS or localhost.');
  }
  const png = read().then(pngOf);
  await Promise.all([png, navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])]);
}
