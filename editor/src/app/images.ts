// New photos are made web-sized before they are saved: the longest side becomes at most
// 1600 px, enough for "Volle Breite" on sharp screens; how large a photo appears on the
// page is chosen separately. Re-encoding also drops camera data such as GPS position.
const MAX_SIDE = 1600;

export interface PreparedImage {
  name: string;
  data: ArrayBuffer;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const stem = file.name.replace(/\.[^.]+$/, '') || 'foto';
  // Animated GIFs would lose their animation on a canvas.
  if (file.type === 'image/gif') return { name: `${stem}.gif`, data: await file.arrayBuffer() };

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const png = file.type === 'image/png';
  const blob = await canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 });
  return { name: `${stem}.${png ? 'png' : 'jpg'}`, data: await blob.arrayBuffer() };
}
