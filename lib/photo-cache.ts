import sharp from 'sharp';

const THUMB_SIZE = 80;
const JPEG_QUALITY = 72;

/**
 * Fetches a profile photo URL, resizes it to an 80×80 JPEG thumbnail,
 * and returns it as a data URI string suitable for storing in the DB.
 * Returns null on any fetch/processing failure.
 */
export async function cacheProfilePhoto(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const thumb = await sharp(buf)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'top' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${thumb.toString('base64')}`;
  } catch {
    return null;
  }
}
