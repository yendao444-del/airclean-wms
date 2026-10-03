const CONNECTION_MESSAGE = 'Không nhận được phản hồi từ cơ sở dữ liệu Supabase. Vui lòng kiểm tra kết nối mạng hoặc trạng thái máy chủ rồi thử lại. Không cần đổi mật khẩu.';

function createLoginDeadline(timeoutMs = 15000) {
    const expiresAt = Date.now() + timeoutMs;
    const timeoutError = () => Object.assign(new Error(CONNECTION_MESSAGE), { code: 'LOGIN_TIMEOUT' });
    return {
        async wait(operation) {
            const remaining = expiresAt - Date.now();
            if (remaining <= 0) throw timeoutError();
            let timer;
            try {
                return await Promise.race([
                    Promise.resolve().then(operation),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError()), remaining); }),
                ]);
            } finally {
                clearTimeout(timer);
            }
        },
    };
}

function isTransientDatabaseConnectionError(error) {
    if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error?.code || error?.errorCode)) return true;
    // Supavisor may report an upstream connection timeout without a Prisma
    // code. Invalid credentials/SQL and local deadline expiry are not retried.
    return /can't reach database server|socket timeout|connection pool|connection.*closed|server has closed the connection|connection reset|forcibly closed|failed to connect to database.*(?:timeout|authentication did not complete)/is.test(
        `${error?.message || ''} ${error?.meta?.message || ''}`,
    );
}

// Only use for reads: replaying writes after a connection error can duplicate
// a committed operation. Both attempts share one deadline, and a late read
// cannot authenticate after the caller has received a timeout.
async function readWithConnectionRetry(read, { timeoutMs = 15000, retryDelayMs = 250 } = {}) {
    const deadline = createLoginDeadline(timeoutMs);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return await deadline.wait(() => read(attempt));
        } catch (error) {
            if (attempt === 1 || !isTransientDatabaseConnectionError(error)) throw error;
            await deadline.wait(() => new Promise(resolve => setTimeout(resolve, retryDelayMs)));
        }
    }
}

function loginErrorMessage(error) {
    const code = error?.code || error?.errorCode;
    if (code === 'LOGIN_TIMEOUT' || isTransientDatabaseConnectionError(error)) {
        return CONNECTION_MESSAGE;
    }
    // Do not send Prisma queries, connection hosts or internal details to the UI.
    if (String(code || '').startsWith('P') || error?.name?.startsWith('Prisma')) {
        return 'Không thể xác minh tài khoản với cơ sở dữ liệu. Vui lòng thử lại sau.';
    }
    return error?.message || 'Không thể đăng nhập. Vui lòng thử lại.';
}

module.exports = { createLoginDeadline, loginErrorMessage, isTransientDatabaseConnectionError, readWithConnectionRetry };
