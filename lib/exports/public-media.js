import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)));
  }
  if (isIP(address) === 6) {
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2002:|^2001:(?:0:|db8:)/i.test(address);
  }
  return false;
}

export function isFetchableMediaUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && host.includes('.') &&
      !isIP(host) && !host.includes(':') && host !== 'localhost' &&
      !host.endsWith('.localhost') && !host.endsWith('.local') && !host.endsWith('.internal');
  } catch { return false; }
}

// Pin vetted DNS results to the TLS socket. Recheck each redirect. A DNS check
// followed by ordinary fetch alone would still permit DNS rebinding.
export async function openPublicMedia(value, { resolve = lookup, request = httpsRequest, hops = 0 } = {}) {
  if (!isFetchableMediaUrl(value) || hops > 5) throw new Error('unsupported media url');
  const url = new URL(value);
  const addresses = await resolve(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('media destination is not public');
  }
  const response = await new Promise((accept, reject) => {
    const req = request(url, {
      agent: false,
      signal: AbortSignal.timeout(120_000),
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, accept);
    req.setTimeout(15_000, () => req.destroy(new Error('media download timed out')));
    req.on('error', reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers.location;
    response.destroy();
    if (!location) throw new Error('media redirect has no destination');
    return openPublicMedia(new URL(location, url).href, { resolve, request, hops: hops + 1 });
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.destroy();
    throw new Error(`media fetch failed (${response.statusCode})`);
  }
  return response;
}
