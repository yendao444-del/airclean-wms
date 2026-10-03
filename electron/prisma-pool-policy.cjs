// Prisma otherwise sizes each pool from CPU cores (29 connections on this
// workstation). Every desktop has two clients sharing the Supabase pooler.
// Bound both clients rather than opening dozens of connections and starving
// other desktop clients. Startup maintenance is delayed until after login so
// this small pool is not competed for during the first paint.
const { isTransientDatabaseConnectionError } = require('./login-deadline');
const { AsyncLocalStorage } = require('node:async_hooks');

function desktopPrismaUrl(value, { transactions = false } = {}) {
  const url = new URL(value);
  const limits = {
    connection_limit: transactions ? 2 : 4,
    pool_timeout: 10,
    connect_timeout: 10,
  };
  for (const [key, maximum] of Object.entries(limits)) {
    const configured = Number(url.searchParams.get(key));
    const bounded = Number.isInteger(configured) && configured > 0
      ? Math.min(configured, maximum)
      : maximum;
    url.searchParams.set(key, String(bounded));
  }
  return url.toString();
}

async function withDatabaseReadDeadline(read, timeoutMs) {
  if (timeoutMs <= 0) throw databaseReadTimeout();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(databaseReadTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function databaseReadTimeout() {
  const error = new Error('Kết nối Supabase phản hồi quá lâu. Vui lòng thử lại.');
  error.code = 'DATABASE_READ_TIMEOUT';
  return error;
}

function createPrismaReadRecovery({ concurrency = 3, timeoutMs = 15000, retryDelayMs = 250, maxQueued = 64, replay } = {}) {
  const reads = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
  const replayContext = new AsyncLocalStorage();
  let active = 0;
  const queue = [];
  function grant(resolve) {
    active += 1;
    let released = false;
    resolve(() => {
      if (released) return;
      released = true;
      active -= 1;
      const waiting = queue.shift();
      if (waiting) {
        clearTimeout(waiting.timer);
        grant(waiting.resolve);
      }
    });
  }
  function acquire(remainingMs) {
    if (remainingMs <= 0) return Promise.reject(databaseReadTimeout());
    return new Promise((resolve, reject) => {
      if (active < concurrency) return grant(resolve);
      if (queue.length >= maxQueued) return reject(databaseReadTimeout());
      const waiting = { resolve, timer: null };
      waiting.timer = setTimeout(() => {
        const index = queue.indexOf(waiting);
        if (index >= 0) queue.splice(index, 1);
        reject(databaseReadTimeout());
      }, remainingMs);
      queue.push(waiting);
    });
  }
  return async (params, next) => {
    if (replayContext.getStore() || params.runInTransaction || !reads.has(params.action)) return next(params);
    const deadlineAt = Date.now() + timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const release = await acquire(deadlineAt - Date.now());
      try {
        if (Date.now() >= deadlineAt) {
          release();
          throw databaseReadTimeout();
        }
        const pending = Promise.resolve().then(() => attempt === 0
          ? next(params)
          : replayContext.run(true, () => replay(params)));
        pending.then(release, release);
        return await withDatabaseReadDeadline(() => pending, deadlineAt - Date.now());
      } catch (error) {
        if (attempt === 1 || typeof replay !== 'function' || !isTransientDatabaseConnectionError(error)) throw error;
        await withDatabaseReadDeadline(
          () => new Promise(resolve => setTimeout(resolve, retryDelayMs)),
          deadlineAt - Date.now(),
        );
      }
    }
  };
}

module.exports = { desktopPrismaUrl, withDatabaseReadDeadline, createPrismaReadRecovery };
