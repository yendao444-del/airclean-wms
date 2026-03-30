/**
 * ZKTeco ADMS Push Server — Ronald Jack 1800 WiFi
 * 
 * Máy Ronald Jack 1800 WiFi CHỈ hỗ trợ giao thức ADMS (Push).
 * Máy sẽ tự động gửi dữ liệu chấm công lên server qua HTTP.
 * 
 * Flow: Máy vân tay → POST /iclock/cdata → Server nhận & lưu
 *       Máy vân tay → GET /iclock/getrequest → Server trả lệnh (nếu có)
 */

const http = require('http');
const url = require('url');

// In-memory storage
let attendanceLogs = [];
let users = [];
let deviceInfo = {};
let lastPushTime = null;
let serverInstance = null;
let isRunning = false;

const ADMS_PORT = 8098; // Port nội bộ cho ADMS server

/**
 * Parse attendance log từ body ADMS
 * Format: "1\t2026-03-30 08:15:23\t0\t1\t\t0\t0"
 * Fields: userId, timestamp, status, verify, workcode, reserved1, reserved2
 */
function parseAttendanceLogs(body) {
    const lines = body.trim().split('\n').filter(l => l.trim());
    const parsed = [];
    
    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
            const userId = parts[0]?.trim();
            const timestamp = parts[1]?.trim();
            
            if (userId && timestamp) {
                parsed.push({
                    odUserId: userId,
                    timestamp: timestamp,
                    name: `NV #${userId}`,
                    date: timestamp.split(' ')[0] || '',
                    time: timestamp.split(' ')[1] || '',
                    shift: detectShift(timestamp),
                    status: 'OK',
                    source: 'ADMS_PUSH',
                });
            }
        }
    }
    
    return parsed;
}

/**
 * Parse user info từ body ADMS
 * Format: "USER PIN=1\tName=Nguyen Van A\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0\tViceCard="
 */
function parseUsers(body) {
    const lines = body.trim().split('\n').filter(l => l.trim());
    const parsed = [];
    
    for (const line of lines) {
        if (!line.startsWith('USER')) continue;
        
        const fields = {};
        const parts = line.replace('USER ', '').split('\t');
        for (const part of parts) {
            const [key, val] = part.split('=');
            if (key) fields[key.trim()] = (val || '').trim();
        }
        
        if (fields.PIN) {
            parsed.push({
                uid: parseInt(fields.PIN) || 0,
                id: fields.PIN,
                name: fields.Name || `User ${fields.PIN}`,
                role: parseInt(fields.Pri) || 0,
                cardno: fields.Card || '',
            });
        }
    }
    
    return parsed;
}

function detectShift(timestamp) {
    try {
        const hour = new Date(timestamp).getHours();
        return hour < 12 ? 'Sáng' : 'Chiều';
    } catch { return 'N/A'; }
}

/**
 * Start ADMS HTTP Server
 */
