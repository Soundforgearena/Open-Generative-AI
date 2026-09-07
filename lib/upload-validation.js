export const ASSET_KINDS = Object.freeze({
  character: { label: 'Character', mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 },
  outfit: { label: 'Outfit', mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 },
  location: { label: 'Location', mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 },
  prop: { label: 'Prop', mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 },
  reference: { label: 'Reference still', mime: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 15 * 1024 * 1024 },
  audio: {
    label: 'Audio track',
    mime: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac'],
    maxBytes: 60 * 1024 * 1024,
  },
});

const EXTENSION_MIME = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
});

export function resolveUploadType({ kind, filename, contentType }) {
  const rules = ASSET_KINDS[kind];
  if (!rules) return { ok: false, message: 'That reference type is not supported.' };

  const extension = String(filename || '').split('.').pop()?.toLowerCase() || '';
  const byExtension = EXTENSION_MIME[extension];
  if (!byExtension) return { ok: false, message: 'That file type is not supported.' };

  const declared = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (declared && !rules.mime.includes(declared)) {
    return { ok: false, message: `That file type is not supported for a ${rules.label.toLowerCase()}.` };
  }
  if (!rules.mime.includes(byExtension)) {
    return { ok: false, message: `That file type is not supported for a ${rules.label.toLowerCase()}.` };
  }

  return { ok: true, contentType: declared || byExtension, maxBytes: rules.maxBytes };
}

export function validateUploadDetails(details) {
  const resolved = resolveUploadType(details);
  if (!resolved.ok) return resolved;
  const size = Number(details.sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, status: 400, message: 'The file size could not be read.' };
  }
  if (size > resolved.maxBytes) {
    return {
      ok: false,
      status: 413,
      message: `That file is too large. The limit is ${Math.round(resolved.maxBytes / (1024 * 1024))} MB.`,
    };
  }
  return { ...resolved, size };
}
