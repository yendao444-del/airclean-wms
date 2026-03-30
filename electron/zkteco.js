/**
 * ZKTeco / Ronald Jack Attendance Device Integration
 * Giao tiếp TCP/IP qua port 4370 (ZK Protocol)
 * 
 * Device: Ronald Jack (rebranded ZKTeco)
 * Serial: ZYSG30089556
 * IP: 192.168.1.225
 * Port: 4370 (default)
 */

const ZKLib = require('node-zklib');

// Device config (có thể cấu hình từ settings)
const DEFAULT_CONFIG = {
    ip: '192.168.1.225',
    port: 4370,
    timeout: 5200,      // inactivity timeout
    connectTimeout: 5000  // connection timeout
};

let zkInstance = null;
let isConnected = false;
let lastSyncTime = null;
let cachedAttendanceLogs = [];
let cachedUsers = [];

/**
 * Kết nối tới máy chấm công
 */
async function connect(config = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    
    try {
        // Ngắt kết nối cũ nếu có
        if (zkInstance) {
            try { await zkInstance.disconnect(); } catch (e) { /* ignore */ }
        }

        console.log(`🔌 [ZKTeco] Đang kết nối ${cfg.ip}:${cfg.port}...`);
        zkInstance = new ZKLib(cfg.ip, cfg.port, cfg.timeout, cfg.connectTimeout);
        
        await zkInstance.createSocket();
        isConnected = true;
        console.log(`✅ [ZKTeco] Đã kết nối thành công tới ${cfg.ip}:${cfg.port}`);
        
        return {
            success: true,
            message: `Đã kết nối máy chấm công tại ${cfg.ip}`,
            deviceInfo: await getDeviceInfo()
        };
    } catch (err) {
        isConnected = false;
        zkInstance = null;
        const errMsg = err?.message || err?.code || (typeof err === 'string' ? err : JSON.stringify(err));
        console.error(`❌ [ZKTeco] Kết nối thất bại:`, errMsg, err);
        
        return {
            success: false,
            error: errMsg || 'Không thể kết nối tới máy chấm công',
            hint: getConnectionHint(err)
        };
    }
}

/**
 * Ngắt kết nối
 */
async function disconnect() {
    try {
        if (zkInstance) {
            await zkInstance.disconnect();
        }
    } catch (e) { /* ignore */ }
    
    isConnected = false;
    zkInstance = null;
    console.log('🔌 [ZKTeco] Đã ngắt kết nối');
    return { success: true };
}

/**
 * Lấy thông tin thiết bị
 */
async function getDeviceInfo() {
    if (!zkInstance || !isConnected) return null;
    
    try {
        const info = await zkInstance.getInfo();
        return {
            serialNumber: info?.serialNumber || 'N/A',
            firmwareVersion: info?.firmwareVersion || 'N/A',
            platform: info?.platform || 'N/A',
            userCount: info?.userCounts || 0,
            logCount: info?.logCounts || 0,
            ip: DEFAULT_CONFIG.ip,
        };
    } catch (err) {
        console.warn('⚠️ [ZKTeco] Không lấy được device info:', err.message);
        return { ip: DEFAULT_CONFIG.ip, error: err.message };
    }
}

/**
 * Lấy danh sách nhân viên đã đăng ký trên máy
 */
