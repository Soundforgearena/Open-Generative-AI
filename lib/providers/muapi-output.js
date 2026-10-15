// MuAPI's prediction result puts finished media in `outputs` (an array of
// URLs). Older/alternate shapes use `output` or `result`. Read all of them so
// a finished, paid-for take is never stored without its video link.

export function muapiOutput(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [data.outputs, data.output, data.result, data.data?.outputs, data.data?.output];
  for (const value of candidates) {
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === '') continue;
    return value;
  }
  return null;
}

export function firstOutputUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return /^https:\/\//i.test(output) ? output : null;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = firstOutputUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof output === 'object') {
    return firstOutputUrl(output.url || output.video_url || output.image_url || output.output_url || null);
  }
  return null;
}