function startServer(port = ADMS_PORT) {
    return new Promise((resolve, reject) => {
        if (serverInstance && isRunning) {
            console.log(`⚠️ [ADMS] Server đã chạy trên port ${port}`);
            resolve({ success: true, port, message: 'Server đã chạy sẵn' });
            return;
        }

        serverInstance = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const pathname = parsedUrl.pathname;
            const query = parsedUrl.query;
            const sn = query.SN || 'unknown';

            // Log mọi request
            console.log(`📡 [ADMS] ${req.method} ${pathname} SN=${sn} table=${query.table || '-'}`);

            // === POST /iclock/cdata — Máy gửi data lên ===
            if (req.method === 'POST' && pathname.includes('/iclock/cdata')) {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    const table = query.table || '';
                    
                    console.log(`📥 [ADMS] Data từ SN=${sn}, table=${table}, size=${body.length}`);
                    console.log(`📥 [ADMS] Raw data:\n${body.substring(0, 500)}`);
                    
                    if (table === 'ATTLOG' || table === 'attlog') {
                        // Attendance logs
                        const newLogs = parseAttendanceLogs(body);
                        // Deduplicate
                        for (const log of newLogs) {
                            const exists = attendanceLogs.find(
                                l => l.odUserId === log.odUserId && l.timestamp === log.timestamp
                            );
                            if (!exists) {
                                attendanceLogs.push(log);
                            }
                        }
                        lastPushTime = new Date().toISOString();
                        console.log(`✅ [ADMS] Nhận ${newLogs.length} bản ghi chấm công (tổng: ${attendanceLogs.length})`);
                        
                    } else if (table === 'OPERLOG' || table === 'operlog') {
                        // Operation logs (thiết lập, admin actions)
                        console.log(`📋 [ADMS] Operation log từ SN=${sn}`);
                        
                    } else if (table === 'user') {
                        // User data
                        const newUsers = parseUsers(body);
                        if (newUsers.length > 0) {
                            users = newUsers;
                            console.log(`✅ [ADMS] Nhận ${newUsers.length} nhân viên`);
                        }
                    } else {
                        console.log(`📋 [ADMS] Nhận data bảng "${table}" từ SN=${sn}`);
                    }
                    
                    // Update device info
                    deviceInfo = {
                        serialNumber: sn,
                        lastSeen: new Date().toISOString(),
                        ip: req.socket.remoteAddress,
                    };

                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('OK');
                });
                return;
            }

            // === GET /iclock/cdata — Máy lấy cấu hình ===
            if (req.method === 'GET' && pathname.includes('/iclock/cdata')) {
                console.log(`📡 [ADMS] Handshake từ SN=${sn}`);
                
                deviceInfo = {
                    serialNumber: sn,
                    lastSeen: new Date().toISOString(),
                    ip: req.socket.remoteAddress,
                };
                
                // Trả config để máy biết gửi data dạng gì
                const config = [
                    'GET OPTION FROM: ' + sn,
                    'ATTLOGStamp=0',
                    'OPERLOGStamp=0',
                    'ATTPHOTOStamp=0',
                    'ErrorDelay=10',
                    'Delay=1',
                    'TransTimes=00:00;01:00;02:00;03:00;04:00;05:00;06:00;07:00;08:00;09:00;10:00;11:00;12:00;13:00;14:00;15:00;16:00;17:00;18:00;19:00;20:00;21:00;22:00;23:00',
                    'TransInterval=1',
                    'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP',
                    'TimeZone=7',
                    'Realtime=1',
                    'Encrypt=0',
                ].join('\n');
                
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(config);
                return;
            }

            // === GET /iclock/getrequest — Máy hỏi có lệnh gì không ===
            if (req.method === 'GET' && pathname.includes('/iclock/getrequest')) {
                // Trả OK = không có lệnh gì
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
                return;
            }

            // === GET /iclock/devicecmd — Xác nhận lệnh ===
            if (pathname.includes('/iclock/devicecmd')) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
                return;
            }

            // Default
            console.log(`⚠️ [ADMS] Unknown: ${req.method} ${pathname}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        });

        serverInstance.on('error', (err) => {
            console.error(`❌ [ADMS] Server error:`, err.message);
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Port ${port} đang bị chiếm. Thử port khác.`));
            } else {
                reject(err);
            }
        });

        serverInstance.listen(port, '0.0.0.0', () => {
            isRunning = true;
            console.log(`✅ [ADMS] Server lắng nghe trên port ${port} (0.0.0.0)`);
            console.log(`📡 [ADMS] Chờ máy vân tay Ronald Jack gửi data...`);
            resolve({ success: true, port, message: `ADMS Server chạy trên port ${port}` });
        });
    });
}

/**
 * Stop ADMS server
 */
function stopServer() {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        isRunning = false;
        console.log('🔌 [ADMS] Server đã dừng');
    }
    return { success: true };
}

/**
 * Get current data (IPC caller)
 */
function getData() {
    // Map user names to logs
    const enrichedLogs = attendanceLogs.map(log => {
        const user = users.find(u => String(u.id) === String(log.odUserId));
        return {
            ...log,
            name: user?.name || log.name,
            empId: parseInt(log.odUserId) || 0,
            time: log.timestamp,
        };
    });
    
    // Sort mới nhất trước
    enrichedLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return {
        success: true,
        logs: enrichedLogs,
        users: users,
        logCount: enrichedLogs.length,
        userCount: users.length,
        syncTime: lastPushTime,
        deviceInfo: deviceInfo,
        serverRunning: isRunning,
    };
}

/**
 * Get status
 */
function getStatus() {
    return {
        isRunning,
        port: ADMS_PORT,
        lastPushTime,
        logCount: attendanceLogs.length,
        userCount: users.length,
        deviceInfo,
    };
}

/**
 * Clear cached data
 */
function clearData() {
    attendanceLogs = [];
    users = [];
    lastPushTime = null;
    return { success: true, message: 'Đã xóa cache' };
}

module.exports = {
    startServer,
    stopServer,
    getData,
    getStatus,
    clearData,
    ADMS_PORT,
};
