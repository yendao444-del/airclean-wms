// Coalesce polling/events within one desktop and back off after failure.
function createWorkspaceSync({ run, changed, failed, now = Date.now, intervalMs = 120000 }) {
  let inFlight = null;
  let nextAttemptAt = 0;
  return function schedule(actor) {
    if (inFlight) return inFlight;
    if (now() < nextAttemptAt) return Promise.resolve();
    inFlight = Promise.resolve().then(() => run(actor)).then(result => {
      if (result?.history?.length) changed(result);
    }).catch(failed).finally(() => {
      nextAttemptAt = now() + intervalMs;
      inFlight = null;
    });
    return inFlight;
  };
}

const TRANSACTION_OPTIONS = { timeout: 120000, maxWait: 15000 };

function isRolledBackTransactionError(error) {
  const detail = `${error?.message || ''} ${error?.meta?.error || ''}`;
  const codes = [String(error?.code || ''), String(error?.meta?.code || '')];
  return codes.some(code => ['P2034', '55P03', '40001', '40P01'].includes(code))
    || /lock timeout|deadlock|could not serialize/i.test(detail)
    || (error?.code === 'P2028' && /transaction not found|old closed transaction|expired|already closed|timed out/i.test(detail));
}

async function runWorkspaceTransaction(client, work, { wait = delay => new Promise(resolve => setTimeout(resolve, delay)) } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let callbackCompleted = false;
    try {
      return await client.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
        const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('inventory-global-stock-mutation')) AS acquired`;
        const result = locks[0]?.acquired ? await work(tx) : { history: [] };
        callbackCompleted = true;
        return result;
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (attempt === 1 || !isRolledBackTransactionError(error)
          || (callbackCompleted && error?.code !== 'P2034' && error?.meta?.code !== '40001' && error?.meta?.code !== '40P01')) throw error;
      await wait(250 * (attempt + 1));
    }
  }
}

module.exports = { createWorkspaceSync, runWorkspaceTransaction };
