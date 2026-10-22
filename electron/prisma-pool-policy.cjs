// Prisma otherwise sizes each pool from CPU cores (29 connections on this
// workstation). Every desktop has two clients sharing the Supabase pooler.
// Bound both clients rather than opening dozens of connections and starving
// other desktop clients. Startup maintenance is delayed until after login so
// this small pool is not competed for during the first paint.
const { isTransientDatabaseConnectionError } = require('./login-deadline');
const { AsyncLocalStorage } = require('node:async_hooks');

function isSupabaseSessionPooler(url) {
  return /\.pooler\.supabase\.com$/i.test(url.hostname) && url.port === '5432' && !url.searchParams.has('pgbouncer');
}

// Prisma in pgbouncer mode needs several round trips per query through the
// Supabase transaction pooler (6543); the session pooler on the same host
// (5432) needs one. Measured from the shop: ~555 ms vs ~111 ms per query.
// Returns null for any URL that is not a Supabase transaction pooler.
function supabaseSessionPoolUrl(value) {
  try {
    const url = new URL(value);
    if (!/\.pooler\.supabase\.com$/i.test(url.hostname) || url.port !== '6543') return null;
    url.port = '5432';
    url.searchParams.delete('pgbouncer');
    return url.toString();
  } catch {
    return null;
  }
}

// Only failures that happen before a statement reaches the database: the
// session port is blocked on this workstation, or every session slot is taken.
// Retrying such an operation on the transaction pooler cannot duplicate it.
function isSessionPoolUnavailable(error) {
  if (['P1001'].includes(error?.code || error?.errorCode)) return true;
  return /can't reach database server|max client|maxclientsinsessionmode|emaxconn|too many clients|remaining connection slots/i.test(
    `${error?.message || ''} ${error?.meta?.message || ''}`,
  );
}

// One stable object for the whole app (handlers and modules capture it at
// startup) that forwards to the session client until it proves unavailable,
// then to the transaction-pooler client. Full session slots free up, so that
// case retries after a cooldown; a blocked port stays on the fallback until
// restart instead of stalling every retry on the connect timeout.
function createSwitchableClient({ primary, fallback, label = 'Prisma', log = console, retryPrimaryMs = 10 * 60 * 1000 }) {
  let active = primary;
  let fallbackClient = null;
  const useFallback = (error) => {
    if (!fallback || active !== primary) return false;
    fallbackClient ||= fallback();
    active = fallbackClient;
    const unreachable = (error?.code || error?.errorCode) === 'P1001' || /can't reach database server/i.test(String(error?.message || ''));
    log.warn?.(`[${label}] Session pooler unavailable; using transaction pooler${unreachable ? ' until restart' : ' for now'}:`, error?.message || error);
    if (!unreachable) setTimeout(() => { active = primary; }, retryPrimaryMs).unref?.();
    return true;
  };
  if (fallback) {
    // Model operations that fail to obtain a session connection are retried
    // once on the transaction pooler. Interactive transaction steps and raw
    // statements are not replayed; their next call uses the fallback.
    primary.$use(async (params, next) => {
      try {
        return await next(params);
      } catch (error) {
        if (!isSessionPoolUnavailable(error) || !useFallback(error)) throw error;
        if (params.runInTransaction || !params.model) throw error;
        const delegate = params.model[0].toLowerCase() + params.model.slice(1);
        return fallbackClient[delegate][params.action](params.args);
      }
    });
  }
  const client = new Proxy({}, {
    get(_target, property) {
      const value = active[property];
      return typeof value === 'function' ? value.bind(active) : value;
    },
    has(_target, property) {
      return property in active;
    },
  });
  return {
    client,
    useFallback,
    isFallback: () => active !== primary,
    connect: () => primary.$connect().catch(async (error) => {
      if (!isSessionPoolUnavailable(error) || !useFallback(error)) throw error;
      await active.$connect();
    }),
  };
}

