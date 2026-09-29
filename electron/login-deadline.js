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

function loginErrorMessage(error) {
    const code = error?.code || error?.errorCode;
    if (['LOGIN_TIMEOUT', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code)
        || /can't reach database server|socket timeout|connection pool|connection.*closed/i.test(error?.message || '')) {
        return CONNECTION_MESSAGE;
    }
    // Do not send Prisma queries, connection hosts or internal details to the UI.
    if (String(code || '').startsWith('P') || error?.name?.startsWith('Prisma')) {
        return 'Không thể xác minh tài khoản với cơ sở dữ liệu. Vui lòng thử lại sau.';
    }
    return error?.message || 'Không thể đăng nhập. Vui lòng thử lại.';
}

module.exports = { createLoginDeadline, loginErrorMessage };
