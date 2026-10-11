function safeExternalUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
            !url.username && !url.password;
    } catch {
        return false;
    }
}
module.exports = { safeExternalUrl };