function desktopPrismaUrl(value, { transactions = false } = {}) {
  const url = new URL(value);
  const limits = {
    // Session pooler slots are dedicated per connection (shared by every
    // desktop): 3 main + 2 transaction connections per workstation.
    connection_limit: transactions ? 2 : isSupabaseSessionPooler(url) ? 3 : 4,
    pool_timeout: 10,
    connect_timeout: 10,
    // A JS deadline does not cancel Prisma's engine request. Bound the socket
    // too so stalled reads eventually release their occupied scheduler slots.
    socket_timeout: transactions ? 120 : 30,
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

// A separate auth pool protects login from reports. If it stalls, retry only
// the read on the main pool; both attempts share a bounded total budget.
async function withIsolatedReadFallback(primary, fallback, { timeoutMs = 10000, primaryTimeoutMs = 3000 } = {}) {
  const deadlineAt = Date.now() + timeoutMs;
  try {
    return await withDatabaseReadDeadline(primary, Math.min(primaryTimeoutMs, timeoutMs));
  } catch (error) {
    if (error?.code !== 'DATABASE_READ_TIMEOUT' && !isTransientDatabaseConnectionError(error)) throw error;
    return withDatabaseReadDeadline(fallback, deadlineAt - Date.now());
  }
}

function databaseReadTimeout() {
  const error = new Error('Kết nối Supabase phản hồi quá lâu. Vui lòng thử lại.');
  error.code = 'DATABASE_READ_TIMEOUT';
  return error;
}

// Prisma middleware represents `$queryRaw(Prisma.sql\`...\`)` as an array
// whose first item contains the SQL template strings. `$queryRawUnsafe` uses
// an array whose first item is the SQL text. Normalize both forms so tagged
// reports cannot accidentally bypass the read queue.
function rawQueryText(args) {
  if (typeof args?.query === 'string') return args.query;
  if (typeof args?.sql === 'string') return args.sql;
  const first = Array.isArray(args) ? args[0] : null;
  if (typeof first === 'string') return first;
  if (Array.isArray(first?.strings)) return first.strings.join(' $1 ');
  if (Array.isArray(args?.strings)) return args.strings.join(' $1 ');
  return '';
}

function sqlForClassification(sql) {
  return String(sql || '')
    // Match tokens in one pass: a comment marker inside a literal is not a
    // comment and must not hide a following mutation/lock from classification.
    .replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ');
}

function createPrismaReadRecovery({ concurrency = 3, timeoutMs = 15000, queueTimeoutMs = timeoutMs, rawTimeoutMs = 30000, retryDelayMs = 250, maxQueued = 64, replay } = {}) {
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
    // Raw reports used to bypass the queue and consume the whole pool. Only
    // admit read-shaped SELECT/WITH queries; mutations and locking statements
    // keep their original semantics. Raw SQL is never automatically replayed.
    const rawSql = sqlForClassification(rawQueryText(params.args));
    const isRawQuery = params.action === 'queryRaw'
      && /^\s*(SELECT|WITH)\b/i.test(rawSql)
      && !/\b(INSERT|UPDATE|DELETE|MERGE|CALL|INTO|ALTER|CREATE|DROP|TRUNCATE|LOCK|FOR\s+(?:KEY\s+)?SHARE|pg_(?:try_)?advisory\w*|nextval|setval)\b/i.test(rawSql);
    if (replayContext.getStore() || params.runInTransaction || (!reads.has(params.action) && !isRawQuery)) return next(params);
    const queueDeadlineAt = Date.now() + queueTimeoutMs;
    let deadlineAt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const release = await acquire((deadlineAt ?? queueDeadlineAt) - Date.now());
      // Time spent behind healthy reads is not a slow database query. Give the
      // actual execution its bounded budget after admission; retries still
      // share that single execution deadline.
      deadlineAt ??= Date.now() + (isRawQuery ? rawTimeoutMs : timeoutMs);
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
        if (isRawQuery || attempt === 1 || typeof replay !== 'function' || !isTransientDatabaseConnectionError(error)) throw error;
        await withDatabaseReadDeadline(
          () => new Promise(resolve => setTimeout(resolve, retryDelayMs)),
          deadlineAt - Date.now(),
        );
      }
    }
  };
}

module.exports = { desktopPrismaUrl, supabaseSessionPoolUrl, isSessionPoolUnavailable, createSwitchableClient, withDatabaseReadDeadline, withIsolatedReadFallback, createPrismaReadRecovery, rawQueryText };
