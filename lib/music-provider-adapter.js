// Future server-only adapter contract. No provider credentials or network calls belong in browser demo mode.
export const MusicProviderAdapter = {
  validateSource: async () => ({ ok: false, reason: 'Connect an authorized music provider to enable this.' }),
  getTrackMetadata: async () => null,
  requestAuthorizedDownload: async () => { throw new Error('Authorized music provider integration is not enabled.'); },
  getStemOptions: async () => [],
};
