import { supabase } from './supabase';

// Product photos, end to end. Pulled out of InventoryPage because the pilot in
// Nicaragua reported photos "not loading", and the old path had five separate
// ways to fail quietly:
//
//   1. A phone photo is 4-12 MB. On a weak connection the upload stalls and the
//      owner gives up. We now downscale in the browser first — a 12 MB photo
//      becomes ~200 KB, which uploads in a second.
//   2. An iPhone shoots HEIC. It uploads happily and then no browser can render
//      it, so the picture is simply never there. We convert what we can decode
//      and say so plainly when we cannot.
//   3. createSignedUrl errors were dropped on the floor (`if (data)`), so a
//      permission or expiry problem looked identical to "no photo".
//   4. Every object lived in one flat namespace shared by every workspace.
//      New uploads are filed under the workspace id.
//   5. A one-hour signed URL broke images on any page left open longer.

const BUCKET = 'product-images';
export const SIGNED_TTL = 60 * 60 * 8;     // 8h — longer than any working session
const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // refuse absurd files before decoding
const MAX_EDGE = 1600;                     // enough for a full-width product card
const QUALITY = 0.85;

// What a browser can reliably paint. HEIC is deliberately absent: Safari decodes
// it, Chrome does not, so accepting it produces photos that work on the owner's
// phone and are invisible to everyone else.
const RENDERABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class ImageError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function loadBitmap(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ImageError('decode', 'decode failed')); };
    img.src = url;
  });
}

// Downscale to fit MAX_EDGE and re-encode as JPEG. Returns { blob, name }.
// Throws ImageError('decode') when the browser cannot read the format at all,
// which is how an iPhone HEIC arrives in Chrome.
export async function prepareImage(file) {
  if (!file) throw new ImageError('empty', 'no file');
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('too_big', 'file too large');
  if (file.type && !RENDERABLE.includes(file.type) && !/^image\//.test(file.type)) {
    throw new ImageError('type', 'not an image');
  }

  let img;
  try { img = await loadBitmap(file); }
  catch { throw new ImageError('decode', 'cannot decode'); }

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  // Already small and already renderable: upload it untouched rather than
  // re-encoding and losing quality for nothing.
  if (scale === 1 && file.size <= 600 * 1024 && RENDERABLE.includes(file.type)) {
    return { blob: file, name: file.name };
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  // White behind transparency, otherwise a PNG logo turns into a black square.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new ImageError('encode', 'could not re-encode');
  const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
  return { blob, name: `${base}.jpg` };
}

// Upload under the workspace's own prefix. Old flat paths keep resolving because
// the product row stores whatever path it was given.
export async function uploadProductImage(file, orgId) {
  const { blob, name } = await prepareImage(file);
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${orgId || 'shared'}/${Date.now()}_${safe}`;
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '3600',
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw new ImageError('upload', error.message);
  return data.path;
}

// Signed URL with the error kept rather than swallowed, so the caller can tell
// "no photo" apart from "photo exists but we cannot read it".
export async function signedProductImage(path) {
  if (!path) return { url: '', error: null };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error) return { url: '', error: error.message };
  return { url: data?.signedUrl || '', error: data?.signedUrl ? null : 'no signed url returned' };
}

export async function removeProductImage(path) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

// One message per failure, in the caller's language.
export function imageErrorKey(err) {
  const code = err instanceof ImageError ? err.code : 'upload';
  return `inv.imgErr.${code}`;
}
