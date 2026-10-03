const path = require('node:path');
const { fileURLToPath } = require('node:url');

function createAppOriginPolicy({ appRoot, developmentOrigin, isPackaged }) {
    const normalizePath = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const entryPath = normalizePath(path.join(appRoot, 'dist', 'index.html'));
    const isTrustedAppUrl = (rawUrl) => {
        try {
            const url = new URL(rawUrl);
            if (url.username || url.password) return false;
            if (!isPackaged && url.origin === developmentOrigin) return true;
            return url.protocol === 'file:' && normalizePath(fileURLToPath(url)) === entryPath;
        } catch {
            return false;
        }
    };
    const isTrustedAppSender = (event) => Boolean(
        event?.sender?.mainFrame &&
        event.senderFrame === event.sender.mainFrame &&
        isTrustedAppUrl(event.senderFrame.url),
    );
    return { isTrustedAppUrl, isTrustedAppSender };
}

module.exports = { createAppOriginPolicy };