async function getUsers() {
    if (!zkInstance || !isConnected) {
        return { success: false, error: 'Chưa kết nối máy chấm công' };
    }
    
    try {
        const users = await zkInstance.getUsers();
        cachedUsers = (users?.data || []).map(u => ({
            uid: u.uid,
            id: u.userId,
            name: u.name || `User ${u.userId}`,
            role: u.role, // 0=user, 14=admin
            cardno: u.cardno || '',
        }));
        
        console.log(`✅ [ZKTeco] Lấy được ${cachedUsers.length} nhân viên`);
        return { success: true, data: cachedUsers, count: cachedUsers.length };
    } catch (err) {
        console.error('❌ [ZKTeco] Lỗi lấy danh sách NV:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Lấy dữ liệu chấm công (attendance logs)
 * Đây là hàm quan trọng nhất — đọc toàn bộ logs từ máy
 */
async function getAttendanceLogs() {
    if (!zkInstance || !isConnected) {
        return { success: false, error: 'Chưa kết nối máy chấm công' };
    }
    
    try {
        const logs = await zkInstance.getAttendances();
        const rawData = logs?.data || [];
        
        cachedAttendanceLogs = rawData.map(log => ({
            odId: log.id,
            odUserId: log.deviceUserId,       // ID nhân viên trên máy
            timestamp: log.recordTime,          // Thời gian chấm công
            // Tìm tên NV từ cache
            name: cachedUsers.find(u => String(u.id) === String(log.deviceUserId))?.name || `NV #${log.deviceUserId}`,
            // Parse thêm thông tin
            date: formatDate(log.recordTime),
            time: formatTime(log.recordTime),
            shift: detectShift(log.recordTime),
            status: 'OK', // Sẽ tính toán muộn/sớm dựa trên cấu hình
        }));
        
        // Sort theo thời gian gần nhất trước
        cachedAttendanceLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        lastSyncTime = new Date().toISOString();
        console.log(`✅ [ZKTeco] Lấy được ${cachedAttendanceLogs.length} bản ghi chấm công`);
        
        return {
            success: true,
            data: cachedAttendanceLogs,
            count: cachedAttendanceLogs.length,
            syncTime: lastSyncTime,
        };
    } catch (err) {
        console.error('❌ [ZKTeco] Lỗi lấy dữ liệu chấm công:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Sync đầy đủ: kết nối → lấy NV → lấy logs → ngắt
 */
async function fullSync(config = {}) {
    console.log('🔄 [ZKTeco] Bắt đầu Full Sync...');
    
    // 1. Kết nối
    const connResult = await connect(config);
    if (!connResult.success) return connResult;
    
    try {
        // 2. Lấy danh sách NV trước (để map tên)
        const usersResult = await getUsers();
        
        // 3. Lấy logs chấm công
        const logsResult = await getAttendanceLogs();
        
        // 4. Ngắt kết nối
        await disconnect();
        
        return {
            success: true,
            users: usersResult.data || [],
            logs: logsResult.data || [],
            userCount: usersResult.count || 0,
            logCount: logsResult.count || 0,
            syncTime: lastSyncTime,
            deviceInfo: connResult.deviceInfo,
        };
    } catch (err) {
        await disconnect();
        return { success: false, error: err.message };
    }
}

/**
 * Lấy trạng thái kết nối
 */
function getStatus() {
    return {
        isConnected,
        lastSyncTime,
        cachedLogCount: cachedAttendanceLogs.length,
        cachedUserCount: cachedUsers.length,
        deviceIp: DEFAULT_CONFIG.ip,
        devicePort: DEFAULT_CONFIG.port,
    };
}

// ===== HELPERS =====

function formatDate(timestamp) {
    try {
        const d = new Date(timestamp);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch { return ''; }
}

function formatTime(timestamp) {
    try {
        const d = new Date(timestamp);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    } catch { return ''; }
}

function detectShift(timestamp) {
    try {
        const hour = new Date(timestamp).getHours();
        return hour < 12 ? 'Sáng' : 'Chiều';
    } catch { return 'N/A'; }
}

function getConnectionHint(err) {
    const msg = err.message?.toLowerCase() || '';
    if (msg.includes('timeout') || msg.includes('timed out')) {
        return '⏱️ Máy chấm công không phản hồi. Kiểm tra:\n' +
               '1. Máy chấm công có bật và kết nối WiFi không?\n' +
               '2. Máy tính và máy chấm công cùng mạng nội bộ?\n' +
               '3. IP 192.168.1.225 có đúng không? (Kiểm tra trên máy: Menu → Comm → Ethernet)';
    }
    if (msg.includes('econnrefused') || msg.includes('refused')) {
        return '🚫 Máy chấm công từ chối kết nối. Port 4370 có thể đang bị chặn.';
    }
    if (msg.includes('enetunreach') || msg.includes('network')) {
        return '🔌 Không tìm thấy mạng. Kiểm tra kết nối WiFi/LAN của máy tính.';
    }
    return '❓ Kiểm tra lại IP, port, và kết nối mạng của máy chấm công.';
}

module.exports = {
    connect,
    disconnect,
    getDeviceInfo,
    getUsers,
    getAttendanceLogs,
    fullSync,
    getStatus,
    DEFAULT_CONFIG,
};
