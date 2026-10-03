// Memory-only cache for authenticated image readers. Callers must check task
// access before consulting it; no credentials or image data are persisted.
function createEvidenceImageCache({ ttlMs = 30 * 60 * 1000, maxItems = 50, maxBytes = 24 * 1024 * 1024 } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.size;
    entries.delete(key);
  }

  return {
    delete(key) {
      remove(key);
      // An invalidated download may finish, but must not repopulate the cache.
      pending.delete(key);
    },
    async getOrLoad(key, load) {
      for (const [expiredKey, entry] of entries) {
        if (entry.expiresAt <= Date.now()) remove(expiredKey);
      }
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        entries.set(key, cached);
        return cached.value;
      }
      if (pending.has(key)) return pending.get(key);

      const request = Promise.resolve().then(load).then(value => {
        const size = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
        if (pending.get(key) === request && size <= maxBytes && maxItems > 0) {
          remove(key);
          entries.set(key, { value, size, expiresAt: Date.now() + ttlMs });
          bytes += size;
          while (entries.size > maxItems || bytes > maxBytes) remove(entries.keys().next().value);
        }
        return value;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}

module.exports = { createEvidenceImageCache };
