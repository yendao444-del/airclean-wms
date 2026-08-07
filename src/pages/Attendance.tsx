import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer, Legend } from 'recharts';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
import {
    STOCK_CHECK_MISSING_FINE,
    STOCK_CHECK_POLICY_START_DATE,
    isPastStockCheckWorkingDay,
} from '../lib/workCalendar';
import './Attendance.css';
import dayjs from 'dayjs';
import {
    Card,
    Table,
    Tag,
    Typography,
    Button,
    Form,
    Input,
    Select,
    Dropdown,
    Space,
    Modal,
    InputNumber,
    Statistic,
    Row,
    Col,
    Tooltip,
    Badge,
    Divider,
    Tabs,
    message,
    Drawer,
    Spin,
    DatePicker,
    Collapse,
    Popover,
} from 'antd';
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    MinusCircleOutlined,
    SettingOutlined,
    SyncOutlined,
    CalendarOutlined,
    LeftOutlined,
    RightOutlined,
    UserOutlined,
    WarningOutlined,
    SaveOutlined,
    CoffeeOutlined,
    LockOutlined,
    DollarOutlined,
    DownOutlined,
    GiftOutlined,
    StopOutlined,
    TeamOutlined,
    PlusOutlined,
    FileTextOutlined,
    EyeOutlined,
    WalletOutlined,
    HistoryOutlined,
    ProfileOutlined,
    DeleteOutlined,
    EditOutlined,
    ExclamationCircleOutlined,
    CameraOutlined,
    SmileOutlined,
    BankOutlined,
    QrcodeOutlined,
    SafetyCertificateOutlined,
    SendOutlined,
} from '@ant-design/icons';

// Khởi tạo Audio Context toàn cục cho việc phát âm báo Ting
export let sharedAudioCtx: AudioContext | null = null;

interface LeaveRequest {
    id: string;
    empId: number;
    date: string; // YYYY-MM-DD
    session: 'morning' | 'afternoon';
    exempt?: boolean;
    note?: string;
    createdAt?: string;
    createdBy?: string;
}

interface WorkScheduleRecord {
    id: string;
    empId: number;
    date: string; // YYYY-MM-DD
    session: 'morning' | 'afternoon';
    note?: string;
    createdAt?: string;
    createdBy?: string;
}

type LeaveSession = 'morning' | 'afternoon';
export const playTingSound = () => {
    try {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (sharedAudioCtx?.state === 'suspended') sharedAudioCtx.resume();
        const actx = sharedAudioCtx!;
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.connect(gain); gain.connect(actx.destination);
        osc.type = 'sine'; osc.frequency.value = 1046.50; // C5 note (ting)
        gain.gain.setValueAtTime(0.3, actx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.3);
        osc.start(actx.currentTime); osc.stop(actx.currentTime + 0.3);
    } catch (e) { console.error('Audio ting error', e); }
};

const { Title, Text } = Typography;

// ===== TYPES =====
interface Employee {
    id: number;
    name: string;
    username: string;
    type: 'Official' | 'Seasonal';
    baseSalary: number;
    isHourly?: boolean;
    bankId?: string;
    bankAccount?: string;
    bankAccountName?: string;
}

interface ShiftStatus {
    am: 0 | 1 | 2;
    pm: 0 | 1 | 2;
}

interface FineRecord {
    id?: string;
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string; // ISO string — ngày tạo phạt
    source?: string; // nguồn tạo phạt
    disabled?: boolean;
}

const ensureFineId = (fine: FineRecord, index = 0): FineRecord => ({
    ...fine,
    id: fine.id || `fine-${fine.source || 'manual'}-${fine.empId}-${fine.date || 'nodate'}-${fine.amount || 0}-${index}`,
});

const getFineOverrideKey = (fine: FineRecord) => [
    fine.source || 'system',
    fine.empId,
    fine.type,
    fine.detail,
    fine.date || '',
    fine.amount,
].join('|');

const getFineContentKey = (fine: Partial<FineRecord> | undefined) => {
    if (!fine) return '';
    return [
        fine.source || 'manual',
        fine.empId || '',
        fine.type || '',
        fine.detail || '',
        fine.date || '',
        fine.amount || 0,
    ].join('|');
};

const getFineRecordKey = (fine: Partial<FineRecord> | undefined) => {
    if (!fine) return '';
    return fine.id || getFineContentKey(fine);
};

const getFineRecordKeys = (fine: Partial<FineRecord> | undefined) => {
    if (!fine) return [];
    return [fine.id || '', getFineContentKey(fine)].filter(Boolean);
};

const getDeletedFineKeys = (logs: any[] = []) => new Set(
    logs
        .filter(log => log?.action === 'delete' && log?.before)
        .flatMap(log => getFineRecordKeys(log.before))
        .filter(Boolean)
);

const mergeFinesWithDeletes = (
    dbFines: FineRecord[] = [],
    snapshotFines: FineRecord[] = [],
    auditLogs: any[] = [],
    dbAuditLogs: any[] = [],
    snapshotAuditLogs: any[] = [],
) => {
    const deletedKeys = getDeletedFineKeys(auditLogs);
    const merged = new Map<string, FineRecord>();
    const dbLogIds = new Set(dbAuditLogs.map(log => log?.id).filter(Boolean));
    const snapshotHasNewChange = (fine: FineRecord) => snapshotAuditLogs.some(log => {
        if (!log?.id || dbLogIds.has(log.id)) return false;
        const target = log.after || log.before;
        return target && getFineRecordKeys(target).some(key => key === fine.id || key === getFineContentKey(fine));
    });

    dbFines.forEach((fine, index) => {
        const fineWithId = ensureFineId(fine, index);
        const key = getFineRecordKey(fine);
        const deleted = getFineRecordKeys(fineWithId).some(item => deletedKeys.has(item));
        if (key && !deleted) merged.set(key, fineWithId);
    });

    snapshotFines.forEach((fine, index) => {
        const fineWithId = ensureFineId(fine, index);
        const key = getFineRecordKey(fine);
        const deleted = getFineRecordKeys(fineWithId).some(item => deletedKeys.has(item));
        // A stale renderer must not overwrite a fine that was edited in the DB.
        // A local record wins only when this snapshot also contains a new audit action for it.
        if (key && !deleted && (!merged.has(key) || snapshotHasNewChange(fineWithId))) {
            merged.set(key, fineWithId);
        }
    });

    return Array.from(merged.values());
};

const mergeAuditLogs = (dbLogs: any[] = [], snapshotLogs: any[] = []) => {
    const merged = new Map<string, any>();
    [...dbLogs, ...snapshotLogs].forEach((log, index) => {
        const key = log?.id || `${log?.timestamp || ''}|${log?.action || ''}|${log?.note || ''}|${index}`;
        merged.set(key, log);
    });
    return Array.from(merged.values());
};

const getReturnFineCode = (detail?: string) => {
    const match = String(detail || '').match(/Mã phiếu:\s*([^)]+)/i);
    return match?.[1]?.trim() || '';
};

const normalizeReturnFineDates = async (api: any, extraFines: FineRecord[]) => {
    const returnCodes = Array.from(new Set(
        (extraFines || [])
            .filter(fine => fine.source === 'returns')
            .map(fine => getReturnFineCode(fine.detail))
            .filter(Boolean)
    ));
    if (returnCodes.length === 0 || !api?.returns?.getAll) {
        return { fines: extraFines || [], changed: false };
    }

    const returnsRes = await api.returns.getAll();
    if (!returnsRes?.success || !Array.isArray(returnsRes.data)) {
        return { fines: extraFines || [], changed: false };
    }

    const returnDateByCode = new Map<string, string>();
    returnsRes.data.forEach((row: any) => {
        const code = String(row.complaintCode || row.returnCode || '').trim();
        const date = row.complaintDate || row.returnDate;
        if (code && date && dayjs(date).isValid()) {
            returnDateByCode.set(code, dayjs(date).toISOString());
        }
    });

    let changed = false;
    const fines = (extraFines || []).map((fine) => {
        if (fine.source !== 'returns') return fine;
        const code = getReturnFineCode(fine.detail);
        const fixedDate = returnDateByCode.get(code);
        if (!fixedDate || fine.date === fixedDate) return fine;
        changed = true;
        return { ...fine, date: fixedDate };
    });

    return { fines, changed };
};

interface PurchaseVatTracking {
    id: number;
    poNumber?: string;
    supplierName?: string;
    createdBy?: string;
    createdAt?: string;
    purchaseDate?: string;
    vatInvoiceStatus?: string;
    vatGroupId?: string | null;
    vatGroupHasVat?: boolean;
    companyVatByGroup?: Record<string, { status?: string }>;
}

interface BonusRecord {
    id: string;
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string; // ISO string — ngày tạo thưởng
    overtimeHours?: number;
    overtimeRate?: number;
}

interface LockedPeriod {
    id: string;
    start: string; // ISO — đầu kỳ
    end: string;   // ISO — cuối kỳ
    lockedAt: string;
    lockedBy: string;
}

interface BonusAuditLog {
    id: string;
    bonusId: string;
    action: 'create' | 'edit' | 'delete';
    timestamp: string;
    before?: Partial<BonusRecord>;
    after?: Partial<BonusRecord>;
    note: string;
}

interface FineAuditLog {
    id: string;
    action: 'create' | 'edit' | 'delete';
    timestamp: string;
    changedBy?: string;
    changedByName?: string;
    before?: Partial<FineRecord>;
    after?: Partial<FineRecord>;
    note: string;
}

interface AttendanceLog {
    empId: number;
    time: string;
    status: string;
    shift: string;
}

interface FundTransaction {
    id: string; // unique ID
    date: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    updatedBy?: string;
    note: string;
    type: 'in' | 'out';
    amount: number;
    person: string;
}

interface FundAuditLog {
    timestamp: string;
    action: 'create' | 'edit' | 'delete';
    txId: string;
    detail: string;
    oldData?: Partial<FundTransaction>;
    newData?: Partial<FundTransaction>;
}

interface PackingLog {
    id: string;
    timestamp: string;
    person: string;
    oldLevel1: number;
    oldLevel10: number;
    newLevel1: number;
    newLevel10: number;
    oldTotal: number;
    newTotal: number;
    note: string;
}

// === Chi tiết đóng gói theo từng đơn hàng (giống Thẻ kho) ===
interface PackingOrderItem {
    sku: string;
    productName: string;
    variant?: string;
    quantity: number;
}

interface PackingOrderLog {
    id: string;
    timestamp: string;
    orderNumber: string;       // Mã đơn hàng
    platform: 'Shopee' | 'TikTok' | 'POS' | 'Web' | 'Khác';
    customerName: string;
    packer: string;            // Người đóng gói
    items: PackingOrderItem[];
    totalSKU: number;          // Tổng SKU đóng cho đơn này
    status: 'completed' | 'issue'; // issue = đóng sai/thiếu
    note?: string;
}

interface PenaltyConfig {
    graceMinutes: number;
    // NV Chính thức - 3 mức phạt muộn
    officialFineLevel1: number;  // 6-15 phút
    officialFineLevel2: number;  // 16-30 phút
    officialFineLevel3: number;  // >30 phút
    // NV Thời vụ - 3 mức phạt muộn
    seasonalFineLevel1: number;
    seasonalFineLevel2: number;
    seasonalFineLevel3: number;
    // Đóng gói sai
    wrongOrderFineOfficial: number;
    wrongOrderFineSeasonal: number;
    // Ca làm việc
    morningStart: string; // '08:00'
    afternoonStart: string; // '13:30'
    // Ngày công chuẩn
    standardWorkDays: number; // 26
}

// === Điều chỉnh lương thủ công (Admin) ===
// Key = `${empId}_${YYYY-MM}` ví dụ: "3_2026-04"
interface PayrollOverride {
    extraShifts?: number;   // Thêm ca thủ công (cộng vào số ca điểm danh)
    extraAdjust?: number;   // Điều chỉnh tiền thêm (+/-)
    adjustNote?: string;    // Ghi chú điều chỉnh
    updatedAt?: string;     // Thời gian sửa
    updatedBy?: string;     // Admin nào sửa
}

const normalizeAttendanceText = (value?: string | null) =>
    (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

const findEmployeeForAttendanceLog = (
    log: { userId?: number | null; faceId?: string | null; userName?: string | null },
    employees: Employee[],
) => {
    if (!log) return null;

    if (log.userId != null) {
        const byId = employees.find(emp => emp.id === Number(log.userId));
        if (byId) return byId;
    }

    const normalizedFaceId = normalizeAttendanceText(log.faceId);
    if (normalizedFaceId) {
        // Match trực tiếp, hoặc fallback: face cũ đăng ký với username ngắn (vd: 'toan')
        // nhưng username đã migrate sang đầy đủ ('nguyendinhtoan') → kiểm tra endsWith
        const byFaceId = employees.find(emp => {
            const u = normalizeAttendanceText(emp.username);
            return u === normalizedFaceId || u.endsWith(normalizedFaceId);
        });
        if (byFaceId) return byFaceId;
    }

    const normalizedUserName = normalizeAttendanceText(log.userName);
    if (!normalizedUserName) return null;

    const byExactName = employees.find(emp => normalizeAttendanceText(emp.name) === normalizedUserName);
    if (byExactName) return byExactName;

    const byUsername = employees.find(emp => normalizeAttendanceText(emp.username) === normalizedUserName);
    if (byUsername) return byUsername;

    return null;
};

const initialEmployees: Employee[] = [
    { id: 1, name: 'Nguyễn Đình Toàn', username: 'toan', type: 'Official', baseSalary: 10000000 },
    { id: 2, name: 'Nguyễn Văn Khánh', username: 'khanh', type: 'Official', baseSalary: 10000000 },
    { id: 3, name: 'Đỗ Nguyễn Trường', username: 'truong', type: 'Seasonal', baseSalary: 25000, isHourly: true },
    { id: 4, name: 'Trần Mai Phương', username: 'phuong', type: 'Seasonal', baseSalary: 30000, isHourly: true },
];

const initialWarehousePacking = { level1Units: 6100, level10Units: 870 };

// Giá tiền đóng gói: mỗi sản phẩm (SKU cha) = 20đ
const PACKING_UNIT_PRICE = 20;

// Seed lịch sử đóng gói ban đầu
const initialPackingLogs: PackingLog[] = [
    {
        id: 'pk-seed-1',
        timestamp: '01/03/2026 08:30:00',
        person: 'Admin',
        oldLevel1: 0, oldLevel10: 0,
        newLevel1: 4200, newLevel10: 580,
        oldTotal: 0, newTotal: 4780,
        note: 'Ghi nhận sản lượng đầu tháng 03',
    },
    {
        id: 'pk-seed-2',
        timestamp: '15/03/2026 17:00:00',
        person: 'Nguyễn Đình Toàn',
        oldLevel1: 4200, oldLevel10: 580,
        newLevel1: 5500, newLevel10: 750,
        oldTotal: 4780, newTotal: 6250,
        note: 'Cập nhật giữa tháng — Nhập thêm hàng từ NCC',
    },
    {
        id: 'pk-seed-3',
        timestamp: '28/03/2026 16:45:00',
        person: 'Nguyễn Văn Khánh',
        oldLevel1: 5500, oldLevel10: 750,
        newLevel1: 6100, newLevel10: 870,
        oldTotal: 6250, newTotal: 6970,
        note: 'Chốt cuối tháng 03 — Kiểm kho lần cuối',
    },
];

// Removed mock packingOrderLogsData to use real-time state below.

const finesData: FineRecord[] = []; // Xóa mock — phạt thực nhập tay qua extraFines

const VIET_QR_BANKS = [
    { value: 'VCB', label: 'Vietcombank (VCB)' },
    { value: 'BIDV', label: 'BIDV' },
    { value: 'VTB', label: 'Vietinbank (CTG)' },
    { value: 'AGR', label: 'Agribank' },
    { value: 'TCB', label: 'Techcombank (TCB)' },
    { value: 'MB', label: 'MB Bank' },
    { value: 'VPB', label: 'VPBank' },
    { value: 'ACB', label: 'ACB' },
    { value: 'STB', label: 'Sacombank' },
    { value: 'SHB', label: 'SHB' },
    { value: 'TPB', label: 'TPBank' },
    { value: 'VIB', label: 'VIB' },
    { value: 'HDB', label: 'HDBank' },
    { value: 'OCB', label: 'OCB' },
    { value: 'MSB', label: 'MSB' },
    { value: 'EIB', label: 'Eximbank' },
    { value: 'LPB', label: 'LienVietPostBank' },
    { value: 'SEAB', label: 'SeABank' },
    { value: 'NAB', label: 'Nam A Bank' },
    { value: 'BAB', label: 'Bac A Bank' },
];

const manualBonuses: BonusRecord[] = []; // Xóa mock — thưởng nhập tay qua extraBonuses

const OVERTIME_FIRST_HOUR_RATE = 30000;
const OVERTIME_NEXT_HOUR_RATE = 40000;

const calculateOvertimeBonus = (hours: number) => {
    const normalizedHours = Math.max(Number(hours) || 0, 0);
    const firstHour = Math.min(normalizedHours, 1);
    const nextHours = Math.max(normalizedHours - 1, 0);
    return Math.round(firstHour * OVERTIME_FIRST_HOUR_RATE + nextHours * OVERTIME_NEXT_HOUR_RATE);
};

const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const attendanceMatrix: ShiftStatus[][] = [
    [{ am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 2, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }],
    [{ am: 1, pm: 1 }, { am: 1, pm: 2 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }, { am: 1, pm: 1 }],
    [{ am: 1, pm: 0 }, { am: 1, pm: 0 }, { am: 1, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 0 }, { am: 1, pm: 0 }, { am: 0, pm: 0 }],
    [{ am: 0, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 0 }, { am: 1, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }],
];

const attendanceLogs: AttendanceLog[] = []; // Xóa mock — dùng liveAttendanceLogs từ DB

const fundTransactions: FundTransaction[] = []; // Xóa mock — giao dịch thực nhập tay
const FUND_TX_EDIT_WINDOW_MS = 60 * 60 * 1000;

const getFundTxCreatedMs = (tx: FundTransaction) => {
    if (tx.createdAt) {
        const createdAt = new Date(tx.createdAt).getTime();
        if (!Number.isNaN(createdAt)) return createdAt;
    }

    const idTimestamp = String(tx.id || '').match(/^f(\d{12,})$/)?.[1];
    if (idTimestamp) {
        const createdAt = Number(idTimestamp);
        if (!Number.isNaN(createdAt)) return createdAt;
    }

    return null;
};

// ===== HELPERS =====
const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' đ';

// Tính tổng số lượng sản phẩm (theo SKU cha) trong đơn hàng
// SKU format: {prefix}-{code} e.g. "20-5DUNI-TRANG" → prefix 20 = 20 sản phẩm
// Combo 20 gói x1 = 20 SP × 20đ = 400đ
// CB- (combo mix) SKU: parse prefix tương tự hoặc tính từ combo components
const VAT_OVERDUE_FINE_AMOUNT = 30000;
const DEADLINE_OVERDUE_FINE_OFFICIAL = 50000;
const getAssignmentDeadlineFineAmount = (task: any): number => {
    try {
        const attachments = typeof task?.attachments === 'string'
            ? JSON.parse(task.attachments)
            : (task?.attachments || {});
        const amount = Number(attachments?.assignment?.deadlinePenaltyAmount);
        return Number.isFinite(amount) && amount >= 0 ? amount : DEADLINE_OVERDUE_FINE_OFFICIAL;
    } catch {
        return DEADLINE_OVERDUE_FINE_OFFICIAL;
    }
};
const getAssignmentDeadlineRecipients = (task: any): string[] => {
    try {
        const attachments = typeof task?.attachments === 'string'
            ? JSON.parse(task.attachments)
            : (task?.attachments || {});
        const recipients = attachments?.assignment?.assignees;
        if (Array.isArray(recipients) && recipients.length > 0) {
            return [...new Set(recipients.map(name => String(name || '').trim()).filter(Boolean))];
        }
    } catch {
        // Older assignments have no recipient array and use the original assignee.
    }
    return task?.assignee ? [String(task.assignee)] : [];
};
// The VAT deadline policy applies prospectively from this rollout date.
const VAT_OVERDUE_POLICY_START = dayjs('2026-07-26').startOf('day');

function calcPacksFromItems(items: PackingOrderItem[]): number {
    let totalPacks = 0;
    items.forEach(item => {
        const sku = (item.sku || '').toUpperCase();
        let packCount = 1;

        if (sku.startsWith('CB-')) {
            // Combo SKU: CB-10TRANG-10XAM-5DUNI
            // Parse các cặp {số}{tên màu} từ phần sau CB-
            // Ví dụ: "10TRANG-10XAM-5DUNI" → match "10TRANG", "10XAM" → 10+10=20
            // Suffix kiểu "-5DUNI" (loại sản phẩm) sẽ bị bỏ qua vì regex chỉ match {số}{chữ} dạng tên màu
            const body = sku.substring(3); // Bỏ "CB-"
            const segments = body.split('-');
            let comboTotal = 0;
            // Lấy các segment có dạng {số}{tên} — chỉ tính segment mà phần chữ KHÔNG chứa "UNI|DUNI|5D" (đó là tên SP, không phải màu)
            const productSuffixes = /^(5D|UNI|DUNI|5DUNI)/i;
            for (const seg of segments) {
                const m = seg.match(/^(\d+)(.+)$/);
                if (m) {
                    const num = parseInt(m[1], 10);
                    const label = m[2];
                    if (!productSuffixes.test(label)) {
                        // Đây là component màu: 10TRANG, 10XAM, v.v.
                        comboTotal += num;
                    }
                }
            }
            packCount = comboTotal > 0 ? comboTotal : 1;
        } else {
            // SKU thường: "20-5DUNI-TRANG" → prefix 20 = 20 gói
            const prefixMatch = sku.match(/^(\d+)-/);
            packCount = prefixMatch ? parseInt(prefixMatch[1], 10) : 1;
        }

        totalPacks += (item.quantity || 1) * packCount;
    });
    return totalPacks;
}

// Match packer robustly (ignores accents and case)
const matchPacker = (packerStr: any, emp: any) => {
    if (!packerStr || typeof packerStr !== 'string') return false;
    const norm = (s: any) => typeof s === 'string' ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : '';
    const p = norm(packerStr);
    const u = norm(emp.username || '');
    const n = norm(emp.name || '');
    const f = norm(emp.fullName || '');

    if (u && (p === u || p.includes(u))) return true;
    if (n && (p === n || p.includes(n))) return true;
    if (f && (p === f || f.includes(p) || p.includes(f))) return true;
    return false;
};

const matchTaskAssigneeToEmployee = (assigneeStr: any, emp: any) => {
    if (!assigneeStr || typeof assigneeStr !== 'string') return false;
    // Tasks may store a login username ("nguyenvankhanh") while the attendance
    // record uses a display name ("Nguyen Van Khanh"). Compare compact keys too.
    const toPersonKey = (value: any) => normalizeAttendanceText(String(value || '')).replace(/[^a-z0-9]/g, '');
    const assignee = toPersonKey(assigneeStr);
    const username = toPersonKey(emp.username || '');
    const name = toPersonKey(emp.name || '');
    return !!(
        (username && (assignee === username || assignee.includes(username) || username.includes(assignee))) ||
        (name && (assignee === name || assignee.includes(name) || name.includes(assignee)))
    );
};

// ===== PAYROLL CALCULATION — Cơ chế: Ai đóng gói hưởng 100% =====
function calculatePayroll(
    activeFines: FineRecord[],
    leaveRequests: LeaveRequest[],
    workSchedules: WorkScheduleRecord[],
    packingData: { level1Units: number; level10Units: number },
    employeesList: Employee[],
    bonusesData: BonusRecord[],
    liveLogs: any[],
    monthNum: number,
    yearNum: number,
    orderLogs: PackingOrderLog[],
    overrides?: Record<string, PayrollOverride>,
    attendanceDeductionsReady = true
) {
    const STANDARD_WORK_DAYS = 26;
    const HOURS_PER_SHIFT = 4;
    const unitPrice = PACKING_UNIT_PRICE; // 20đ/SP
    const totalPackValue_100 = (packingData.level1Units + packingData.level10Units) * unitPrice;
    const periodKey = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
    const today = dayjs().startOf('day');
    const daysInPayrollMonth = dayjs(`${yearNum}-${monthNum}-01`).daysInMonth();
    const isRestDay = (date: dayjs.Dayjs) => date.day() === 0 || Boolean(isPublicHoliday(date));

    return employeesList.map((emp, idx) => {
        let shifts = 0;
        let absentDays = 0;
        let extraShifts = 0;
        let extraAdjust = 0;
        let adjustNote = '';
        let hasOverride = false;

        const TOTAL_SHIFTS = STANDARD_WORK_DAYS * 2; // 52 ca
        const salaryPerShift = emp.isHourly
            ? emp.baseSalary * HOURS_PER_SHIFT  // VD: 25,000 × 4h = 100,000đ/ca
            : emp.baseSalary / TOTAL_SHIFTS;

        // === Override (áp dụng cho cả 2 loại: extraAdjust, adjustNote) ===
        const overrideKey = `${emp.id}_${periodKey}`;
        const ov = overrides?.[overrideKey];
        if (ov) {
            if (ov.extraAdjust != null && ov.extraAdjust !== 0) {
                extraAdjust = ov.extraAdjust;
                hasOverride = true;
            }
            if (ov.adjustNote) adjustNote = ov.adjustNote;
        }

        let salaryBase = 0;
        let leaveDeduction = 0;

        if (emp.type === 'Seasonal') {
            // ========== NV THỜI VỤ: Lương theo ca từ điểm danh ==========
            // Match logs cho nhân viên này
            const empLogs = liveLogs.filter((l: any) => {
                const matched = findEmployeeForAttendanceLog(l, employeesList);
                if (matched?.id === emp.id) {
                    const logDate = l.date || (l.timestamp ? l.timestamp.substring(0, 10) : '');
                    if (!logDate) return false;
                    const d = new Date(logDate);
                    return d.getMonth() + 1 === monthNum && d.getFullYear() === yearNum;
                }
                return false;
            });

            // Đếm ca: Có ít nhất 1 check-in HOẶC check-out = tính 1 ca
            const workedSessions = new Set<string>();
            if (empLogs.length > 0) {
                const dayMap = new Map<string, Set<string>>();
                empLogs.forEach((l: any) => {
                    const logDate = l.date || (l.timestamp ? l.timestamp.substring(0, 10) : '');
                    if (!logDate) return;
                    if (!dayMap.has(logDate)) dayMap.set(logDate, new Set());
                    if (l.checkType) dayMap.get(logDate)!.add(l.checkType);
                });
                dayMap.forEach((checkTypes, logDate) => {
                    if (checkTypes.has('morning_in') || checkTypes.has('morning_out')) {
                        shifts++;
                        workedSessions.add(`${logDate}|morning`);
                    }
                    if (checkTypes.has('afternoon_in') || checkTypes.has('evening_out')) {
                        shifts++;
                        workedSessions.add(`${logDate}|afternoon`);
                    }
                });
            }

            // Thêm ca thủ công (Admin)
            if (ov?.extraShifts != null && ov.extraShifts !== 0) {
                extraShifts = ov.extraShifts;
                shifts += extraShifts;
                hasOverride = true;
            }

            salaryBase = shifts * salaryPerShift;
            const requestedSessions = new Set(
                leaveRequests
                    .filter((leave) => leave.empId === emp.id && !leave.exempt)
                    .map((leave) => `${leave.date}|${leave.session}`)
            );
            const exemptSessions = new Set(
                leaveRequests
                    .filter((leave) => leave.empId === emp.id && leave.exempt)
                    .map((leave) => `${leave.date}|${leave.session}`)
            );
            let paidScheduledAbsences = 0;
            let unpaidScheduledAbsences = 0;
            if (attendanceDeductionsReady) {
                workSchedules
                    .filter((schedule) => schedule.empId === emp.id)
                    .forEach((schedule) => {
                        const date = dayjs(schedule.date);
                        if (date.month() + 1 !== monthNum || date.year() !== yearNum) return;
                        if (isRestDay(date) || !date.isBefore(today, 'day')) return;
                        const key = `${schedule.date}|${schedule.session}`;
                        if (workedSessions.has(key)) return;
                        if (exemptSessions.has(key)) return;
                        if (requestedSessions.has(key)) paidScheduledAbsences++;
                        else unpaidScheduledAbsences++;
                    });
            }
            absentDays = (paidScheduledAbsences + unpaidScheduledAbsences) / 2;
            leaveDeduction = Math.round(unpaidScheduledAbsences * salaryPerShift);
        } else {
            // ========== NV CHÍNH THỨC: Lương cố định ==========
            shifts = TOTAL_SHIFTS;
            salaryBase = emp.baseSalary;
            const empLogs = liveLogs.filter((l: any) => {
                const matched = findEmployeeForAttendanceLog(l, employeesList);
                if (matched?.id !== emp.id) return false;
                const logDate = l.date || (l.timestamp ? l.timestamp.substring(0, 10) : '');
                if (!logDate) return false;
                const d = new Date(logDate);
                return d.getMonth() + 1 === monthNum && d.getFullYear() === yearNum;
            });
            const workedSessions = new Set<string>();
            empLogs.forEach((l: any) => {
                const logDate = l.date || (l.timestamp ? l.timestamp.substring(0, 10) : '');
                if (!logDate) return;
                if (l.checkType === 'morning_in' || l.checkType === 'morning_out') workedSessions.add(`${logDate}|morning`);
                if (l.checkType === 'afternoon_in' || l.checkType === 'evening_out') workedSessions.add(`${logDate}|afternoon`);
            });
            const requestedSessions = new Set(
                leaveRequests
                    .filter((leave) => leave.empId === emp.id && !leave.exempt)
                    .map((leave) => `${leave.date}|${leave.session}`)
            );
            const exemptSessions = new Set(
                leaveRequests
                    .filter((leave) => leave.empId === emp.id && leave.exempt)
                    .map((leave) => `${leave.date}|${leave.session}`)
            );
            let paidLeaveSessions = 0;
            let unpaidLeaveSessions = 0;
            if (attendanceDeductionsReady) {
                for (let day = 1; day <= daysInPayrollMonth; day++) {
                    const date = dayjs(`${yearNum}-${monthNum}-${day}`, 'YYYY-M-D');
                    if (isRestDay(date) || !date.isBefore(today, 'day')) continue;
                    const dateStr = date.format('YYYY-MM-DD');
                    (['morning', 'afternoon'] as LeaveSession[]).forEach((session) => {
                        const key = `${dateStr}|${session}`;
                        if (workedSessions.has(key)) return;
                        if (exemptSessions.has(key)) return;
                        if (requestedSessions.has(key)) paidLeaveSessions++;
                        else unpaidLeaveSessions++;
                    });
                }
            }
            const dailySalary = emp.baseSalary / STANDARD_WORK_DAYS;
            leaveDeduction = Math.round((paidLeaveSessions * 0.5 * dailySalary) + (unpaidLeaveSessions * 0.5 * dailySalary * 2));
            absentDays = (paidLeaveSessions + unpaidLeaveSessions) / 2;
        }

        const autoShifts = shifts - extraShifts; // Số ca gốc từ điểm danh
        const autoSalaryBase = salaryBase;

        // === Tính thu nhập đóng gói CÁ NHÂN bằng match linh hoạt ===
        let packIncome = 0;
        let packOrderCount = 0;
        let packTotalUnits = 0;

        orderLogs.forEach(order => {
            if (matchPacker(order.packer || '', emp)) {
                const totalPacks = calcPacksFromItems(order.items);
                packIncome += totalPacks * unitPrice;
                packOrderCount += 1;
                packTotalUnits += totalPacks;
            }
        });

        const autoPackIncome = packIncome;

        const myFines = activeFines.filter(f => f.empId === emp.id).reduce((sum, f) => sum + f.amount, 0);

        const fineShare = 0;

        const mBonus = bonusesData.filter(b => b.empId === emp.id).reduce((sum, b) => sum + b.amount, 0);
        const totalBonus = mBonus;
        const finalSalary = salaryBase + packIncome + totalBonus - myFines - leaveDeduction + extraAdjust;
        return {
            ...emp, shifts, absentDays, salaryBase, packIncome, totalPackValue_100,
            fineShare, mBonus, myFines, totalBonus, finalSalary, leaveDeduction,
            packOrderCount, packTotalUnits,
            // Giá trị gốc (auto) để so sánh trên UI
            autoShifts, autoSalaryBase, autoPackIncome,
            extraShifts, extraAdjust, adjustNote, hasOverride, salaryPerShift,
        };
    });
}

// ===== NGÀY LỄ QUỐC GIA VIỆT NAM =====
// Ngày lễ cố định hàng năm (MM-DD)
const FIXED_HOLIDAYS: string[] = [
    '01-01', // Tết Dương lịch
    '04-30', // Giải phóng Miền Nam
    '05-01', // Quốc tế Lao động
    '09-02', // Quốc khánh
];

// Ngày lễ âm lịch/thay đổi theo từng năm (YYYY-MM-DD)
const VARIABLE_HOLIDAYS: string[] = [
    // Tết Nguyên Đán 2025
    '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03',
    // Giỗ Tổ Hùng Vương 2025
    '2025-04-07',
    // Tết Nguyên Đán 2026
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
    // Giỗ Tổ Hùng Vương 2026
    '2026-03-27',
];

const isPublicHoliday = (date: dayjs.Dayjs): string | null => {
    const mmdd = date.format('MM-DD');
    const yyyymmdd = date.format('YYYY-MM-DD');
    if (VARIABLE_HOLIDAYS.includes(yyyymmdd)) {
        if (yyyymmdd.includes('-01-28') || yyyymmdd.includes('-01-29') || yyyymmdd.includes('-01-30') ||
            yyyymmdd.includes('-01-31') || yyyymmdd.includes('-02-01') || yyyymmdd.includes('-02-02') ||
            yyyymmdd.includes('-02-03') || yyyymmdd.includes('-02-16') || yyyymmdd.includes('-02-17') ||
            yyyymmdd.includes('-02-18') || yyyymmdd.includes('-02-19') || yyyymmdd.includes('-02-20') ||
            yyyymmdd.includes('-02-21') || yyyymmdd.includes('-02-22')) return 'Tết Nguyên Đán';
        if (mmdd === '04-07' || mmdd === '03-27') return 'Giỗ Tổ Hùng Vương';
        return 'Ngày Lễ';
    }
    if (mmdd === '01-01') return 'Tết Dương Lịch';
    if (mmdd === '04-30') return 'Giải phóng Miền Nam';
    if (mmdd === '05-01') return 'Quốc tế Lao động';
    if (mmdd === '09-02') return 'Quốc khánh';
    return null;
};

// ===== PILL COMPONENT =====
const ShiftPill = ({ label, status, time, outTime }: { label: string; status: 0 | 1 | 2; time?: string; outTime?: string }) => {
    const config = {
        0: { bg: '#f5f5f5', border: '#e8e8e8', color: '#bfbfbf', icon: <MinusCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Nghỉ' },
        1: { bg: '#f6ffed', border: '#b7eb8f', color: '#52c41a', icon: <CheckCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Đúng giờ' },
        2: { bg: '#fff7e6', border: '#ffd591', color: '#fa8c16', icon: <ClockCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Đi muộn' },
    };
    const c = config[status];
    const timeInfo = time ? ` vào ${time}` : '';
    const outInfo = outTime ? ` → ra ${outTime}` : (status > 0 ? ' → chưa checkout' : '');
    const tooltipContent = `${label}: ${c.tooltip}${timeInfo}${outInfo}`;
    return (
        <Tooltip title={tooltipContent}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                padding: '2px 6px', borderRadius: 5,
                background: c.bg, color: c.color, border: `1px solid ${c.border}`,
                cursor: 'default', letterSpacing: 0.2, whiteSpace: 'nowrap',
                position: 'relative',
            }}>
                <span>{label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {c.icon}
                    {outTime && (
                        <span style={{
                            fontSize: 8, fontWeight: 600, opacity: 0.7,
                            borderLeft: '1px solid', paddingLeft: 3, marginLeft: 1,
                        }}>→{outTime}</span>
                    )}
                </span>
            </div>
        </Tooltip>
    );
};

const SundayRestCell = () => (
    <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
        color: '#bfbfbf', letterSpacing: 0.5, padding: '4px 6px',
        borderRadius: 6, border: '1.5px dashed #d9d9d9',
        background: '#fafafa', minHeight: 44,
    }}>
        <CoffeeOutlined style={{ marginRight: 3, fontSize: 10 }} /> Nghỉ
    </div>
);

const HolidayRestCell = ({ label }: { label: string }) => (
    <Tooltip title={label}>
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
            color: '#d4380d', letterSpacing: 0.5, padding: '4px 6px',
            borderRadius: 6, border: '1.5px solid #ffbb96',
            background: '#fff2e8', minHeight: 44, gap: 2,
        }}>
            <span style={{ fontSize: 13 }}>🎌</span>
            <span>Nghỉ Lễ</span>
        </div>
    </Tooltip>
);

const LeavePill = ({
    label,
    request,
    isDue,
    onClick,
}: {
    label: string;
    request?: LeaveRequest;
    isDue: boolean;
    onClick?: () => void;
}) => {
    const status = request?.exempt ? 'exempt' : (request ? (isDue ? 'paid' : 'planned') : (isDue ? 'unpaid' : 'empty'));
    const tooltip = request
        ? `${label}: ${request.exempt ? 'Miễn trừ' : (isDue ? 'Nghỉ có phép' : 'Đã xin nghỉ')}${request.note ? ` - ${request.note}` : ''}`
        : `${label}: ${isDue ? 'Nghỉ không phép' : 'Chưa có trạng thái'}`;

    return (
        <Tooltip title={tooltip}>
            <button
                type="button"
                className={`att-leave-pill att-leave-pill-${status}`}
                onClick={onClick}
                disabled={!onClick}
            >
                <span>{label}</span>
                {(request || isDue) && <span>{request ? (request.exempt ? 'Miễn trừ' : (isDue ? 'Có phép' : 'Đã xin')) : 'Không phép'}</span>}
            </button>
        </Tooltip>
    );
};

const WorkSchedulePill = ({
    label,
    schedule,
    request,
    isDue,
    onClick,
}: {
    label: string;
    schedule?: WorkScheduleRecord;
    request?: LeaveRequest;
    isDue: boolean;
    onClick?: () => void;
}) => {
    const status = request?.exempt
        ? 'exempt'
        : request
            ? (isDue ? 'paid' : 'planned')
            : (!schedule ? 'empty' : (!isDue ? 'planned' : 'unpaid'));
    const unscheduledRequestLabel = !schedule && request
        ? (request.exempt ? 'Mien tru' : (isDue ? 'Co phep' : 'Da xin'))
        : '';
    const tooltip = !schedule
        ? `${label}: Chưa có lịch làm`
        : request
            ? `${label}: ${request.exempt ? 'Đã xếp lịch, miễn trừ' : 'Đã xếp lịch, nghỉ có phép'}${request.note ? ` - ${request.note}` : ''}`
            : `${label}: ${isDue ? 'Đã xếp lịch nhưng không đi làm - không phép' : 'Đã xếp lịch làm'}`;

    return (
        <Tooltip title={tooltip}>
            <button
                type="button"
                className={`att-leave-pill att-leave-pill-${status}`}
                onClick={onClick}
                disabled={!onClick}
            >
                <span>{label}</span>
                {unscheduledRequestLabel && <span>{unscheduledRequestLabel}</span>}
                {schedule && <span>{request?.exempt ? 'Miễn trừ' : (!isDue ? 'Đã xếp' : (request ? 'Có phép' : 'Không phép'))}</span>}
            </button>
        </Tooltip>
    );
};

const InlineSchedulePopover = ({
    emp,
    date,
    session,
    schedule,
    request,
    isDue,
    onSave,
    children
}: {
    emp: any;
    date: dayjs.Dayjs;
    session: LeaveSession;
    schedule?: WorkScheduleRecord;
    request?: LeaveRequest;
    isDue: boolean;
    onSave: (action: 'save' | 'clear' | 'leave' | 'exempt', scope: LeaveSession | 'full_day', note: string) => void;
    children: React.ReactNode;
}) => {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState(schedule?.note || '');

    useEffect(() => {
        if (open) {
            setNote(schedule?.note || '');
        }
    }, [open, schedule]);

    const handleAction = (action: 'save' | 'clear' | 'leave' | 'exempt', scope: LeaveSession | 'full_day') => {
        onSave(action, scope, note);
        setOpen(false);
    };

    const sessionLabel = session === 'morning' ? 'Ca sáng' : 'Ca chiều';

    const content = (
        <div style={{ width: 210, padding: '2px 0' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 8, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CalendarOutlined style={{ color: '#722ed1', fontSize: 13 }} />
                <span>Xếp ca: {emp.name}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <Button
                    type="primary"
                    size="small"
                    style={{ background: '#722ed1', color: '#fff', border: 'none', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('save', session)}
                >
                    ⚡ Xếp {sessionLabel}
                </Button>
                <Button
                    size="small"
                    style={{ background: '#f5f3ff', color: '#722ed1', border: '1px solid #d8b4fe', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('save', 'full_day')}
                >
                    📅 Xếp cả ngày (Sáng + Chiều)
                </Button>
                <Button
                    size="small"
                    style={{ background: '#fff1f0', color: '#cf1322', border: '1px solid #ffa39e', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('leave', session)}
                >
                    🚫 Báo xin nghỉ {sessionLabel}
                </Button>
                <Button
                    size="small"
                    style={{ background: '#ecfeff', color: '#0891b2', border: '1px solid #67e8f9', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('exempt', session)}
                >
                    Miễn trừ {sessionLabel}
                </Button>

                {schedule && (
                    <Button
                        size="small"
                        style={{ background: '#fff0f6', color: '#eb2f96', border: '1px solid #ffadd2', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        onClick={() => handleAction('clear', session)}
                    >
                        ❌ Xóa lịch làm ca này
                    </Button>
                )}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', padding: '0 4px' }}>Ghi chú (tùy chọn)</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Input
                        size="small"
                        placeholder="Ghi chú..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        style={{ fontSize: 11, height: 24, borderRadius: 4, flex: 1 }}
                    />
                    <Button
                        type="primary"
                        size="small"
                        style={{ background: '#10b981', borderColor: '#10b981', color: '#fff', height: 24, fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '0 8px' }}
                        onClick={() => handleAction('save', session)}
                    >
                        Lưu
                    </Button>
                </div>
            </div>
        </div>
    );

    return (
        <Popover
            content={content}
            title={null}
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            placement="bottomLeft"
            overlayStyle={{ zIndex: 1050 }}
        >
            <div onClickCapture={(e) => {
                e.stopPropagation();
                setOpen(true);
            }} onClick={(e) => {
                e.stopPropagation();
            }}>
                {children}
            </div>
        </Popover>
    );
};

const InlineLeavePopover = ({
    emp,
    date,
    session,
    request,
    isDue,
    onSave,
    children
}: {
    emp: any;
    date: dayjs.Dayjs;
    session: LeaveSession;
    request?: LeaveRequest;
    isDue: boolean;
    onSave: (action: 'save' | 'clear' | 'exempt', scope: LeaveSession | 'full_day', note: string) => void;
    children: React.ReactNode;
}) => {
    const [open, setOpen] = useState(false);
    const [note, setNote] = useState(request?.note || '');

    useEffect(() => {
        if (open) {
            setNote(request?.note || '');
        }
    }, [open, request]);

    const handleAction = (action: 'save' | 'clear' | 'exempt', scope: LeaveSession | 'full_day') => {
        onSave(action, scope, note);
        setOpen(false);
    };

    const sessionLabel = session === 'morning' ? 'Ca sáng' : 'Ca chiều';

    const content = (
        <div style={{ width: 210, padding: '2px 0' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 8, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CalendarOutlined style={{ color: '#1677ff', fontSize: 13 }} />
                <span>Nghỉ phép: {emp.name}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <Button
                    type="primary"
                    size="small"
                    style={{ background: '#1677ff', color: '#fff', border: 'none', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('save', session)}
                >
                    🚫 Nghỉ {sessionLabel}
                </Button>
                <Button
                    size="small"
                    style={{ background: '#e6f4ff', color: '#1677ff', border: '1px solid #91caff', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('save', 'full_day')}
                >
                    📅 Nghỉ cả ngày (Sáng + Chiều)
                </Button>
                <Button
                    size="small"
                    style={{ background: '#ecfeff', color: '#0891b2', border: '1px solid #67e8f9', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('exempt', session)}
                >
                    Miễn trừ {sessionLabel}
                </Button>
                <Button
                    size="small"
                    style={{ background: '#f0fdfa', color: '#0f766e', border: '1px solid #5eead4', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    onClick={() => handleAction('exempt', 'full_day')}
                >
                    Miễn trừ cả ngày
                </Button>

                {request && (
                    <Button
                        size="small"
                        style={{ background: '#fff0f0', color: '#ff4d4f', border: '1px solid #ffccc7', height: 26, fontSize: 11, fontWeight: 700, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        onClick={() => handleAction('clear', session)}
                    >
                        ❌ Xóa lịch xin nghỉ
                    </Button>
                )}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', padding: '0 4px' }}>Lý do xin nghỉ</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Input
                        size="small"
                        placeholder="Lý do..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        style={{ fontSize: 11, height: 24, borderRadius: 4, flex: 1 }}
                    />
                    <Button
                        type="primary"
                        size="small"
                        style={{ background: '#10b981', borderColor: '#10b981', color: '#fff', height: 24, fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '0 8px' }}
                        onClick={() => handleAction('save', session)}
                    >
                        Lưu
                    </Button>
                </div>
            </div>
        </div>
    );

    return (
        <Popover
            content={content}
            title={null}
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            placement="bottomLeft"
            overlayStyle={{ zIndex: 1050 }}
        >
            <div onClickCapture={(e) => {
                e.stopPropagation();
                setOpen(true);
            }} onClick={(e) => {
                e.stopPropagation();
            }}>
                {children}
            </div>
        </Popover>
    );
};

// ===============================================
// ===== FACE ATTENDANCE TAB COMPONENT =====
// ===============================================
const CHECK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    morning_in: { label: 'Sáng vào', color: '#52c41a' },
    morning_out: { label: 'Sáng ra', color: '#fa8c16' },
    afternoon_in: { label: 'Chiều vào', color: '#1677ff' },
    evening_out: { label: 'Tối ra', color: '#722ed1' },
};

function FaceAttendanceTab({ employees, children, onLogAdded, config, onLateFine, isAdmin }: {
    employees: any[],
    children?: React.ReactNode,
    onLogAdded?: () => void,
    config?: PenaltyConfig,
    onLateFine?: (fine: FineRecord) => void,
    isAdmin?: boolean,
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);       // capture frame (hidden)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null); // vẽ bounding box realtime
    const regCanvasRef = useRef<HTMLCanvasElement>(null);
    const regAnimRef = useRef<number>(0);
    const overlayAnimRef = useRef<number>(0);
    const recognizeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const displayVideoRef = useRef<HTMLVideoElement>(null); // video hiển thị trong Camera Panel
    const lastFaceBoxRef = useRef<any>(null);   // lưu face_box mới nhất để draw
    const lastResultRef = useRef<any>(null);    // lưu result mới nhất để draw tên

    const [serviceOk, setServiceOk] = useState(false);
    const [serviceStatus, setServiceStatus] = useState<'ready' | 'initializing' | 'error'>('error');
    const [cameraOn, setCameraOn] = useState(false);
    const cameraOnRef = useRef(false);
    const [recognizing, setRecognizing] = useState(false);
    const [cameraExpanded, setCameraExpanded] = useState(false);
    const [lastResult, setLastResult] = useState<any>(null);
    const [todayLogs, setTodayLogs] = useState<any[]>([]);
    const [profiles, setProfiles] = useState<any[]>([]);
    const [faceBox, setFaceBox] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null);
    const [regFaceStatus, setRegFaceStatus] = useState<'no_face' | 'too_far' | 'not_centered' | 'ok'>('no_face');

    // Register modal
    const [registerOpen, setRegisterOpen] = useState(false);
    const [regFaceId, setRegFaceId] = useState('');
    const [regUserName, setRegUserName] = useState('');
    const [regImages, setRegImages] = useState<string[]>([]);
    const [regCapturing, setRegCapturing] = useState(false);
    const [regLoading, setRegLoading] = useState(false);
    const [regDetecting, setRegDetecting] = useState(false);

    const api = (window as any).electronAPI?.attendance;
    const todayLogRows = useMemo(() => (
        todayLogs.map((log, i) => {
            const employee = findEmployeeForAttendanceLog(log, employees);
            return {
                ...log,
                key: i,
                displayUserName: employee?.name || log.userName || log.faceId || 'Không xác định',
            };
        })
    ), [todayLogs, employees]);

    // Check service status
    const checkService = useCallback(async () => {
        console.log('[Face:checkService] api=', !!api, '| electronAPI=', !!(window as any).electronAPI, '| attendance=', !!(window as any).electronAPI?.attendance);
        if (!api) return;
        const res = await api.status();
        console.log('[Face:checkService] res=', JSON.stringify(res));
        setServiceOk(res.success);
        if (res.success && res.data?.status) {
            setServiceStatus(res.data.status);
        } else {
            setServiceStatus('error');
        }
    }, [api]);

    // Load today logs + profiles
    const loadData = useCallback(async () => {
        if (!api) return;
        const today = new Date().toISOString().slice(0, 10);
        const [logsRes, profRes] = await Promise.all([
            api.getLogs({ date: today }),
            api.getProfiles(),
        ]);
        if (logsRes.success) setTodayLogs(logsRes.data);
        if (profRes.success) setProfiles(profRes.data);
    }, [api]);

    useEffect(() => {
        console.log('[Face:mount] Attendance component mounted. api=', !!api);
        // Gọi lần đầu ngay khi mở tab
        checkService();
        loadData();

        // Vòng lặp ngầm: Cứ 10 giây tự động gọi checkService() 1 lần.
        // Tác dụng:
        // 1. Tự recover nếu kết nối rớt giữa chừng (User không cần tự bấm "Làm mới").
        // 2. Chống chết yểu: Giúp backend biết tab Điểm danh vẫn đang mở (reset Idle Timer liên tục).
        const healthCheckInterval = setInterval(async () => {
            await checkService();
        }, 10000);

        // Hủy vòng lặp khi user chuyển sang tab khác
        return () => clearInterval(healthCheckInterval);
    }, [checkService, loadData]);

    // Camera start/stop
    const startCamera = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
            mediaStreamRef.current = stream; // Lưu vào ref để đảm bảo luôn có thể stop()
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                cameraOnRef.current = true;
                setCameraOn(true);
            }
        } catch {
            message.error('Không thể mở camera');
        }
    }, []);

    const stopCamera = useCallback(() => {
        // Stop stream từ mediaStreamRef (cách an toàn nhất)
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }

        // Dọn dẹp DOM
        if (videoRef.current?.srcObject) {
            videoRef.current.srcObject = null;
        }

        isRecognizingRef.current = false;
        cameraOnRef.current = false;
        setCameraOn(false);
        setRecognizing(false);
        setFaceBox(null);
        if (recognizeTimerRef.current) {
            clearTimeout(recognizeTimerRef.current as unknown as ReturnType<typeof setTimeout>);
            recognizeTimerRef.current = null;
        }
    }, []);

    // Sync srcObject sang video hiển thị trong Camera Panel mỗi khi cameraOn đổi
    useEffect(() => {
        const displayVideo = displayVideoRef.current;
        if (!displayVideo) return;
        if (cameraOn && videoRef.current?.srcObject) {
            if (displayVideo.srcObject !== videoRef.current.srcObject) {
                displayVideo.srcObject = videoRef.current.srcObject;
                displayVideo.play().catch(() => { });
            }
        } else {
            displayVideo.srcObject = null;
        }
    }, [cameraOn]);

    // Capture frame as base64
    const captureFrame = useCallback((fastMode: boolean = false): string | null => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !cameraOnRef.current) return null;

        let targetW = video.videoWidth || 640;
        let targetH = video.videoHeight || 480;

        // Ép nhỏ ảnh xuống 320x240 để Python nhận diện siêu tốc (nhanh như tool gốc)
        if (fastMode && targetW > 320) {
            const scale = 320 / targetW;
            targetW = 320;
            targetH = Math.floor(targetH * scale);
        }

        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', fastMode ? 0.6 : 0.8);
    }, []);

    // ─── Canvas Overlay Draw Loop ───────────────────────────────────────────────
    // Vẽ trực tiếp lên canvas — giống cv2.rectangle + cv2.putText của tool gốc
    const startOverlayDraw = useCallback(() => {
        let cachedW = 0, cachedH = 0;

        const draw = () => {
            const video = videoRef.current;
            const canvas = overlayCanvasRef.current;
            if (!canvas || !video) {
                overlayAnimRef.current = requestAnimationFrame(draw);
                return;
            }

            const W = video.videoWidth;
            const H = video.videoHeight;

            if (W === 0 || H === 0) {
                overlayAnimRef.current = requestAnimationFrame(draw);
                return;
            }

            // Chỉ reset canvas khi kích thước thay đổi (tránh xóa canvas mỗi frame)
            if (W !== cachedW || H !== cachedH) {
                canvas.width = W;
                canvas.height = H;
                cachedW = W;
                cachedH = H;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) { overlayAnimRef.current = requestAnimationFrame(draw); return; }
            ctx.clearRect(0, 0, W, H);

            const box = lastFaceBoxRef.current;
            const result = lastResultRef.current;

            if (box) {
                // Tỉ lệ scale ngược lại từ ảnh 320px lên kích thước thực của video
                const imgW = box.img_width || W;
                const imgH = box.img_height || H;
                const scaleX = W / imgW;
                const scaleY = H / imgH;

                const top = box.top * scaleY;
                const right = box.right * scaleX;
                const bottom = box.bottom * scaleY;
                const left = box.left * scaleX;

                const isMatch = result?.success;
                const isDuplicate = result?.reason === 'duplicate';
                const isNotCheckoutTime = result?.reason === 'not_checkout_time';
                const color = isMatch ? '#52c41a' : (isDuplicate || isNotCheckoutTime) ? '#faad14' : '#1677ff';

                // Vẽ hình chữ nhật (cv2.rectangle)
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
                ctx.strokeRect(left, top, right - left, bottom - top);
                ctx.shadowBlur = 0;

                // Vẽ tên (cv2.putText)
                const name = result?.userName || '';
                if (name) {
                    const label = isMatch
                        ? `${name} (${Math.round((result.confidence || 0) * 100)}%)`
                        : isDuplicate ? `${name} - Đã chấm công` : isNotCheckoutTime ? `${name} - Chưa tới giờ ra ca` : name;
                    ctx.font = 'bold 18px Arial';
                    const textW = ctx.measureText(label).width + 12;
                    ctx.fillStyle = color;
                    ctx.fillRect(left, top - 28, textW, 26);
                    ctx.fillStyle = '#fff';
                    ctx.fillText(label, left + 6, top - 8);
                } else {
                    // Chưa nhận ra → Scanning...
                    ctx.font = 'bold 14px Arial';
                    ctx.fillStyle = '#1677ffcc';
                    ctx.fillRect(left, top - 24, 110, 22);
                    ctx.fillStyle = '#fff';
                    ctx.fillText('Scanning...', left + 6, top - 6);
                }
            }

            overlayAnimRef.current = requestAnimationFrame(draw);
        };
        overlayAnimRef.current = requestAnimationFrame(draw);
    }, []);

    const stopOverlayDraw = useCallback(() => {
        cancelAnimationFrame(overlayAnimRef.current);
        lastFaceBoxRef.current = null;
        lastResultRef.current = null;
        const canvas = overlayCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, []);

    // Auto recognize loop
    const isRecognizingRef = useRef(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeAttendanceRef = useRef<(() => void) | null>(null); // callback đóng camera từ ngoài vào

    const resetIdleTimer = useCallback(() => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
            closeAttendanceRef.current?.();
        }, 15000);
    }, []);

    const startRecognizing = useCallback(() => {
        try {
            if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (sharedAudioCtx?.state === 'suspended') sharedAudioCtx.resume();

            // Dummy speak to unlock SpeechSynthesis on browser
            const initMsg = new SpeechSynthesisUtterance('');
            initMsg.volume = 0;
            window.speechSynthesis.speak(initMsg);
        } catch (e) { }

        if (recognizeTimerRef.current) return;
        isRecognizingRef.current = true;
        setRecognizing(true);
        startOverlayDraw(); // ← canvas draw loop bắt đầu


        const doRecognize = async () => {
            if (!isRecognizingRef.current) return;
            const frame = captureFrame(true); // true = fast mode (downscale)
            if (frame && api) {
                const res = await api.recognize(frame);

                // Service lỗi kết nối → thử lại sau 3 giây để chờ auto-heal
                if (res.error) {
                    console.warn('Face service error:', res.error);
                    setLastResult({ error: res.error });

                    if (isRecognizingRef.current) {
                        recognizeTimerRef.current = setTimeout(doRecognize, 3000) as unknown as ReturnType<typeof setInterval>;
                    }
                    return;
                }

                // Luôn cập nhật face_box dù match hay không (overlay realtime)
                const box = res.face_box || res.data?.face_box || null;
                if (box) {
                    box.img_width = res.img_width || res.data?.img_width || 640;
                    box.img_height = res.img_height || res.data?.img_height || 480;
                }
                setFaceBox(box);
                lastFaceBoxRef.current = box; // ← canvas draw loop dùng cái này
                // DEBUG — xóa sau khi xác nhận hoạt động
                console.log('[Face] box=', box, 'res=', res);

                if (res.success && res.data) {
                    // ✅ Match thành công → hiện tên + chấm công
                    try {
                        const actx = sharedAudioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
                        if (actx.state === 'suspended') actx.resume();
                        const osc1 = actx.createOscillator(), osc2 = actx.createOscillator();
                        const gain1 = actx.createGain(), gain2 = actx.createGain();
                        osc1.connect(gain1); gain1.connect(actx.destination);
                        osc2.connect(gain2); gain2.connect(actx.destination);

                        osc1.type = 'sine'; osc1.frequency.value = 1046.50; // C5
                        gain1.gain.setValueAtTime(0.5, actx.currentTime);
                        gain1.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.3);
                        osc1.start(actx.currentTime); osc1.stop(actx.currentTime + 0.3);

                        osc2.type = 'sine'; osc2.frequency.value = 1318.51; // E5
                        gain2.gain.setValueAtTime(0.5, actx.currentTime + 0.1);
                        gain2.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.6);
                        osc2.start(actx.currentTime + 0.1); osc2.stop(actx.currentTime + 0.6);

                        const msg = new SpeechSynthesisUtterance(`Xin chào ${res.data.userName}`);
                        msg.lang = 'vi-VN';
                        window.speechSynthesis.speak(msg);
                    } catch (e) { console.error(e); }

                    const matchResult = {
                        success: true,
                        userName: res.data.userName,
                        checkType: res.data.checkType,
                        confidence: res.data.confidence,
                        face_box: box,
                    };
                    setLastResult(matchResult);
                    lastResultRef.current = matchResult;
                    loadData();
                    if (onLogAdded) onLogAdded();

                    // Backend ghi phạt cùng lúc với log chấm công; frontend chỉ đồng bộ để hiển thị ngay.
                    if (res.data.lateFine && onLateFine) onLateFine(res.data.lateFine);
                    // Reset idle timer sau mỗi lần chấm thành công
                    resetIdleTimer();
                    // Hiện kết quả 2s rồi tiếp tục nhận diện người tiếp theo
                    setTimeout(() => {
                        if (isRecognizingRef.current) {
                            recognizeTimerRef.current = setTimeout(doRecognize, 120) as unknown as ReturnType<typeof setInterval>;
                        }
                    }, 2000);
                    return;
                } else if (res.reason === 'duplicate') {
                    // Đã chấm công rồi — hiện tên vàng
                    const isSameUserDuplicate = lastResultRef.current?.reason === 'duplicate' && lastResultRef.current?.userName === res.userName;
                    const dupResult = { reason: 'duplicate', userName: res.userName, face_box: box };
                    setLastResult(dupResult);
                    lastResultRef.current = dupResult;

                    if (!isSameUserDuplicate) {
                        try {
                            const actx = sharedAudioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
                            if (actx.state === 'suspended') actx.resume();
                            const osc = actx.createOscillator();
                            const gain = actx.createGain();
                            osc.connect(gain); gain.connect(actx.destination);
                            osc.type = 'square'; osc.frequency.value = 220; // Âm trầm (cảnh báo nhẹ)
                            gain.gain.setValueAtTime(0.1, actx.currentTime);
                            gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.3);
                            osc.start(actx.currentTime); osc.stop(actx.currentTime + 0.3);

                            const msg = new SpeechSynthesisUtterance(`Bạn đã chấm công rồi`);
                            msg.lang = 'vi-VN';
                            window.speechSynthesis.speak(msg);
                        } catch (e) { }

                        // Lần đầu cảnh báo thì dừng hình 2s để user nhìn rõ màn hình
                        setTimeout(() => {
                            if (isRecognizingRef.current) {
                                recognizeTimerRef.current = setTimeout(doRecognize, 120) as unknown as ReturnType<typeof setInterval>;
                            }
                        }, 2000);
                        return;
                    }
                    // Nếu vẫn là người đó và vẫn duplicate, thì chỉ tracking khung vàng realtime, KHÔNG thông báo âm thanh nữa
                } else if (res.reason === 'not_checkout_time') {
                    const waitResult = {
                        reason: 'not_checkout_time',
                        userName: res.userName,
                        allowedFrom: res.allowedFrom,
                        nextCheckType: res.nextCheckType,
                        face_box: box
                    };
                    const isSameWait = lastResultRef.current?.reason === 'not_checkout_time' && lastResultRef.current?.userName === res.userName;
                    setLastResult(waitResult);
                    lastResultRef.current = waitResult;

                    if (!isSameWait) {
                        try {
                            const msg = new SpeechSynthesisUtterance(`Chưa tới giờ ra ca, vui lòng chấm lại sau ${res.allowedFrom || ''}`);
                            msg.lang = 'vi-VN';
                            window.speechSynthesis.speak(msg);
                        } catch (e) { }

                        setTimeout(() => {
                            if (isRecognizingRef.current) {
                                recognizeTimerRef.current = setTimeout(doRecognize, 120) as unknown as ReturnType<typeof setInterval>;
                            }
                        }, 2000);
                        return;
                    }
                } else if (res.reason === 'out_of_hours') {
                    const oohResult = { reason: 'out_of_hours', userName: res.userName, face_box: box };
                    setLastResult(oohResult);
                    lastResultRef.current = oohResult;
                } else {
                    // Phát hiện mặt nhưng không khớp ai
                    lastFaceBoxRef.current = box;
                    lastResultRef.current = null;
                    setLastResult(null);
                }
            }

            if (isRecognizingRef.current) {
                // Tốc độ update box (càng nhỏ càng mượt, 120ms + thời gian xử lý ~ 100ms = ~4-5 FPS)
                recognizeTimerRef.current = setTimeout(doRecognize, 120) as unknown as ReturnType<typeof setInterval>;
            }
        };

        recognizeTimerRef.current = setTimeout(doRecognize, 100) as unknown as ReturnType<typeof setInterval>;
    }, [api, captureFrame, loadData, startOverlayDraw, resetIdleTimer]);



    const stopRecognizing = useCallback(() => {
        isRecognizingRef.current = false;
        setRecognizing(false);
        setLastResult(null);
        setFaceBox(null);
        lastFaceBoxRef.current = null;
        lastResultRef.current = null;
        if (recognizeTimerRef.current) {
            clearTimeout(recognizeTimerRef.current as unknown as ReturnType<typeof setTimeout>);
            recognizeTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        stopCamera();
    }, [stopCamera]);

    // Mirror video feed + oval guide vào canvas trong modal
    const regFaceStatusRef = useRef<'no_face' | 'too_far' | 'not_centered' | 'ok'>('no_face');
    useEffect(() => { regFaceStatusRef.current = regFaceStatus; }, [regFaceStatus]);

    useEffect(() => {
        if (!registerOpen || !cameraOn) {
            cancelAnimationFrame(regAnimRef.current);
            return;
        }
        const draw = () => {
            const video = videoRef.current;
            const canvas = regCanvasRef.current;
            if (video && canvas && video.readyState >= 2) {
                const W = video.videoWidth || 640;
                const H = video.videoHeight || 480;
                canvas.width = W;
                canvas.height = H;
                const ctx = canvas.getContext('2d');
                if (!ctx) { regAnimRef.current = requestAnimationFrame(draw); return; }

                // Vẽ video
                ctx.drawImage(video, 0, 0);

                // Tối vùng ngoài oval (nhỏ lại để nhận diện xa hơn)
                const cx = W / 2, cy = H / 2;
                const rx = W * 0.22, ry = H * 0.30;
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.rect(0, 0, W, H);
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.fill('evenodd');

                // Viền oval — màu theo trạng thái
                const status = regFaceStatusRef.current;
                ctx.beginPath();
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
                ctx.strokeStyle = status === 'ok' ? '#52c41a' : status === 'too_far' ? '#faad14' : status === 'not_centered' ? '#1890ff' : '#ffffff';
                ctx.lineWidth = status === 'ok' ? 4 : 2.5;
                if (status !== 'ok') ctx.setLineDash([12, 8]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Debug text
                ctx.fillStyle = 'red';
                ctx.font = '16px sans-serif';
                const r = (window as any)._lastRes;
                const dbgText = r ? (r.error ? `ERR: ${r.error}` : `found:${r.found} reason:${r.reason}`) : ((window as any)._frameIsNull ? 'frame=null' : 'waiting...');
                ctx.fillText(`STATUS: ${status} | isD: ${!!(api as any).detect} | ${dbgText}`, 10, 30);

                ctx.restore();
            }
            regAnimRef.current = requestAnimationFrame(draw);
        };
        regAnimRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(regAnimRef.current);
    }, [registerOpen, cameraOn]);

    // Detect face realtime + kiểm tra khoảng cách trong modal
    const MIN_FACE_RATIO = 0.15; // mặt phải chiếm ít nhất 15% chiều cao frame
    useEffect(() => {
        // Chỉ detect khi đã điền đủ thông tin (bắt buộc) + camera đang bật
        // Không dừng detect khi regCapturing — cần biết mặt có còn trong vùng không
        if (!registerOpen || !cameraOn || !regFaceId || !regUserName) {
            setRegFaceStatus('no_face');
            setRegDetecting(false);
            return;
        }
        let active = true;
        setRegDetecting(true);
        const check = async () => {
            if (!active || !api) return;
            try {
                // Tắt fastMode trong modal để HOG bắt mặt to/gần chính xác hơn (640x480)
                const frame = captureFrame(false);
                if (frame) {
                    // Sử dụng api.detect để không so khớp với profile cũ, tránh lag
                    const detectFn = (api as any).detect || api.recognize;

                    let done = false;
                    const timeoutTimer = setTimeout(() => {
                        if (!done) (window as any)._lastRes = { error: 'IPC_HANG_OR_SLOW' };
                    }, 2000);

                    const res = await detectFn(frame);
                    done = true;
                    clearTimeout(timeoutTimer);

                    (window as any)._lastRes = res;

                    if (active) {
                        // api.detect/recognize trả về: { success, found, face_box, img_height }
                        const hasBox = res.face_box != null;
                        const notFound = !hasBox || res.reason === 'no_face' || res.reason === 'no_encoding';
                        if (notFound) {
                            setRegFaceStatus('no_face');
                        } else {
                            const imgW = res.img_width || 640;
                            const imgH = res.img_height || 480;
                            const faceH = (res.face_box.bottom - res.face_box.top) / imgH;

                            // Kiểm tra tâm khuôn mặt có nằm trong vùng giữa màn hình (gần vòng tròn) không
                            const faceCX = (res.face_box.left + res.face_box.right) / 2;
                            const faceCY = (res.face_box.top + res.face_box.bottom) / 2;
                            const cx = imgW / 2;
                            const cy = imgH / 2;

                            // Cho phép sai số 15% chiều rộng và 20% chiều cao (xấp xỉ kích thước vòng tròn)
                            const isCentered = Math.abs(faceCX - cx) < imgW * 0.15 && Math.abs(faceCY - cy) < imgH * 0.20;

                            if (faceH < MIN_FACE_RATIO) {
                                setRegFaceStatus('too_far');
                            } else if (!isCentered) {
                                setRegFaceStatus('not_centered');
                            } else {
                                setRegFaceStatus('ok');
                            }
                        }
                    }
                } else {
                    (window as any)._frameIsNull = true;
                }
            } catch {
                // ignore lỗi từng frame, tiếp tục loop
            }
            if (active) setTimeout(check, 700);
        };
        check();
        return () => { active = false; setRegDetecting(false); };
    }, [registerOpen, cameraOn, api, captureFrame, regFaceId, regUserName]);

    // ===== Auto-capture giống tool gốc (takeImage.py) =====
    // Khi face vào đúng vị trí + đã điền thông tin → tự chụp liên tiếp 50 ảnh
    const REG_TARGET = 50;
    const [regCapturedCount, setRegCapturedCount] = useState(0);
    const regImagesRef = useRef<string[]>([]);
    const regCapturingRef = useRef(false);

    const captureForRegister = useCallback(async () => {
        if (regCapturingRef.current) return;
        regCapturingRef.current = true;
        setRegCapturing(true);
        setRegCapturedCount(0);
        regImagesRef.current = [];

        // Chụp liên tiếp — kiểm tra face status qua ref để tránh flicker
        let cancelled = false;
        let faceGoneFrames = 0;
        const FACE_GONE_THRESHOLD = 5; // 5 frame liên tiếp (~1s) mới coi là mặt thật sự rời
        for (let i = 0; i < REG_TARGET; i++) {
            if (!regCapturingRef.current) { cancelled = true; break; } // hủy thủ công
            if (regFaceStatusRef.current !== 'ok') {
                faceGoneFrames++;
                if (faceGoneFrames >= FACE_GONE_THRESHOLD) { cancelled = true; break; }
            } else {
                faceGoneFrames = 0;
                const frame = captureFrame();
                if (frame) {
                    regImagesRef.current.push(frame);
                    setRegCapturedCount(regImagesRef.current.length);
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }

        setRegCapturing(false);
        regCapturingRef.current = false;

        // Bị hủy giữa chừng (mặt rời vùng) → reset im lặng, không báo gì
        if (cancelled) {
            regImagesRef.current = [];
            setRegImages([]);
            setRegCapturedCount(0);
            return;
        }

        // Capture hoàn thành 30 lượt
        setRegImages(regImagesRef.current);
        if (regImagesRef.current.length >= 5) {
            message.success(`Đã chụp ${regImagesRef.current.length} ảnh — bấm Lưu để hoàn tất`);
        } else {
            message.warning('Không đủ ảnh, thử lại');
        }
    }, [captureFrame]);

    // Hủy chụp giữa chừng
    const cancelCapture = useCallback(() => {
        regCapturingRef.current = false;
        setRegCapturing(false);
    }, []);

    // AUTO-CAPTURE: khi mặt vào đúng vị trí + đã điền đủ thông tin → đếm ngược 5s rồi tự chụp
    const autoCaptureFiredRef = useRef(false);
    const regStartedCameraRef = useRef(false); // camera được bật bởi nút "Đăng ký khuôn mặt mới"
    const [regCountdown, setRegCountdown] = useState(0);
    const regTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Tự bật camera khi chọn xong nhân viên trong modal đăng ký
    useEffect(() => {
        if (registerOpen && regFaceId && regUserName && !cameraOnRef.current) {
            regStartedCameraRef.current = true;
            startCamera();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerOpen, regFaceId, regUserName]); // KHÔNG đưa cameraOn vào đây — tránh loop

    useEffect(() => {
        if (regFaceStatus === 'ok' && regFaceId && regUserName && !regCapturing && regImages.length === 0 && cameraOn) {
            if (!autoCaptureFiredRef.current) {
                autoCaptureFiredRef.current = true;
                setRegCountdown(5); // Bắt đầu đếm ngược 5 giây
                playTingSound(); // Phát âm thanh báo hiệu

                let count = 5;
                if (regTimerRef.current) clearInterval(regTimerRef.current);

                regTimerRef.current = setInterval(() => {
                    count -= 1;
                    setRegCountdown(count);
                    if (count <= 0) {
                        clearInterval(regTimerRef.current!);
                        captureForRegister();
                    }
                }, 1000);
            }
        } else if (regFaceStatus !== 'ok') {
            // Hủy đếm ngược + dừng chụp nếu mặt ra khỏi vùng
            autoCaptureFiredRef.current = false;
            setRegCountdown(0);
            if (regTimerRef.current) {
                clearInterval(regTimerRef.current);
                regTimerRef.current = null;
            }
        }
    }, [regFaceStatus, regFaceId, regUserName, regCapturing, regImages.length, cameraOn, captureForRegister]);

    const handleRegister = useCallback(async () => {
        if (!regFaceId || !regUserName || regImages.length === 0) {
            message.warning('Điền đầy đủ thông tin và chụp ảnh trước');
            return;
        }
        setRegLoading(true);
        const matchedEmployee = employees.find(emp =>
            emp.username === regFaceId ||
            normalizeAttendanceText(emp.name) === normalizeAttendanceText(regUserName)
        );
        const res = await api.register({
            face_id: regFaceId,
            user_name: regUserName,
            user_id: matchedEmployee?.id,
            images: regImages,
        });
        setRegLoading(false);
        if (res.success) {
            message.success(`Đăng ký thành công! Đã lưu ${res.saved} ảnh`);
            setRegisterOpen(false);
            setRegFaceId('');
            setRegUserName('');
            setRegImages([]);
            if (regStartedCameraRef.current) {
                regStartedCameraRef.current = false;
                stopCamera();
            }
            loadData();
        } else {
            message.error(res.error || 'Đăng ký thất bại');
        }
    }, [api, regFaceId, regUserName, regImages, loadData, employees]);

    const logColumns = [
        { title: 'Nhân viên', dataIndex: 'displayUserName', key: 'userName', render: (v: string) => <Text strong>{v}</Text> },
        { title: 'Loại', dataIndex: 'checkType', key: 'checkType', width: 140, render: (v: string) => { const c = CHECK_TYPE_LABELS[v]; return <Tag color={c?.color} style={{ fontWeight: 700 }}>{c?.label || v}</Tag>; } },
        { title: 'Giờ', dataIndex: 'timestamp', key: 'timestamp', width: 140, render: (v: string) => <Text>{new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</Text> },
        { title: 'Độ chính xác', dataIndex: 'confidence', key: 'confidence', width: 150, render: (v: number) => <Text type="secondary">{Math.round((v || 0) * 100)}%</Text> },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header: Status + 2 nút luôn hiển thị */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                    <Badge
                        status={serviceStatus === 'ready' ? 'success' : serviceStatus === 'initializing' ? 'processing' : 'error'}
                        text={<Text style={{ fontWeight: 700 }}>{
                            serviceStatus === 'ready' ? 'Python service: Sẵn sàng'
                            : serviceStatus === 'initializing' ? 'Python service: Đang khởi tạo...'
                            : 'Python service: Không kết nối được'
                        }</Text>}
                    />
                    <Button size="small" icon={<SyncOutlined />} onClick={() => { checkService(); loadData(); }}>Làm mới</Button>
                </Space>
                <Space>
                    <Button
                        icon={<SmileOutlined />}
                        type={cameraExpanded ? 'default' : 'primary'}
                        disabled={serviceStatus !== 'ready'}
                        style={cameraExpanded ? {} : { background: '#52c41a', borderColor: '#52c41a', color: '#fff' }}
                        onClick={async () => {
                            if (cameraExpanded) {
                                if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
                                closeAttendanceRef.current = null;
                                stopRecognizing();
                                stopCamera();
                                setCameraExpanded(false);
                            } else {
                                setCameraExpanded(true);
                                closeAttendanceRef.current = () => {
                                    stopRecognizing();
                                    stopCamera();
                                    setCameraExpanded(false);
                                    closeAttendanceRef.current = null;
                                };
                                await startCamera();
                                startRecognizing();
                                resetIdleTimer(); // bắt đầu đếm 15s ngay khi mở
                            }
                        }}
                    >
                        {cameraExpanded ? 'Đóng camera' : 'Chấm công'}
                    </Button>
                    {isAdmin && (
                        <Button icon={<PlusOutlined />} type="primary" disabled={serviceStatus !== 'ready'} onClick={() => {
                            setRegFaceId('');
                            setRegUserName('');
                            setRegImages([]);
                            setRegCapturedCount(0);
                            autoCaptureFiredRef.current = false;
                            setRegisterOpen(true);
                        }}>
                            Đăng ký khuôn mặt mới
                        </Button>
                    )}
                </Space>
            </div>

            {/* Video + canvas LUÔN được mount (kể cả khi cameraExpanded=false)
                để videoRef.current luôn valid khi register modal gọi startCamera() */}
            <video
                ref={videoRef}
                style={{ display: 'none' }}
                muted
                playsInline
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <Row gutter={20}>
                {/* Camera Panel — ẩn mặc định, hiện khi cameraExpanded */}
                {cameraExpanded && <Col span={14}>
                    <Card
                        title={<Space><CameraOutlined style={{ color: '#1677ff' }} /><Text strong>Camera nhận diện</Text></Space>}
                        style={{ borderTop: '3px solid #1677ff' }}
                        extra={
                            <Space>
                                {!cameraOn ? (
                                    <Button type="primary" icon={<CameraOutlined />} onClick={startCamera}>Bật camera</Button>
                                ) : (
                                    <>
                                        {!recognizing ? (
                                            <Button type="primary" icon={<SmileOutlined />} onClick={startRecognizing} disabled={serviceStatus !== 'ready'}>Bắt đầu nhận diện</Button>
                                        ) : (
                                            <Button danger onClick={stopRecognizing}>Dừng nhận diện</Button>
                                        )}
                                        <Button onClick={stopCamera}>Tắt camera</Button>
                                    </>
                                )}
                            </Space>
                        }
                    >
                        <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', minHeight: 360 }}>
                            {/* Video hiển thị trong panel — srcObject sync qua useEffect([cameraOn]) */}
                            <video
                                id="att-display-video"
                                ref={displayVideoRef}
                                style={{ width: '100%', display: 'block' }}
                                muted
                                playsInline
                            />
                            {/* Canvas overlay — vẽ trực tiếp như cv2.rectangle+putText của tool gốc */}
                            <canvas
                                ref={overlayCanvasRef}
                                style={{
                                    position: 'absolute',
                                    top: 0, left: 0,
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: 'none',
                                }}
                            />
                            {!cameraOn && (
                                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                                    <CameraOutlined style={{ fontSize: 48 }} />
                                </div>
                            )}
                        </div>

                        {/* Recognition Result */}
                        {lastResult?.success && (
                            <div style={{
                                marginTop: 16, padding: '16px 20px',
                                background: 'linear-gradient(135deg, #f6ffed, #d9f7be)',
                                borderRadius: 10, border: '1px solid #b7eb8f',
                                textAlign: 'center',
                            }}>
                                <Text style={{ fontSize: 22, fontWeight: 800, color: '#237804' }}>
                                    Xin chào, {lastResult.userName}!
                                </Text>
                                <div style={{ marginTop: 6 }}>
                                    <Tag color={CHECK_TYPE_LABELS[lastResult.checkType]?.color} style={{ fontWeight: 700, fontSize: 13 }}>
                                        {CHECK_TYPE_LABELS[lastResult.checkType]?.label || lastResult.checkType}
                                    </Tag>
                                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                                        {Math.round((lastResult.confidence || 0) * 100)}% chính xác
                                    </Text>
                                </div>
                            </div>
                        )}
                        {lastResult?.reason === 'duplicate' && (
                            <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591', textAlign: 'center' }}>
                                <Text style={{ color: '#d46b08', fontWeight: 700 }}>Đã chấm công rồi</Text>
                            </div>
                        )}
                        {lastResult?.reason === 'not_checkout_time' && (
                            <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff7e6', borderRadius: 8, border: '1px solid #ffd591', textAlign: 'center' }}>
                                <Text style={{ color: '#d46b08', fontWeight: 700 }}>
                                    {lastResult.userName ? `${lastResult.userName} - Chưa tới giờ ra ca` : 'Chưa tới giờ ra ca'}
                                    {lastResult.allowedFrom ? ` (${lastResult.allowedFrom})` : ''}
                                </Text>
                            </div>
                        )}
                        {lastResult?.reason === 'out_of_hours' && (
                            <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff1f0', borderRadius: 8, border: '1px solid #ffccc7', textAlign: 'center' }}>
                                <Text style={{ color: '#cf1322', fontWeight: 700 }}>
                                    {lastResult.userName ? `${lastResult.userName} - Ngoài giờ chấm công` : 'Ngoài giờ chấm công'}
                                </Text>
                            </div>
                        )}
                        {lastResult?.error && (
                            <div style={{ marginTop: 12, padding: '10px 16px', background: '#fff1f0', borderRadius: 8, border: '1px solid #ffccc7', textAlign: 'center' }}>
                                <Text style={{ color: '#cf1322', fontWeight: 700 }}>Mất kết nối với AI nhận diện</Text>
                                <div><Text type="secondary" style={{ fontSize: 12 }}>Hệ thống đang tự động khôi phục...</Text></div>
                            </div>
                        )}
                    </Card>
                </Col>}

                {/* Profiles Panel */}
                <Col span={cameraExpanded ? 10 : 24}>
                    <Card
                        title={<Space><UserOutlined style={{ color: '#722ed1' }} /><Text strong>Profiles đã đăng ký ({profiles.length})</Text></Space>}
                        style={{ borderTop: '3px solid #722ed1', marginBottom: 20 }}
                        bodyStyle={{ padding: '12px 16px' }}
                    >
                        {profiles.length === 0 ? (
                            <Text type="secondary">Chưa có profile nào</Text>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {profiles.map(p => (
                                    <div key={p.faceId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                                        <div>
                                            <Text strong style={{ fontSize: 13 }}>{p.userName}</Text>
                                            <div><Text type="secondary" style={{ fontSize: 11 }}>{p.faceId} · {p.photoCount} ảnh</Text></div>
                                        </div>
                                        {isAdmin && <Tooltip title="Xóa khuôn mặt">
                                            <Button
                                                size="small" danger type="text" icon={<DeleteOutlined />}
                                                onClick={() => {
                                                    const faceId = p.faceId;
                                                    const userName = p.userName;
                                                    Modal.confirm({
                                                        title: `Xóa khuôn mặt "${userName}"?`,
                                                        content: 'Nhân viên này sẽ không thể chấm công bằng khuôn mặt nữa.',
                                                        okText: 'Xóa', okType: 'danger', cancelText: 'Hủy',
                                                        onOk: () => api.deleteProfile(faceId).then((res: any) => {
                                                            if (res.success) { message.success('Đã xóa khuôn mặt'); loadData(); }
                                                            else { message.error(res.error || 'Xóa thất bại'); }
                                                        }),
                                                    });
                                                }}
                                            />
                                        </Tooltip>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </Col>
            </Row>

            {children}

            {/* Today Logs đẩy xuống tận cùng dưới Dashboard (Ma trận, Thống kê) */}
            <Card
                title={<Space><ClockCircleOutlined style={{ color: '#52c41a' }} /><Text strong>Nhật ký nhận diện hôm nay ({new Date().toLocaleDateString('vi-VN')})</Text></Space>}
                style={{ borderTop: '3px solid #52c41a', marginTop: 24 }}
                bodyStyle={{ padding: 0 }}
            >
                <Table
                    dataSource={todayLogRows}
                    columns={logColumns}
                    pagination={false}
                    size="small"
                    locale={{ emptyText: 'Chưa có lượt chấm công hôm nay' }}
                    scroll={{ y: 300 }}
                />
            </Card>

            {/* Register Modal — Auto-capture giống tool gốc */}
            <Modal
                title="Đăng ký khuôn mặt nhân viên"
                open={registerOpen}
                onCancel={() => {
                    setRegisterOpen(false);
                    setRegImages([]);
                    setRegCapturedCount(0);
                    cancelCapture();
                    autoCaptureFiredRef.current = false;
                    if (regStartedCameraRef.current) {
                        regStartedCameraRef.current = false;
                        stopCamera();
                    }
                }}
                onOk={handleRegister}
                okText="Lưu đăng ký"
                width={560}
                confirmLoading={regLoading}
                okButtonProps={{ disabled: regImages.length < 5 || !regFaceId || !regUserName }}
            >
                <Form layout="vertical">
                    {/* Bước 1: Chọn nhân viên từ danh sách */}
                    <Form.Item
                        label={<Text strong>① Chọn nhân viên cần đăng ký</Text>}
                        validateStatus={regUserName ? 'success' : ''}
                        help={!regUserName ? '* Bắt buộc — vui lòng chọn một nhân viên từ danh sách' : ''}
                    >
                        <Select
                            showSearch
                            placeholder="VD: Nguyễn Đình Toàn"
                            value={regFaceId || undefined}
                            onChange={(val) => {
                                const emp = employees.find(e => e.username === val || e.id.toString() === val);
                                if (emp) {
                                    setRegUserName(emp.name);
                                    // Dùng username làm ID nhận diện khuôn mặt luôn (map 1-1 với DB hệ thống)
                                    setRegFaceId(emp.username || val);
                                    // useEffect sẽ tự bật camera khi regFaceId + regUserName có giá trị
                                }
                            }}
                            disabled={regCapturing}
                            optionFilterProp="children"
                        >
                            {employees.map(emp => (
                                <Select.Option key={emp.id} value={emp.username || emp.id.toString()}>
                                    {emp.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label={<Text strong>② Mã nhân viên (Tự động map)</Text>}
                        validateStatus={regFaceId ? 'success' : ''}
                    >
                        <Input
                            placeholder="Mã nhận diện (VD: toan, khanh...)"
                            value={regFaceId}
                            disabled={true}
                            prefix={<UserOutlined style={{ color: regFaceId ? '#52c41a' : '#bbb' }} />}
                        />
                    </Form.Item>

                    {/* Bước 2: Camera — chỉ hiện khi đã điền đủ thông tin */}
                    <Form.Item label={<Text strong>③ Chụp khuôn mặt</Text>}>
                        {(!regFaceId || !regUserName) ? (
                            <div style={{
                                padding: '28px 20px',
                                background: 'linear-gradient(135deg, #f8f8f8, #f0f0f0)',
                                borderRadius: 10,
                                border: '2px dashed #d9d9d9',
                                textAlign: 'center',
                            }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                                <Text type="secondary" style={{ fontSize: 13 }}>
                                    Vui lòng điền đủ <Text strong>Mã NV</Text> và <Text strong>Tên</Text> ở trên trước
                                </Text>
                            </div>
                        ) : !cameraOn ? (
                            <div style={{ padding: '20px', background: '#fff7e6', borderRadius: 8, textAlign: 'center', border: '1px solid #ffd591' }}>
                                <Text style={{ color: '#d46b08', fontWeight: 600 }}>⚠️ Cần bật camera ở màn hình chính trước</Text>
                            </div>
                        ) : (
                            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#000' }}>
                                <canvas ref={regCanvasRef} style={{ width: '100%', display: 'block' }} />
                                {/* Face status indicator */}
                                <div style={{
                                    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                                    background: regFaceStatus === 'ok' ? 'rgba(82,196,26,0.92)' : regFaceStatus === 'too_far' ? 'rgba(250,173,20,0.92)' : regFaceStatus === 'not_centered' ? 'rgba(24,144,255,0.92)' : 'rgba(0,0,0,0.65)',
                                    color: '#fff', fontSize: 12, fontWeight: 700,
                                    padding: '4px 14px', borderRadius: 20, whiteSpace: 'nowrap',
                                }}>
                                    {regCapturing
                                        ? `📸 Đang chụp ${regCapturedCount}/${REG_TARGET}... Xoay mặt nhẹ!`
                                        : regFaceStatus === 'ok'
                                            ? (regFaceId && regUserName
                                                ? (regCountdown > 0 ? `✓ Giữ yên! Tự chụp sau ${regCountdown}s...` : '✓ Đang chuẩn bị chụp...')
                                                : '✓ Khuôn mặt OK — điền thông tin bên dưới')
                                            : regFaceStatus === 'not_centered' ? 'Đưa mặt vào giữa vòng tròn!'
                                                : regFaceStatus === 'too_far' ? 'Lại gần hơn nữa...'
                                                    : regDetecting ? '⏳ Đang tìm khuôn mặt...' : 'Đưa mặt vào khung hình'}
                                </div>

                                {/* Progress bar khi đang chụp */}
                                {regCapturing && (
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'rgba(0,0,0,0.7)', padding: '10px 16px',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                            <Text style={{ color: '#52c41a', fontWeight: 700, fontSize: 13 }}>
                                                Đã chụp {regCapturedCount}/{REG_TARGET} ảnh
                                            </Text>
                                            <Button size="small" danger type="text" onClick={cancelCapture}
                                                style={{ color: '#ff7875', fontSize: 11 }}>Hủy</Button>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 4, height: 6 }}>
                                            <div style={{
                                                background: 'linear-gradient(90deg, #52c41a, #73d13d)',
                                                height: 6, borderRadius: 4,
                                                width: `${(regCapturedCount / REG_TARGET) * 100}%`,
                                                transition: 'width 0.15s',
                                            }} />
                                        </div>
                                    </div>
                                )}

                                {/* Hướng dẫn khi chưa chụp */}
                                {!regCapturing && cameraOn && regImages.length === 0 && (
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'rgba(0,0,0,0.6)', padding: '8px 12px', textAlign: 'center',
                                    }}>
                                        <Text style={{ color: '#d9d9d9', fontSize: 11 }}>
                                            Điền mã NV + tên → đưa mặt vào khung → tự chụp {REG_TARGET} ảnh
                                        </Text>
                                    </div>
                                )}
                            </div>
                        )}
                    </Form.Item>

                    {/* Kết quả */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {regImages.length > 0 && !regCapturing && (
                            <>
                                <Tag color="success" style={{ fontWeight: 700, fontSize: 13, padding: '4px 12px' }}>
                                    ✓ {regImages.length} ảnh — sẵn sàng lưu
                                </Tag>
                                <Button size="small" onClick={() => { setRegImages([]); setRegCapturedCount(0); autoCaptureFiredRef.current = false; }}>
                                    Chụp lại
                                </Button>
                            </>
                        )}
                        {regImages.length === 0 && !regCapturing && cameraOn && regFaceStatus === 'ok' && regFaceId && regUserName && (
                            <Button type="primary" icon={<CameraOutlined />} onClick={captureForRegister}>
                                Bắt đầu chụp
                            </Button>
                        )}
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

// ===============================================
// ===== MAIN COMPONENT =====
// ===============================================
export default function Attendance() {
    const { user } = useAuth();
    const currentUser = useCurrentUser();
    const isAdmin = currentUser === 'admin' || user?.role === 'admin';
    const isManager = user?.role === 'manager';
    const canManageBonuses = isAdmin;
    const canManageAttendance = isAdmin || isManager;
    const canCreateFundTx = isAdmin || isManager;
    const fineAuditActor = useMemo(() => ({
        username: user?.username || currentUser || 'System',
        displayName: user?.fullName || user?.username || currentUser || 'System',
    }), [currentUser, user?.fullName, user?.username]);
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('rules');
    const [payslipModal, setPayslipModal] = useState<any>(null);
    const [pdfExporting, setPdfExporting] = useState(false);
    const [payslipPdfDetailOpen, setPayslipPdfDetailOpen] = useState(false);
    const [gmailSending, setGmailSending] = useState(false);

    const [leaveRecords, setLeaveRecords] = useState<LeaveRequest[]>(() => {
        try {
            const raw = localStorage.getItem('att-leave-records-v1');
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    const [workSchedules, setWorkSchedules] = useState<WorkScheduleRecord[]>(() => {
        try {
            const raw = localStorage.getItem('att-work-schedules-v1');
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        localStorage.setItem('att-leave-records-v1', JSON.stringify(leaveRecords));
    }, [leaveRecords]);

    useEffect(() => {
        localStorage.setItem('att-work-schedules-v1', JSON.stringify(workSchedules));
    }, [workSchedules]);

    const waitForPaint = () => new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const buildPayslipPDF = async (payslipData?: any) => {
        const data = payslipData ?? payslipModal;
        if (!data) return;
        const source = document.querySelector('.ps-print-view') as HTMLElement;
        if (!source) return;
        const el = source.cloneNode(true) as HTMLElement;
        el.classList.add('ps-print-view-detail', 'ps-inv-redesign');
        el.style.cssText = [
            'display:block!important',
            'position:fixed',
            'top:-100000px',
            'left:0',
            'width:820px',
            'background:#eef2f5',
            'padding:24px 0',
            'visibility:visible',
            'pointer-events:none',
            'z-index:-1',
        ].join(';');
        document.body.appendChild(el);
        try {
            // Preload external images thành data URL để html2canvas không re-fetch qua network
            const externalImgs = Array.from(el.querySelectorAll('img')).filter(img => {
                const s = img.getAttribute('src') || '';
                return s.startsWith('http://') || s.startsWith('https://');
            });
            await Promise.all(externalImgs.map(async (img) => {
                try {
                    const resp = await fetch(img.src);
                    const blob = await resp.blob();
                    await new Promise<void>((res) => {
                        const reader = new FileReader();
                        reader.onload = () => { img.src = reader.result as string; res(); };
                        reader.onerror = () => res();
                        reader.readAsDataURL(blob);
                    });
                } catch { /* giữ src gốc nếu fetch fail */ }
            }));
            const canvas = await html2canvas(el, { scale: 2, useCORS: false, backgroundColor: '#ffffff' });
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = pdf.internal.pageSize.getWidth();
            const pageH = pdf.internal.pageSize.getHeight();
            const margin = 10;
            const maxW = pageW - margin * 2;
            const pageContentH = pageH - margin * 2;
            const pageSlicePx = Math.floor((pageContentH * canvas.width) / maxW);
            let renderedPx = 0;
            let pageIndex = 0;

            while (renderedPx < canvas.height) {
                const sliceH = Math.min(pageSlicePx, canvas.height - renderedPx);
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = canvas.width;
                pageCanvas.height = sliceH;
                const ctx = pageCanvas.getContext('2d');
                if (!ctx) break;
                ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

                if (pageIndex > 0) pdf.addPage();
                const imgH = (sliceH * maxW) / canvas.width;
                const imgData = pageCanvas.toDataURL('image/png');
                pdf.addImage(imgData, 'PNG', margin, margin, maxW, imgH);

                renderedPx += sliceH;
                pageIndex += 1;
            }
            const name = data.name.replace(/\s+/g, '-');
            const period = overviewDateRange[0].format('MM-YYYY');
            return { pdf, name, period, fileName: `phieu-luong-${name}-${period}.pdf` };
        } finally {
            el.remove();
        }
    };

    const handleExportPayslipPDF = async () => {
        if (!payslipModal) return;
        setPdfExporting(true);
        try {
            await waitForPaint();
            const result = await buildPayslipPDF();
            if (!result) return;
            const { pdf, name, period, fileName } = result;
            pdf.save(fileName);
            message.success(`Đã tải xuống phiếu lương ${name.replace(/-/g, ' ')} — ${period}`);
        } finally {
            setPdfExporting(false);
        }
    };

    const handleSendPayslipGmail = async () => {
        if (!payslipModal) return;
        const api = (window as any).electronAPI;
        if (!api?.attendance?.sendPayslipEmail) {
            message.error('Chưa có API gửi Gmail. Vui lòng khởi động lại app.');
            return;
        }
        setGmailSending(true);
        try {
            const usersRes = await api.users?.getAll?.();
            const users = usersRes?.success && Array.isArray(usersRes.data) ? usersRes.data : [];
            const normalizedEmployeeUsername = normalizeAttendanceText(payslipModal.username || '');
            const normalizedEmployeeName = normalizeAttendanceText(payslipModal.name || '');
            const recipientUser = users.find((u: any) => {
                const username = normalizeAttendanceText(u.username || '');
                const fullName = normalizeAttendanceText(u.fullName || '');
                return !!(
                    (username && normalizedEmployeeUsername && (
                        username === normalizedEmployeeUsername ||
                        username.endsWith(normalizedEmployeeUsername) ||
                        normalizedEmployeeUsername.endsWith(username)
                    )) ||
                    (fullName && normalizedEmployeeName && fullName === normalizedEmployeeName)
                );
            });
            const recipientEmail = recipientUser?.email?.trim();
            if (!recipientEmail) {
                message.error(`Chưa có Gmail cho ${payslipModal.name}. Vào Cài đặt > Quản trị > Sửa người dùng để bổ sung Gmail.`);
                return;
            }
            await waitForPaint();
            const result = await buildPayslipPDF();
            if (!result) return;
            const { pdf, fileName, period } = result;
            const pdfBase64 = pdf.output('datauristring').split(',')[1];
            const res = await api.attendance.sendPayslipEmail({
                to: recipientEmail,
                employeeName: payslipModal.name,
                period,
                fileName,
                pdfBase64,
            });
            if (res?.success) {
                const periodKey = `${overviewDateRange[0].year()}-${String(overviewDateRange[0].month() + 1).padStart(2, '0')}`;
                setGmailSentLog(prev => ({ ...prev, [`${payslipModal.id}_${periodKey}`]: new Date().toISOString() }));
                message.success(`Đã gửi phiếu lương tới ${recipientEmail}`);
            } else if (res?.reauthRequired) {
                message.warning(res.error || 'Gmail chưa được cấp quyền gửi email. Cần đăng nhập Google lại với quyền Gmail.');
            } else {
                message.error(res?.error || 'Gửi Gmail thất bại');
            }
        } finally {
            setGmailSending(false);
        }
    };

    const handleBulkSendGmail = async () => {
        const api = (window as any).electronAPI;
        if (!api?.attendance?.sendPayslipEmail) {
            message.error('Chưa có API gửi Gmail. Vui lòng khởi động lại app.');
            return;
        }
        const loadingKey = 'bulk-gmail-data-ready';
        message.loading({ key: loadingKey, content: 'Đang đồng bộ dữ liệu đóng gói trước khi gửi Gmail...', duration: 0 });
        let freshPayrollData = payrollData;
        try {
            const freshPackingLogs = await loadPackingOrders(overviewDateRange[0].startOf('day').toISOString(), { strict: true });
            freshPayrollData = buildPayrollDataFromPackingLogs(freshPackingLogs);
            message.success({ key: loadingKey, content: 'Đã đồng bộ dữ liệu đóng gói đầy đủ.', duration: 2 });
        } catch (error: any) {
            message.error({ key: loadingKey, content: error?.message || 'Không tải được dữ liệu đóng gói. Chưa gửi Gmail để tránh thiếu lương đóng gói.', duration: 5 });
            return;
        }

        const usersRes = await api.users?.getAll?.();
        const users = usersRes?.success && Array.isArray(usersRes.data) ? usersRes.data : [];

        const toSend = freshPayrollData.filter(p => {
            const normUsername = normalizeAttendanceText(p.username || '');
            const normName = normalizeAttendanceText(p.name || '');
            return users.some((u: any) => {
                const uUsername = normalizeAttendanceText(u.username || '');
                const uFullName = normalizeAttendanceText(u.fullName || '');
                const matched = !!(
                    (uUsername && normUsername && (uUsername === normUsername || uUsername.endsWith(normUsername) || normUsername.endsWith(uUsername))) ||
                    (uFullName && normName && uFullName === normName)
                );
                return matched && !!u?.email?.trim();
            });
        });

        if (toSend.length === 0) {
            message.warning('Không tìm thấy nhân viên nào có Gmail. Vào Cài đặt > Quản trị để bổ sung Gmail.');
            return;
        }

        Modal.confirm({
            title: 'Gửi Gmail hàng loạt',
            icon: <SendOutlined style={{ color: '#1677ff' }} />,
            content: (
                <div>
                    <p>Sẽ gửi phiếu lương tới <strong>{toSend.length}</strong> nhân viên có Gmail:</p>
                    <ul style={{ margin: '8px 0', paddingLeft: 20, maxHeight: 150, overflowY: 'auto' }}>
                        {toSend.map(p => <li key={p.id}>{p.name}</li>)}
                    </ul>
                    <p style={{ color: '#888', fontSize: 12 }}>Nhân viên chưa có Gmail sẽ bị bỏ qua.</p>
                </div>
            ),
            okText: 'Gửi ngay',
            cancelText: 'Hủy',
            onOk: async () => {
                const periodKey = `${overviewDateRange[0].year()}-${String(overviewDateRange[0].month() + 1).padStart(2, '0')}`;
                setBulkSendProgress({ running: true, current: 0, total: toSend.length, currentName: '', results: [] });
                const results: { name: string; success: boolean; error?: string }[] = [];
                setPayslipPdfDetailOpen(false);

                for (let i = 0; i < toSend.length; i++) {
                    const p = toSend[i];
                    setBulkSendProgress(prev => prev ? { ...prev, current: i + 1, currentName: p.name } : prev);
                    try {
                        const normUsername = normalizeAttendanceText(p.username || '');
                        const normName = normalizeAttendanceText(p.name || '');
                        const u = users.find((u: any) => {
                            const uUsername = normalizeAttendanceText(u.username || '');
                            const uFullName = normalizeAttendanceText(u.fullName || '');
                            return !!(
                                (uUsername && normUsername && (uUsername === normUsername || uUsername.endsWith(normUsername) || normUsername.endsWith(uUsername))) ||
                                (uFullName && normName && uFullName === normName)
                            );
                        });
                        const recipientEmail = u?.email?.trim();
                        if (!recipientEmail) {
                            results.push({ name: p.name, success: false, error: 'Chưa có Gmail' });
                            continue;
                        }
                        setPayslipModal(p);
                        await waitForPaint();
                        await waitForPaint();
                        const pdfResult = await buildPayslipPDF(p);
                        if (!pdfResult) {
                            results.push({ name: p.name, success: false, error: 'Lỗi render PDF' });
                            continue;
                        }
                        const { pdf, fileName, period } = pdfResult;
                        const pdfBase64 = pdf.output('datauristring').split(',')[1];
                        const res = await api.attendance.sendPayslipEmail({ to: recipientEmail, employeeName: p.name, period, fileName, pdfBase64 });
                        if (res?.reauthRequired) {
                            const authError = res.error || 'Can dang nhap Google lai';
                            results.push({ name: p.name, success: false, error: authError });
                            for (let j = i + 1; j < toSend.length; j++) {
                                results.push({ name: toSend[j].name, success: false, error: 'Chua gui - can dang nhap Google lai' });
                            }
                            message.warning(authError);
                            break;
                        }
                        if (res?.success) {
                            results.push({ name: p.name, success: true });
                            setGmailSentLog(prev => ({ ...prev, [`${p.id}_${periodKey}`]: new Date().toISOString() }));
                        } else if (res?.reauthRequired) {
                            results.push({ name: p.name, success: false, error: 'Cần đăng nhập Google lại' });
                        } else {
                            results.push({ name: p.name, success: false, error: res?.error || 'Gửi thất bại' });
                        }
                    } catch (err: any) {
                        results.push({ name: p.name, success: false, error: err?.message || 'Lỗi không xác định' });
                    }
                }
                setPayslipModal(null);
                setBulkSendProgress({ running: false, current: toSend.length, total: toSend.length, currentName: '', results });
            },
        });
    };

    const [activeTab, setActiveTab] = useState('overview');
    const [config, setConfig] = useState<PenaltyConfig>({
        graceMinutes: 5,
        // NV Chính thức theo Plan mục 3
        officialFineLevel1: 30000,   // 6-15p
        officialFineLevel2: 70000,   // 16-30p
        officialFineLevel3: 150000,  // >30p
        // NV Thời vụ theo Plan mục 3
        seasonalFineLevel1: 10000,
        seasonalFineLevel2: 30000,
        seasonalFineLevel3: 60000,
        // Đóng gói sai
        wrongOrderFineOfficial: 30000,
        wrongOrderFineSeasonal: 15000,
        // Ca làm
        morningStart: '08:00',
        afternoonStart: '13:30',
        standardWorkDays: 26,
    });
    const [tempConfig, setTempConfig] = useState<PenaltyConfig>(config);

    const [employees, setEmployees] = useState<Employee[]>([]);

    // === State cho quỹ + audit ===
    const [bonusModalOpen, setBonusModalOpen] = useState(false);
    const [editingBonus, setEditingBonus] = useState<BonusRecord | null>(null);
    const [bonusAuditLog, setBonusAuditLog] = useState<BonusAuditLog[]>([]);
    const [fundModalType, setFundModalType] = useState<'in' | 'out' | null>(null);
    const [editingFundTx, setEditingFundTx] = useState<FundTransaction | null>(null);
    const [extraBonuses, setExtraBonuses] = useState<BonusRecord[]>([]);
    const [extraFundTx, setExtraFundTx] = useState<FundTransaction[]>([]);
    const [fundAuditLog, setFundAuditLog] = useState<FundAuditLog[]>([]);
    const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
    const currentFundActorKeys = useMemo(() => {
        return [currentUser, user?.username, user?.fullName]
            .filter(Boolean)
            .map(value => normalizeAttendanceText(String(value)));
    }, [currentUser, user?.fullName, user?.username]);
    const canEditFundTx = useCallback((tx: FundTransaction) => {
        const isManualFundTx = extraFundTx.some(item => item.id === tx.id);
        if (!isManualFundTx) return false;
        if (isAdmin) return true;
        if (!canCreateFundTx) return false;

        const createdMs = getFundTxCreatedMs(tx);
        if (!createdMs) return false;
        if (Date.now() - createdMs > FUND_TX_EDIT_WINDOW_MS) return false;

        const owner = normalizeAttendanceText(tx.createdBy || tx.person || '');
        if (!owner) return false;
        return currentFundActorKeys.includes(owner);
    }, [canCreateFundTx, currentFundActorKeys, extraFundTx, isAdmin]);
    const [bonusForm] = Form.useForm();
    const bonusKind = Form.useWatch('bonusKind', bonusForm);
    const overtimeHours = Form.useWatch('overtimeHours', bonusForm);

    useEffect(() => {
        if (bonusKind !== 'overtime') return;
        bonusForm.setFieldsValue({ amount: calculateOvertimeBonus(Number(overtimeHours) || 0) });
    }, [bonusKind, overtimeHours, bonusForm]);

    // === State cho phạt thủ công ===
    const [extraFines, setExtraFines] = useState<FineRecord[]>([]);
    const [fineOverrides, setFineOverrides] = useState<Record<string, FineRecord>>({});
    const [fineAuditLog, setFineAuditLog] = useState<FineAuditLog[]>([]);
    const [fineEmployeeFilter, setFineEmployeeFilter] = useState<number | 'all'>('all');
    const [editingFine, setEditingFine] = useState<{
        isManual: boolean;
        manualIndex: number;
        overrideKey?: string;
        fine: FineRecord;
    } | null>(null);
    const employeesRef = useRef<Employee[]>([]);
    const fineAuditActorRef = useRef(fineAuditActor);

    useEffect(() => {
        employeesRef.current = employees;
    }, [employees]);

    useEffect(() => {
        fineAuditActorRef.current = fineAuditActor;
    }, [fineAuditActor]);

    // === State cho danh sách kỳ đã chốt ===
    const [lockedPeriods, setLockedPeriods] = useState<LockedPeriod[]>([]);

    // === Ghi đè lương thủ công (Admin) ===
    const [payrollOverrides, setPayrollOverrides] = useState<Record<string, PayrollOverride>>({});
    // === Log Gmail đã gửi: key = `${empId}_${periodKey}`, value = ISO timestamp ===
    const [gmailSentLog, setGmailSentLog] = useState<Record<string, string>>({});
    const [bulkSendProgress, setBulkSendProgress] = useState<{
        running: boolean;
        current: number;
        total: number;
        currentName: string;
        results: { name: string; success: boolean; error?: string }[];
    } | null>(null);
    const [purchaseVatTracking, setPurchaseVatTracking] = useState<PurchaseVatTracking[]>([]);
    const [dailyTaskTracking, setDailyTaskTracking] = useState<any[]>([]);
    const [evidencePenaltyRecords, setEvidencePenaltyRecords] = useState<any[]>([]);
    const [stockCheckSessions, setStockCheckSessions] = useState<any[]>([]);
    const [stockBalanceRecords, setStockBalanceRecords] = useState<any[]>([]);

    const [isDbLoaded, setIsDbLoaded] = useState(false);
    const [systemUsernames, setSystemUsernames] = useState<string[]>([]);
    const [systemUsers, setSystemUsers] = useState<any[]>([]);

    // 1. Tải dữ liệu từ DB lúc mở component
    useEffect(() => {
        const loadData = async () => {
            try {
                const api = (window as any).electronAPI;

                // Fetch danh sách username hệ thống TRƯỚC để dùng migrate
                let sysUsernames: string[] = [];
                try {
                    const usersRes = await api.users.getAll();
                    if (usersRes.success && usersRes.data) {
                        setSystemUsers(usersRes.data);
                        sysUsernames = usersRes.data
                            .filter((u: any) =>
                                u?.username &&
                                u.username.toLowerCase() !== 'admin' &&
                                u.isActive !== false &&
                                u.operationalAssignee !== false
                            )
                            .map((u: any) => u.username);
                        setSystemUsernames(sysUsernames);
                    }
                } catch (_) { }

                // Hàm migrate username cũ (toan → nguyendinhtoan) sang username Quản trị
                const migrateUsername = (uname: string): string => {
                    if (!uname) return uname;
                    if (sysUsernames.includes(uname)) return uname; // đã đúng
                    const matched = sysUsernames.find(su => su.endsWith(uname));
                    return matched || uname;
                };

                if (isAdmin && api.attendance?.reconcileLateFines) {
                    const reconcileResult = await api.attendance.reconcileLateFines();
                    if (!reconcileResult?.success) {
                        console.error('Lỗi đối soát phạt đi muộn:', reconcileResult?.error);
                    }
                }
                const rs = await api.appConfig.get('attendanceData');
                if (rs && rs.success && rs.data) {
                    const d = rs.data;
                    if (d.config) {
                        setConfig(d.config);
                        setTempConfig(d.config);
                    }
                    if (d.employees && Array.isArray(d.employees) && d.employees.length > 0) {
                        const merged = d.employees.map((emp: any) => {
                            const username = emp.username
                                ? migrateUsername(emp.username)
                                : (initialEmployees.find(ie => ie.id === emp.id)?.username || '');
                            return { ...emp, username };
                        });
                        setEmployees(merged);
                    } else if (!d.employees) {
                        setEmployees(initialEmployees);
                    }
                    // Nếu d.employees là mảng rỗng [] → giữ nguyên (user đã xóa hết NV)
                    if (d.bonusAuditLog) setBonusAuditLog(d.bonusAuditLog);
                    if (d.extraBonuses) setExtraBonuses(d.extraBonuses);
                    if (d.extraFundTx) setExtraFundTx(d.extraFundTx);
                    if (d.fundAuditLog) setFundAuditLog(d.fundAuditLog);
                    if (d.extraFines) {
                        const normalized = await normalizeReturnFineDates(api, d.extraFines);
                        setExtraFines(normalized.fines.map((fine: FineRecord, index: number) => ensureFineId(fine, index)));
                        if (normalized.changed) {
                            await api.appConfig.set('attendanceData', { ...d, extraFines: normalized.fines });
                        }
                    }
                    if (d.fineOverrides) setFineOverrides(d.fineOverrides);
                    if (d.fineAuditLog) setFineAuditLog(d.fineAuditLog);
                    if (d.lockedPeriods) setLockedPeriods(d.lockedPeriods);
                    if (d.payrollOverrides) setPayrollOverrides(d.payrollOverrides);
                    if (d.gmailSentLog) setGmailSentLog(d.gmailSentLog);
                } else {
                    setEmployees(initialEmployees);
                }
            } catch (err) {
                console.error('Lỗi tải dữ liệu chấm công từ DB:', err);
            } finally {
                setIsDbLoaded(true);
            }
        };
        loadData();

        // Lắng nghe fine mới từ trang Trả hàng
        const handleFineAdded = (e: Event) => {
            const newFine = (e as CustomEvent).detail;
            if (newFine) {
                const fineWithId = ensureFineId(newFine, Date.now());
                setExtraFines(prev => [...prev, fineWithId]);
                const now = new Date().toLocaleString('vi-VN');
                const actor = fineAuditActorRef.current;
                const employeeName = employeesRef.current.find(emp => emp.id === fineWithId.empId)?.name || '';
                setFineAuditLog(prev => [...prev, {
                    id: 'flog-' + Date.now(),
                    action: 'create',
                    timestamp: now,
                    changedBy: actor.username,
                    changedByName: actor.displayName,
                    after: fineWithId,
                    note: 'Thêm phạt: ' + employeeName + ' — ' + fmt(newFine.amount || 0) + ' — "' + (newFine.detail || '') + '"',
                }]);
            }
        };
        const handleFineRemoved = (e: Event) => {
            const { complaintCode } = (e as CustomEvent).detail || {};
            if (complaintCode) {
                setExtraFines(prev => {
                    const removedFines = prev.filter((f: any) =>
                        f.source === 'returns' && f.detail && f.detail.includes(complaintCode)
                    );
                    if (removedFines.length > 0) {
                        const now = new Date().toLocaleString('vi-VN');
                        const actor = fineAuditActorRef.current;
                        setFineAuditLog(logPrev => [
                            ...logPrev,
                            ...removedFines.map((fine: FineRecord, index: number) => ({
                                id: 'flog-' + Date.now() + '-' + index,
                                action: 'delete' as const,
                                timestamp: now,
                                changedBy: actor.username,
                                changedByName: actor.displayName,
                                before: fine,
                                note: 'Xóa khoản phạt: ' + (employeesRef.current.find(emp => emp.id === fine.empId)?.name || '') + ' — ' + fmt(fine.amount) + ' — "' + fine.detail + '"',
                            })),
                        ]);
                    }
                    return prev.filter((f: any) =>
                        !(f.source === 'returns' && f.detail && f.detail.includes(complaintCode))
                    );
                });
            }
        };
        window.addEventListener('attendance:fineAdded', handleFineAdded);
        window.addEventListener('attendance:fineRemoved', handleFineRemoved);
        return () => {
            window.removeEventListener('attendance:fineAdded', handleFineAdded);
            window.removeEventListener('attendance:fineRemoved', handleFineRemoved);
        };
    }, []);

    // Ref lưu snapshot mới nhất để flush khi unmount hoặc đóng app
    const latestSnapshotRef = useRef<object | null>(null);

    // 2a. Luôn cập nhật ref khi state thay đổi (không debounce, không ghi DB)
    useEffect(() => {
        if (!isDbLoaded || employees.length === 0) return;
        latestSnapshotRef.current = { config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineOverrides, fineAuditLog, lockedPeriods, payrollOverrides, gmailSentLog };
    }, [config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineOverrides, fineAuditLog, lockedPeriods, payrollOverrides, gmailSentLog, isDbLoaded]);

    const mergeAttendanceSnapshotWithDb = useCallback(async (snapshot: Record<string, any>) => {
        const api = (window as any).electronAPI;
        try {
            const latest = await api.appConfig.get('attendanceData');
            const dbData = latest?.success && latest.data ? latest.data : {};
            const mergedFineAuditLog = mergeAuditLogs(dbData.fineAuditLog || [], snapshot.fineAuditLog || []);
            return {
                ...dbData,
                ...snapshot,
                extraFines: mergeFinesWithDeletes(
                    dbData.extraFines || [],
                    snapshot.extraFines || [],
                    mergedFineAuditLog,
                    dbData.fineAuditLog || [],
                    snapshot.fineAuditLog || [],
                ),
                fineOverrides: { ...(dbData.fineOverrides || {}), ...(snapshot.fineOverrides || {}) },
                fineAuditLog: mergedFineAuditLog,
            };
        } catch {
            return snapshot;
        }
    }, []);

    const saveAttendanceSnapshot = useCallback(async (snapshot: Record<string, any>) => {
        const api = (window as any).electronAPI;
        const mergedSnapshot = await mergeAttendanceSnapshotWithDb(snapshot);
        const result = await api.appConfig.set('attendanceData', mergedSnapshot);
        if (result?.success) latestSnapshotRef.current = mergedSnapshot;
        return result;
    }, [mergeAttendanceSnapshotWithDb]);

    const persistAttendanceSnapshotNow = useCallback(async (patch: Record<string, any>) => {
        if (!isDbLoaded || employees.length === 0) return false;
        const baseSnapshot = latestSnapshotRef.current || {
            config,
            employees,
            bonusAuditLog,
            extraBonuses,
            extraFundTx,
            fundAuditLog,
            extraFines,
            fineOverrides,
            fineAuditLog,
            lockedPeriods,
            payrollOverrides,
            gmailSentLog,
        };
        const snapshot = { ...baseSnapshot, ...patch };
        latestSnapshotRef.current = snapshot;
        try {
            const result = await saveAttendanceSnapshot(snapshot);
            if (!result?.success) throw new Error(result?.error || 'Lưu dữ liệu chấm công thất bại');
            return true;
        } catch (err) {
            console.error('Lỗi lưu nhanh dữ liệu chấm công vào DB:', err);
        }
    }, [isDbLoaded, employees, config, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineOverrides, fineAuditLog, lockedPeriods, payrollOverrides, gmailSentLog, saveAttendanceSnapshot]);

    // 2b. Lưu tự động khi có thay đổi state với Debounce
    useEffect(() => {
        if (!isDbLoaded) return; // Không lưu đè lúc chưa tải xong
        if (employees.length === 0) return; // Chưa có data employees → không ghi đè DB

        const snapshot = { config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineOverrides, fineAuditLog, lockedPeriods, payrollOverrides, gmailSentLog };

        const saveData = async () => {
            try {
                await saveAttendanceSnapshot(snapshot);
            } catch (err) {
                console.error('Lỗi lưu dữ liệu chấm công vào DB:', err);
            }
        };

        const timer = setTimeout(saveData, 500); // Đợi 500ms thao tác cuối rồi mới save
        return () => clearTimeout(timer);
    }, [config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineOverrides, fineAuditLog, lockedPeriods, payrollOverrides, gmailSentLog, isDbLoaded, saveAttendanceSnapshot]);

    // 2c. Flush save khi component unmount (navigate sang tab khác) để tránh mất data
    useEffect(() => {
        return () => {
            if (latestSnapshotRef.current) {
                saveAttendanceSnapshot(latestSnapshotRef.current as Record<string, any>)
                    .catch(console.error);
            }
        };
    }, [saveAttendanceSnapshot]);

    // Flush save ngay lập tức khi reload hoặc đóng app
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (latestSnapshotRef.current) {
                try { void saveAttendanceSnapshot(latestSnapshotRef.current as Record<string, any>); } catch { }
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [saveAttendanceSnapshot]);

    const [fineModalOpen, setFineModalOpen] = useState(false);
    const [fineForm] = Form.useForm();
    const [fineTypeDropdownOpen, setFineTypeDropdownOpen] = useState(false);
    const [fundForm] = Form.useForm();
    const [empForm] = Form.useForm();
    const [empModalOpen, setEmpModalOpen] = useState(false);
    const [empListModalOpen, setEmpListModalOpen] = useState(false);
    const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

    // State cho lọc kỳ lương Tổng quát — mặc định theo tháng hiện tại
    const [overviewDateRange, setOverviewDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
        dayjs().startOf('month'),
        dayjs().endOf('month'),
    ]);

    const [packingOrderLogsData, setPackingOrderLogsData] = useState<PackingOrderLog[]>([]);
    const [packingDateRange, setPackingDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
    const loadPurchasesRef = useRef(false);

    const loadPackingPromiseRef = useRef<Promise<PackingOrderLog[]> | null>(null);
    const [packingOrdersLoading, setPackingOrdersLoading] = useState(false);
    const loadPackingOrders = async (since?: string, options?: { strict?: boolean }): Promise<PackingOrderLog[]> => {
        if (loadPackingPromiseRef.current) {
            console.log('[PACKING] Await existing loading promise');
            return loadPackingPromiseRef.current;
        }

        const task = (async () => {
        try {
            const api = (window as any).electronAPI;
            const sinceVal = since || overviewDateRange[0].startOf('day').toISOString();
            const untilVal = overviewDateRange[1].endOf('day').toISOString();
            const rangeDays = Math.max(overviewDateRange[1].endOf('day').diff(overviewDateRange[0].startOf('day'), 'day') + 1, 1);
            const packingFetchLimit = Math.min(Math.max(rangeDays * 800, 2000), 10000);

            // Timeout wrapper: nếu API không trả kết quả trong 10s → bỏ qua
            const withTimeout = (p: Promise<any>, label: string, ms = 10000) =>
                Promise.race([
                    p.then(r => { console.log(`[PACKING] ✅ ${label}:`, r?.data?.length || 0); return r; }),
                    new Promise((_, reject) => setTimeout(() => reject(`${label} TIMEOUT (${ms}ms)`), ms))
                ]).catch(e => { console.warn(`[PACKING] ⚠️ ${label} failed:`, e); return { success: false, data: [] }; });

            // Chỉ lấy TMDT — POS và Xuất hàng không tính vào nhật ký đóng gói
            const ecRes = await withTimeout(
                api.ecommerceExports.getAll({
                    since: sinceVal,
                    until: untilVal,
                    sinceField: 'updatedAt',
                    limit: packingFetchLimit,
                }),
                'Ecom'
            );
            console.log('[PACKING] Ecom done:', ecRes?.data?.length);
            if (options?.strict && !ecRes.success) {
                throw new Error('Không tải được dữ liệu đóng gói từ Supabase. Chưa gửi Gmail để tránh thiếu thưởng đóng gói.');
            }

            const getPlatform = (_source: string, customer: string) => {
                const c = (customer || '').toLowerCase();
                if (c.includes('shopee')) return 'Shopee';
                if (c.includes('tiktok')) return 'TikTok';
                return 'Web';
            };

            const unified: PackingOrderLog[] = [];

            const processOrder = (order: any, source: string) => {
                let items: any[] = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);

                // Lấy TẤT CẢ sản phẩm (không filter theo SKU cụ thể nữa)
                const validItems = items.filter(it => {
                    const sku = (it.variantSku || it.sku || it.variant_sku || it.product_sku || it.SKU || it.Sku || '');
                    return sku && sku.trim() !== ''; // Chỉ bỏ qua item không có SKU
                });

                if (validItems.length === 0) return;

                const mappedItems = validItems.map(it => ({
                    sku: (it.variantSku || it.sku || it.variant_sku || it.product_sku || it.SKU || it.Sku || ''),
                    productName: it.productName || it.name || '-',
                    variant: it.variant || '',
                    quantity: it.quantity || it.qty || 1,
                }));

                const totalSKU = mappedItems.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0);
                if (totalSKU === 0) return;

                const customerName = order.customer?.name || order.customerName || order.customer || 'Khách';

                unified.push({
                    id: `${source}-${order.id}`,
                    timestamp: String(order.updatedAt || order.createdAt || order.date || order.exportDate || ''),
                    orderNumber: order.orderNumber || order.ecommerceExportCode || `#${source.toUpperCase()}-${order.id}`,
                    platform: getPlatform(source, customerName),
                    customerName,
                    // Packer: dùng pickedBy (string), fallback createdBy (string username)
                    packer: (typeof order.pickedBy === 'string' && order.pickedBy) ? order.pickedBy
                        : (typeof order.createdBy === 'string' && order.createdBy) ? order.createdBy
                            : 'Không ghi nhận',
                    items: mappedItems,
                    totalSKU,
                    status: order.status === 'completed' ? 'completed' : 'issue'
                });
            };

            // Chỉ tính TMDT completed
            if (ecRes.success && ecRes.data) ecRes.data.filter((o: any) => o.status === 'completed').forEach((o: any) => processOrder(o, 'tmdt'));

            console.log('[PACKING] Done. Ecom:', ecRes.success ? (ecRes.data?.length || 0) : 'FAIL', '| Unified:', unified.length);

            const sorted = unified.sort((a, b) => dayjs(b.timestamp).unix() - dayjs(a.timestamp).unix());
            setPackingOrderLogsData(sorted);
            return sorted;
        } catch (error) {
            console.error('Lỗi tải dữ liệu đơn hàng:', error);
            message.error('Không thể tải dữ liệu đơn đóng gói!');
            if (options?.strict) throw error;
            return [];
        }
        })();

        loadPackingPromiseRef.current = task;
        setPackingOrdersLoading(true);
        try {
            return await task;
        } finally {
            loadPackingPromiseRef.current = null;
            setPackingOrdersLoading(false);
        }
    };

    // === State cho điểm danh online ===
    const loadPurchaseVatTracking = async (since?: string) => {
        if (loadPurchasesRef.current) return;
        loadPurchasesRef.current = true;
        try {
            const api = (window as any).electronAPI;
            const result = await api.purchases.getAll({ since, limit: 10000 });
            if (result?.success && Array.isArray(result.data)) {
                setPurchaseVatTracking(result.data);
            }
        } catch (error) {
            console.error('Lỗi tải dữ liệu VAT nhập hàng:', error);
        } finally {
            loadPurchasesRef.current = false;
        }
    };

    const loadDailyTaskTracking = async () => {
        try {
            const api = (window as any).electronAPI;
            const [result, penaltyResult] = await Promise.all([
                api.dailyTasks.list({}),
                api.dailyTasks.listEvidencePenalties(),
            ]);
            if (result?.success && Array.isArray(result.data)) {
                setDailyTaskTracking(result.data);
            }
            setEvidencePenaltyRecords(penaltyResult?.success && Array.isArray(penaltyResult.data) ? penaltyResult.data : []);
            try {
                const balanceResult = await api.stockBalance?.getAll?.({ limit: 500 });
                if (balanceResult?.success && Array.isArray(balanceResult.data)) {
                    setStockBalanceRecords(balanceResult.data);
                } else {
                    setStockBalanceRecords([]);
                }
            } catch {
                setStockBalanceRecords([]);
            }
            try {
                if (!isAdmin) {
                    setStockCheckSessions([]);
                } else {
                    const stockCheckResult = await api.stockCheck.getSessions();
                    setStockCheckSessions(stockCheckResult?.success && Array.isArray(stockCheckResult.data)
                        ? stockCheckResult.data
                        : []);
                }
            } catch {
                setStockCheckSessions([]);
            }
        } catch (error) {
            console.error('Lỗi tải dữ liệu deadline công việc:', error);
        }
    };

    const [liveAttendanceLogs, setLiveAttendanceLogs] = useState<any[]>([]);
    const [overviewAttendanceLogs, setOverviewAttendanceLogs] = useState<any[]>([]);
    const [overviewAttendanceLogsKey, setOverviewAttendanceLogsKey] = useState('');
    const attendanceMatrixWrapRef = useRef<HTMLDivElement | null>(null);

    // === State cho đóng gói + lịch sử ===
    const warehousePacking = useMemo(() => {
        let totalUnits = 0;
        packingOrderLogsData.forEach(order => {
            totalUnits += calcPacksFromItems(order.items);
        });
        return { level1Units: totalUnits, level10Units: 0 };
    }, [packingOrderLogsData]);

    const [expandedPackingKeys, setExpandedPackingKeys] = useState<string[]>([]);

    // State cho chọn tháng (dùng cho tab Vân tay)
    const selectedMonth = overviewDateRange[0].month() + 1;
    const selectedYear = overviewDateRange[0].year();

    // Reload packing orders khi đổi kỳ
    useEffect(() => {
        if (activeTab !== 'overview') return;
        loadPackingOrders(overviewDateRange[0].startOf('day').toISOString());
        // Supporting indicators are not needed for the first overview paint.
        // Yield once so the shell and primary attendance data render first.
        const deferredLoad = window.setTimeout(() => {
            loadPurchaseVatTracking(overviewDateRange[0].subtract(7, 'day').startOf('day').toISOString());
            loadDailyTaskTracking();
        }, 0);
        const taskTrackingTimer = window.setInterval(() => {
            if (document.visibilityState === 'visible') loadDailyTaskTracking();
        }, 60 * 1000);
        return () => {
            window.clearTimeout(deferredLoad);
            window.clearInterval(taskTrackingTimer);
        };
    }, [overviewDateRange, activeTab]);

    // Gộp finesData gốc + extraFines
    const autoVatOverdueFines = useMemo(() => {
        return purchaseVatTracking.flatMap((purchase) => {
            const vatStatus = String(purchase.vatInvoiceStatus || 'pending').toLowerCase();
            if (['uploaded', 'verified', 'thht', 'no_vat'].includes(vatStatus)) return [];
            if (purchase.vatGroupId && purchase.vatGroupHasVat) return [];
            const companyVatEntries = Object.values(purchase.companyVatByGroup || {});
            if (companyVatEntries.length > 0 && companyVatEntries.every(vat => ['uploaded', 'verified', 'no_vat'].includes(String(vat?.status || '').toLowerCase()))) return [];

            const purchaseAtRaw = purchase.purchaseDate || purchase.createdAt;
            if (!purchaseAtRaw) return [];

            const purchaseAt = dayjs(purchaseAtRaw);
            if (!purchaseAt.isValid()) return [];
            if (purchaseAt.isBefore(VAT_OVERDUE_POLICY_START)) return [];

            const penaltyDate = purchaseAt.add(5, 'day');
            if (!penaltyDate.isBefore(dayjs())) return [];
            if (!inOverviewRange(penaltyDate.toISOString())) return [];

            const creatorKey = normalizeAttendanceText(purchase.createdBy || '');
            const creator = employees.find(emp => normalizeAttendanceText(emp.username) === creatorKey)
                || employees.find(emp => matchTaskAssigneeToEmployee(purchase.createdBy, emp));
            if (!creator) return [];

            return [{
                // Stable ID lets us persist the fine once and keep it after a
                // late VAT upload, without creating duplicates on reload.
                id: `vat-overdue-${purchase.id}`,
                empId: creator.id,
                type: 'VAT quá hạn nhập hàng',
                detail: `Phiếu ${purchase.poNumber || `#${purchase.id}`}${purchase.supplierName ? ` - ${purchase.supplierName}` : ''} quá 5 ngày chưa cập nhật HĐ VAT`,
                amount: VAT_OVERDUE_FINE_AMOUNT,
                date: penaltyDate.toISOString(),
                source: 'purchase_vat_overdue' as any,
            }];
        });
    }, [employees, purchaseVatTracking, overviewDateRange]);

    // VAT fines are historical events. Once an overdue row has appeared in
    // payroll, persist it as an ordinary fine; uploading the invoice later
    // must not erase the already-recorded deduction.
    useEffect(() => {
        if (!isAdmin || !isDbLoaded || employees.length === 0 || autoVatOverdueFines.length === 0) return;
        const existingIds = new Set(extraFines.filter(fine => fine.source === 'purchase_vat_overdue').map(fine => fine.id).filter(Boolean));
        const deletedIds = new Set(getDeletedFineKeys(fineAuditLog));
        const missing = autoVatOverdueFines.filter(fine => fine.id && !existingIds.has(fine.id) && !deletedIds.has(fine.id));
        if (missing.length === 0) return;

        const now = new Date().toLocaleString('vi-VN');
        const actor = fineAuditActorRef.current;
        const auditEntries: FineAuditLog[] = missing.map(fine => ({
            id: `flog-vat-${fine.id}`,
            action: 'create',
            timestamp: now,
            changedBy: actor.username,
            changedByName: actor.displayName,
            after: fine,
            note: `Tự động ghi nhận phạt trễ HĐ VAT: ${fine.detail}`,
        }));
        const nextFines = [...extraFines, ...missing];
        const nextAuditLog = [...fineAuditLog, ...auditEntries];
        setExtraFines(nextFines);
        setFineAuditLog(nextAuditLog);
        void persistAttendanceSnapshotNow({ extraFines: nextFines, fineAuditLog: nextAuditLog });
    }, [isAdmin, isDbLoaded, employees.length, autoVatOverdueFines, extraFines, fineAuditLog, persistAttendanceSnapshotNow]);

    const autoDeadlineOverdueFines = useMemo(() => {
        const officialEmployees = employees.filter(emp => emp.type === 'Official');

        return dailyTaskTracking.flatMap((task: any) => {
            if (!task || task.type !== 'assignment' || task.status === 'completed') return [];
            if (!task.assignee || !task.dueDate) return [];
            try {
                const attachments = typeof task.attachments === 'string' ? JSON.parse(task.attachments) : (task.attachments || {});
                if (attachments?.evidence?.required) return [];
            } catch {
                // Malformed legacy metadata falls back to the deadline policy.
            }

            const deadline = dayjs(task.dueDate);
            if (!deadline.isValid()) return [];
            if (!deadline.isBefore(dayjs())) return [];
            if (!inOverviewRange(deadline.toISOString())) return [];

            const responsibleEmployees = getAssignmentDeadlineRecipients(task)
                .map(recipient => officialEmployees.find(emp => matchTaskAssigneeToEmployee(recipient, emp)))
                .filter((employee): employee is Employee => Boolean(employee));
            if (responsibleEmployees.length === 0) return [];

            const totalFine = getAssignmentDeadlineFineAmount(task);
            const baseFine = Math.floor(totalFine / responsibleEmployees.length);
            const remainder = totalFine % responsibleEmployees.length;
            return responsibleEmployees.map((employee, index) => ({
                empId: employee.id,
                type: 'Trễ deadline công việc',
                detail: `${task.title || 'Công việc bàn giao'} quá deadline (chia ${responsibleEmployees.length} người)`,
                amount: baseFine + (index < remainder ? 1 : 0),
                date: deadline.toISOString(),
                source: 'daily_task_overdue' as any,
            }));
        });
    }, [employees, dailyTaskTracking, overviewDateRange]);

    const autoEvidenceOverdueFines = useMemo(() => {
        const officialEmployees = employees.filter(emp => emp.type === 'Official');
        return evidencePenaltyRecords.flatMap((penalty: any) => {
            const penaltyAt = dayjs(penalty.penaltyAt);
            if (!penaltyAt.isValid() || !inOverviewRange(penaltyAt.toISOString())) return [];
            // assignee of a fixed task is the username selected from Settings > Administration.
            // Resolve that account first, then map its full name to the attendance employee record.
            const taskUsername = normalizeAttendanceText(penalty.assignee);
            const account = systemUsers.find((item: any) =>
                normalizeAttendanceText(item?.username) === taskUsername
            );
            const employee = officialEmployees.find(emp =>
                normalizeAttendanceText(emp.username) === taskUsername
                || (account && matchTaskAssigneeToEmployee(account.fullName, emp))
            );
            if (!employee) return [];
            return [{
                id: penalty.id,
                empId: employee.id,
                type: penalty.type || 'Không nộp bằng chứng đúng hạn',
                detail: penalty.detail || 'Quá hạn nộp bằng chứng',
                amount: Number(penalty.amount) || 0,
                date: penaltyAt.toISOString(),
                source: 'daily_task_evidence_overdue' as any,
            }];
        });
    }, [employees, evidencePenaltyRecords, overviewDateRange, systemUsers]);

    const autoStockCheckMissingFines = useMemo(() => {
        const endLimit = dayjs().subtract(1, 'day').endOf('day');
        const rangeStart = overviewDateRange[0].startOf('day');
        const rangeEnd = overviewDateRange[1].isBefore(endLimit)
            ? overviewDateRange[1].endOf('day')
            : endLimit;

        if (!isAdmin || rangeEnd.isBefore(rangeStart, 'day')) return [] as FineRecord[];

        const fines: FineRecord[] = [];
        for (let date = rangeStart; date.isBefore(rangeEnd) || date.isSame(rangeEnd, 'day'); date = date.add(1, 'day')) {
            if (!isPastStockCheckWorkingDay(date)) continue;

            const dateKey = date.format('YYYY-MM-DD');
            // A daily session is exempt when it is submitted, or when every SKU
            // assigned for that day was already balanced in a full-stock check.
            const dailySession = stockCheckSessions.find((s: any) =>
                s.date === dateKey && s.type !== 'full'
            );
            const hasCompletedDailyCheck = Boolean(
                dailySession?.status === 'completed' && dailySession?.completedAt
            );
            const dailyItems = Array.isArray(dailySession?.items) ? dailySession.items : [];
            const fullSessionItems = stockCheckSessions
                .filter((s: any) => s.date === dateKey && s.type === 'full')
                .flatMap((s: any) => Array.isArray(s.items) ? s.items : []);
            const dailyCoveredByFullCheck = dailyItems.length > 0
                && dailyItems.every((dailyItem: any) => fullSessionItems.some((fullItem: any) =>
                    String(fullItem?.sku) === String(dailyItem?.sku) && fullItem?.balanced === true
                ));
            if (hasCompletedDailyCheck || dailyCoveredByFullCheck) continue;

            const session = dailySession;

            let assignee: typeof employees[number] | undefined;
            if (session) {
                // Session tồn tại nhưng chưa hoàn thành → phạt người được giao
                assignee = employees.find(emp => matchTaskAssigneeToEmployee(session.assignedTo, emp));
            } else {
                // Không có session → tính ngược rotation để xác định ai đáng lẽ phải kiểm
                const rotationUsernames = [...new Set(
                    (stockCheckSessions as any[])
                        .filter(s => s.type !== 'full' && s.assignedTo)
                        .map(s => (s.assignedTo as string).toLowerCase())
                )].sort((a, b) => a.localeCompare(b, 'vi'));
                if (!rotationUsernames.length) continue;

                const previousSession = (stockCheckSessions as any[])
                    .filter(s => dayjs(s.date).isBefore(date, 'day') && s.type !== 'full' && s.assignedTo)
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

                const expectedUsername = previousSession
                    ? rotationUsernames[(rotationUsernames.indexOf(previousSession.assignedTo.toLowerCase()) + 1) % rotationUsernames.length]
                    : rotationUsernames[0];

                assignee = employees.find(emp => matchTaskAssigneeToEmployee(expectedUsername, emp));
            }
            if (!assignee) continue;

            fines.push({
                empId: assignee.id,
                type: 'Thiếu kiểm hàng ngày',
                detail: `Không kiểm hàng ngày ${date.format('DD/MM/YYYY')}`,
                amount: STOCK_CHECK_MISSING_FINE,
                date: date.hour(20).minute(0).second(0).millisecond(0).toISOString(),
                source: 'stock_check_missing' as any,
            });
        }

        return fines;
    }, [employees, isAdmin, stockCheckSessions, stockBalanceRecords, overviewDateRange]);

    const applyFineOverride = useCallback((fine: FineRecord): FineRecord => {
        const override = fineOverrides[getFineOverrideKey(fine)];
        return override ? { ...fine, ...override, source: fine.source } : fine;
    }, [fineOverrides]);

    const allFines = useMemo(
        () => {
            const deletedFineKeys = getDeletedFineKeys(fineAuditLog);
            const persistedVatIds = new Set(extraFines.filter(fine => fine.source === 'purchase_vat_overdue').map(fine => fine.id).filter(Boolean));
            const rows = [...finesData, ...extraFines, ...autoVatOverdueFines.filter(fine => !fine.id || !persistedVatIds.has(fine.id)), ...autoDeadlineOverdueFines, ...autoEvidenceOverdueFines, ...autoStockCheckMissingFines]
                .map(applyFineOverride)
                .filter(f => !getFineRecordKeys(f).some(key => deletedFineKeys.has(key)))
                .filter(f => !f.disabled);
            const vatRows = new Map<string, FineRecord>();
            const result: FineRecord[] = [];
            rows.forEach(fine => {
                const detailText = String(fine.detail || '');
                const isVatFine = fine.source === 'purchase_vat_overdue'
                    || String(fine.type || '').toLocaleLowerCase('vi-VN').includes('vat')
                    || detailText.toLocaleLowerCase('vi-VN').includes('hđ vat');
                if (!isVatFine) {
                    result.push(fine);
                    return;
                }
                const codeMatch = detailText.match(/(?:pn[-\s]*)?(\d{6}\s*-\s*\d{3})/i);
                const vatCode = codeMatch?.[1]?.replace(/\s+/g, '') || detailText.trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
                const key = `${fine.empId}|vat|${vatCode.toLocaleLowerCase('vi-VN')}`;
                const existing = vatRows.get(key);
                // A manually duplicated VAT fine may already exist from the
                // previous implementation. Keep the durable system record.
                if (!existing || (fine.source === 'purchase_vat_overdue' && existing.source !== 'purchase_vat_overdue')) vatRows.set(key, fine);
            });
            result.push(...vatRows.values());
            return result;
        },
        [extraFines, autoVatOverdueFines, autoDeadlineOverdueFines, autoEvidenceOverdueFines, autoStockCheckMissingFines, applyFineOverride]
    );

    // Helper: lọc theo overviewDateRange
    function inOverviewRange(dateStr?: string) {
        if (!dateStr) return true; // record cũ không có date → luôn hiện
        const d = dayjs(dateStr);
        return d.isAfter(overviewDateRange[0].startOf('day').subtract(1, 'ms'))
            && d.isBefore(overviewDateRange[1].endOf('day').add(1, 'ms'));
    }

    const overviewFines = useMemo(() => allFines.filter(f => inOverviewRange(f.date)), [allFines, overviewDateRange]);
    const overviewBonuses = useMemo(() => extraBonuses.filter(b => inOverviewRange(b.date)), [extraBonuses, overviewDateRange]);
    const overviewPackingLogs = useMemo(() => packingOrderLogsData.filter(o => inOverviewRange(o.timestamp)), [packingOrderLogsData, overviewDateRange]);
    const overviewWareHousePacking = useMemo(() => {
        let totalUnits = 0;
        overviewPackingLogs.forEach(order => {
            totalUnits += calcPacksFromItems(order.items);
        });
        return { level1Units: totalUnits, level10Units: 0 };
    }, [overviewPackingLogs]);

    // Kỳ hiện tại có bị khóa không?
    const isCurrentPeriodLocked = useMemo(() =>
        lockedPeriods.some(lp =>
            dayjs(lp.start).isSame(overviewDateRange[0], 'day') &&
            dayjs(lp.end).isSame(overviewDateRange[1], 'day')
        ), [lockedPeriods, overviewDateRange]);
    const overviewAttendanceExpectedKey = `${overviewDateRange[0].year()}-${String(overviewDateRange[0].month() + 1).padStart(2, '0')}`;
    const overviewAttendanceReady = overviewAttendanceLogsKey === overviewAttendanceExpectedKey;

    const payrollData = useMemo(() => calculatePayroll(
        overviewFines, leaveRecords, workSchedules, overviewWareHousePacking, employees, overviewBonuses,
        overviewAttendanceLogs, overviewDateRange[0].month() + 1, overviewDateRange[0].year(), overviewPackingLogs, payrollOverrides, overviewAttendanceReady
    ), [overviewFines, leaveRecords, workSchedules, overviewWareHousePacking, employees, overviewBonuses, overviewAttendanceLogs, overviewDateRange, overviewPackingLogs, payrollOverrides, overviewAttendanceReady]);

    function buildPayrollDataFromPackingLogs(orderLogs: PackingOrderLog[]) {
        const freshOverviewPackingLogs = orderLogs.filter(o => inOverviewRange(o.timestamp));
        const freshTotalUnits = freshOverviewPackingLogs.reduce((sum, order) => sum + calcPacksFromItems(order.items), 0);
        return calculatePayroll(
            overviewFines,
            leaveRecords,
            workSchedules,
            { level1Units: freshTotalUnits, level10Units: 0 },
            employees,
            overviewBonuses,
            overviewAttendanceLogs,
            overviewDateRange[0].month() + 1,
            overviewDateRange[0].year(),
            freshOverviewPackingLogs,
            payrollOverrides,
            overviewAttendanceReady
        );
    }

    const canViewAllPayroll = isAdmin;
    const isCurrentUserPayrollRow = useCallback((row: { username?: string; name?: string }) => {
        if (canViewAllPayroll) return true;
        const rowUsername = normalizeAttendanceText(row.username || '');
        const loginUsername = normalizeAttendanceText(user?.username || currentUser || '');
        const loginFullName = normalizeAttendanceText(user?.fullName || '');
        const rowName = normalizeAttendanceText(row.name || '');

        return Boolean(
            (rowUsername && loginUsername && (
                rowUsername === loginUsername ||
                rowUsername.endsWith(loginUsername) ||
                loginUsername.endsWith(rowUsername)
            )) ||
            (rowName && loginFullName && rowName === loginFullName)
        );
    }, [canViewAllPayroll, currentUser, user?.fullName, user?.username]);
    const privatePayrollData = useMemo(
        () => payrollData.filter(isCurrentUserPayrollRow),
        [payrollData, isCurrentUserPayrollRow]
    );

    // Totals cho Overview
    const totals = useMemo(() => {
        let tSal = 0, tPack = 0, tBonus = 0;
        payrollData.forEach(item => {
            tSal += item.finalSalary;
            tPack += item.packIncome;
            tBonus += item.totalBonus;
        });
        const fundBalance = fundTransactions.reduce((acc, t) => t.type === 'in' ? acc + t.amount : acc - t.amount, 0);
        return { tSal, tPack, tBonus, fundBalance };
    }, [payrollData]);

    // Tự động fetch logs theo tháng được chọn (tab Điểm danh)
    const fetchMonthLogs = async () => {
        try {
            const api = (window as any).electronAPI;
            if (!api?.attendance) return;
            const monthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
            const res = await api.attendance.getLogs({ month: monthStr });
            if (res?.success) setLiveAttendanceLogs(res.data);
        } catch (err) {
            console.error('Lỗi tải logs tháng:', err);
        }
    };

    // Fetch logs cho tháng overview (tab Tổng quát) — tách biệt để không bị mismatch tháng
    const fetchOverviewLogs = async (overviewMonth: number, overviewYear: number) => {
        const monthStr = `${overviewYear}-${String(overviewMonth).padStart(2, '0')}`;
        try {
            const api = (window as any).electronAPI;
            if (!api?.attendance) {
                setOverviewAttendanceLogs([]);
                setOverviewAttendanceLogsKey(monthStr);
                return;
            }
            const res = await api.attendance.getLogs({ month: monthStr });
            setOverviewAttendanceLogs(res?.success ? (res.data || []) : []);
            setOverviewAttendanceLogsKey(monthStr);
        } catch (err) {
            console.error('Lỗi tải logs overview tháng:', err);
        }
    };

    useEffect(() => {
        if (isDbLoaded) fetchMonthLogs();
    }, [selectedYear, selectedMonth, isDbLoaded]);

    useEffect(() => {
        if (isDbLoaded) fetchOverviewLogs(overviewDateRange[0].month() + 1, overviewDateRange[0].year());
    }, [overviewDateRange, isDbLoaded]);

    const daysInMonth = dayjs(`${selectedYear}-${selectedMonth}-01`).daysInMonth();

    const isAttendanceSessionDue = useCallback((date: dayjs.Dayjs, session: LeaveSession) => {
        const today = dayjs();
        if (date.isBefore(today, 'day')) return true;
        if (date.isAfter(today, 'day')) return false;

        const start = session === 'morning' ? config.morningStart : config.afternoonStart;
        const [hour, minute] = start.split(':').map(Number);
        const threshold = hour * 60 + minute + (config.graceMinutes || 0);
        const nowMinutes = today.hour() * 60 + today.minute();
        return nowMinutes >= threshold;
    }, [config.morningStart, config.afternoonStart, config.graceMinutes]);

    // Thay thế array mock thành data mix thật sự
    const liveAttendanceMatrix = useMemo(() => {
        const grace = config.graceMinutes || 0;
        const [amH, amM] = config.morningStart.split(':').map(Number);
        const amThreshold = amH * 60 + amM + grace;
        const [pmH, pmM] = config.afternoonStart.split(':').map(Number);
        const pmThreshold = pmH * 60 + pmM + grace;

        return employees.map(emp => {
            const monthData = Array.from({ length: daysInMonth }).map((_, i) => {
                const currentDay = dayjs(`${selectedYear}-${selectedMonth}-${i + 1}`, 'YYYY-M-D');
                const dateStr = currentDay.format('YYYY-MM-DD');

                // Tìm lịch làm việc (Seasonal)
                const amSchedule = workSchedules.find(s => s.empId === emp.id && s.date === dateStr && s.session === 'morning');
                const pmSchedule = workSchedules.find(s => s.empId === emp.id && s.date === dateStr && s.session === 'afternoon');

                // Tìm lịch nghỉ
                const amLeave = leaveRecords.find(l => l.empId === emp.id && l.date === dateStr && l.session === 'morning');
                const pmLeave = leaveRecords.find(l => l.empId === emp.id && l.date === dateStr && l.session === 'afternoon');

                return {
                    am: 0 as 0 | 1 | 2,
                    pm: 0 as 0 | 1 | 2,
                    amTime: '',
                    pmTime: '',
                    amOutTime: '',
                    pmOutTime: '',
                    amLeave,
                    pmLeave,
                    amSchedule,
                    pmSchedule
                };
            });

            const logs = liveAttendanceLogs.filter(l => {
                const matchedEmployee = findEmployeeForAttendanceLog(l, employees);
                return matchedEmployee?.id === emp.id &&
                    dayjs(l.date).month() + 1 === selectedMonth &&
                    dayjs(l.date).year() === selectedYear;
            });

            logs.forEach(log => {
                const dayIdx = dayjs(log.date).date() - 1;
                if (dayIdx < 0 || dayIdx >= daysInMonth) return;
                const logTime = dayjs(log.timestamp);
                const logMin = logTime.hour() * 60 + logTime.minute();

                if (log.checkType === 'morning_in') {
                    monthData[dayIdx].amTime = logTime.format('HH:mm');
                    monthData[dayIdx].am = logMin > amThreshold ? 2 : 1;
                } else if (log.checkType === 'morning_out') {
                    monthData[dayIdx].amOutTime = logTime.format('HH:mm');
                    if (monthData[dayIdx].am === 0) monthData[dayIdx].am = 1;
                }

                if (log.checkType === 'afternoon_in') {
                    monthData[dayIdx].pmTime = logTime.format('HH:mm');
                    monthData[dayIdx].pm = logMin > pmThreshold ? 2 : 1;
                } else if (log.checkType === 'evening_out') {
                    monthData[dayIdx].pmOutTime = logTime.format('HH:mm');
                    if (monthData[dayIdx].pm === 0) monthData[dayIdx].pm = 1;
                }
            });

            return monthData;
        });
    }, [employees, liveAttendanceLogs, daysInMonth, selectedMonth, selectedYear, config, workSchedules, leaveRecords]);

    // Employee attendance stats
    const employeeStats = useMemo(() => {
        return employees.map((emp, idx) => {
            let lateCount = 0, absentCount = 0, shiftCount = 0;
            if (liveAttendanceMatrix[idx]) {
                liveAttendanceMatrix[idx].forEach((d, dayIdx) => {
                    const currentDay = dayjs(`${selectedYear}-${selectedMonth}-${dayIdx + 1}`, 'YYYY-M-D');
                    const isSunday = currentDay.day() === 0;
                    const isHoliday = !!isPublicHoliday(currentDay);
                    if (d.am === 2) lateCount++;
                    if (d.pm === 2) lateCount++;
                    if (!isSunday && !isHoliday) {
                        if (d.am === 0 && isAttendanceSessionDue(currentDay, 'morning')) absentCount += 0.5;
                        if (d.pm === 0 && isAttendanceSessionDue(currentDay, 'afternoon')) absentCount += 0.5;
                    }
                    if (d.am > 0) shiftCount++;
                    if (d.pm > 0) shiftCount++;
                });
            }
            return { ...emp, lateCount, absentCount, shiftCount };
        });
    }, [employees, liveAttendanceMatrix, selectedMonth, selectedYear, isAttendanceSessionDue]);

    // Fund totals
    const fundTotals = useMemo(() => {
        let income = 0, expense = 0;
        fundTransactions.forEach(t => {
            if (t.type === 'in') income += t.amount;
            else expense += t.amount;
        });
        return { income, expense, balance: income - expense };
    }, []);

    const openConfigModal = () => { setTempConfig({ ...config }); setConfigModalOpen(true); };

    const checkLocked = (): boolean => {
        if (isCurrentPeriodLocked) {
            message.error('Kỳ này đã bị khóa. Cần mở khóa kỳ lương trước khi chỉnh sửa.');
            return true;
        }
        return false;
    };

    // === Thêm/Sửa Thưởng Lẻ handler ===
    const canEditAttendanceDate = useCallback((date: dayjs.Dayjs) => {
        return isAdmin || date.isAfter(dayjs(), 'day');
    }, [isAdmin]);

    const canManageAttendanceEmployee = useCallback((emp: Employee | any) => {
        return isAdmin || (isManager && emp?.type === 'Seasonal');
    }, [isAdmin, isManager]);

    const handleAddBonus = useCallback(() => {
        if (!canManageBonuses) {
            message.error('Bạn không có quyền thêm/sửa thưởng.');
            return;
        }
        if (checkLocked()) return;
        bonusForm.validateFields().then(values => {
            const now = new Date().toLocaleString('vi-VN');
            const isOvertimeBonus = values.bonusKind === 'overtime';
            const bonusType = isOvertimeBonus ? 'Thưởng tăng ca' : 'Thưởng lẻ (Admin)';
            const amount = Math.round(Number(values.amount) || 0);
            const overtimeFields = isOvertimeBonus ? {
                overtimeHours: Number(values.overtimeHours) || 0,
                overtimeRate: OVERTIME_NEXT_HOUR_RATE,
            } : {
                overtimeHours: undefined,
                overtimeRate: undefined,
            };
            if (editingBonus) {
                const before = { ...editingBonus };
                const updated: BonusRecord = { ...editingBonus, empId: values.empId, type: bonusType, detail: values.detail, amount, ...overtimeFields };
                setExtraBonuses(prev => prev.map(b => b.id === editingBonus.id ? updated : b));
                setBonusAuditLog(prev => [...prev, {
                    id: 'log-' + Date.now(),
                    bonusId: editingBonus.id,
                    action: 'edit' as const,
                    timestamp: now,
                    before,
                    after: updated,
                    note: 'Sửa thưởng: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(amount),
                }]);
                message.success('Đã cập nhật thưởng!');
            } else {
                const newId = 'bonus-' + Date.now();
                const newBonus: BonusRecord = { id: newId, empId: values.empId, type: bonusType, detail: values.detail, amount, date: new Date().toISOString(), ...overtimeFields };
                setExtraBonuses(prev => [...prev, newBonus]);
                setBonusAuditLog(prev => [...prev, {
                    id: 'log-' + Date.now(),
                    bonusId: newId,
                    action: 'create' as const,
                    timestamp: now,
                    after: newBonus,
                    note: 'Thêm thưởng: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(amount),
                }]);
                message.success('Đã thêm thưởng!');
            }
            setBonusModalOpen(false);
            setEditingBonus(null);
            bonusForm.resetFields();
        });
    }, [bonusForm, editingBonus, employees, canManageBonuses]);

    const handleDeleteBonus = useCallback((bonus: BonusRecord) => {
        if (!canManageBonuses) {
            message.error('Bạn không có quyền xóa thưởng.');
            return;
        }
        if (checkLocked()) return;
        const now = new Date().toLocaleString('vi-VN');
        setExtraBonuses(prev => prev.filter(b => b.id !== bonus.id));
        setBonusAuditLog(prev => [...prev, {
            id: 'log-' + Date.now(),
            bonusId: bonus.id,
            action: 'delete' as const,
            timestamp: now,
            before: bonus,
            note: 'Xóa thưởng: ' + (employees.find(e => e.id === bonus.empId)?.name || '') + ' — ' + fmt(bonus.amount) + ' — "' + bonus.detail + '"',
        }]);
        message.success('Đã xóa (đã lưu lịch sử)');
    }, [employees, canManageBonuses]);

    // === Thêm/Sửa Phạt handler ===
    const handleAddFine = useCallback(() => {
        if (checkLocked()) return;
        fineForm.validateFields().then(async values => {
            const fineType = Array.isArray(values.type) ? values.type[0] : values.type;
            const nextFine: FineRecord = {
                id: editingFine?.fine?.id || 'fine-manual-' + Date.now(),
                empId: values.empId,
                type: fineType,
                detail: values.detail,
                amount: values.amount,
                date: values.date ? values.date.toISOString() : new Date().toISOString(),
            };
            const now = new Date().toLocaleString('vi-VN');
            let nextExtraFines = extraFines;
            let nextFineOverrides = fineOverrides;
            let nextFineAuditLog = fineAuditLog;

            if (editingFine) {
                let savedFine: FineRecord = nextFine;
                if (editingFine.isManual) {
                    nextExtraFines = extraFines.map((fine, index) => {
                        const sameFine = editingFine.fine.id
                            ? fine.id === editingFine.fine.id
                            : index === editingFine.manualIndex;
                        if (!sameFine) return fine;
                        savedFine = { ...fine, ...nextFine, source: fine.source };
                        return savedFine;
                    });
                    setExtraFines(nextExtraFines);
                } else if (editingFine.overrideKey) {
                    savedFine = {
                        ...editingFine.fine,
                        ...nextFine,
                        source: editingFine.fine.source,
                        disabled: false,
                    };
                    nextFineOverrides = {
                        ...fineOverrides,
                        [editingFine.overrideKey]: savedFine,
                    };
                    setFineOverrides(nextFineOverrides);
                }

                nextFineAuditLog = [...fineAuditLog, {
                    id: 'flog-' + Date.now(),
                    action: 'edit',
                    timestamp: now,
                    changedBy: fineAuditActor.username,
                    changedByName: fineAuditActor.displayName,
                    before: editingFine.fine,
                    after: savedFine,
                    note: 'Sửa khoản phạt: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(values.amount) + ' — "' + values.detail + '"',
                }];
                setFineAuditLog(nextFineAuditLog);
                const saved = await persistAttendanceSnapshotNow({ extraFines: nextExtraFines, fineOverrides: nextFineOverrides, fineAuditLog: nextFineAuditLog });
                if (!saved) {
                    message.error('Chưa lưu được khoản phạt vào DB. Vui lòng thử lại trước khi reload app.');
                    return;
                }

                setEditingFine(null);
                message.success('Đã cập nhật khoản phạt.');
            } else {
                nextExtraFines = [...extraFines, nextFine];
                setExtraFines(nextExtraFines);

                nextFineAuditLog = [...fineAuditLog, {
                    id: 'flog-' + Date.now(),
                    action: 'create',
                    timestamp: now,
                    changedBy: fineAuditActor.username,
                    changedByName: fineAuditActor.displayName,
                    after: nextFine,
                    note: 'Thêm phạt: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(values.amount) + ' — "' + values.detail + '"',
                }];
                setFineAuditLog(nextFineAuditLog);
                const saved = await persistAttendanceSnapshotNow({ extraFines: nextExtraFines, fineAuditLog: nextFineAuditLog });
                if (!saved) {
                    message.error('Chưa lưu được khoản phạt vào DB. Vui lòng thử lại trước khi reload app.');
                    return;
                }

                message.success(`Đã thêm phạt ${fmt(values.amount)} cho ${employees.find(e => e.id === values.empId)?.name} (Đã lưu lịch sử)`);
            }

            setFineModalOpen(false);
            setFineTypeDropdownOpen(false);
            fineForm.resetFields();
        });
    }, [fineForm, employees, fineAuditActor, editingFine, extraFines, fineOverrides, fineAuditLog, persistAttendanceSnapshotNow]);

    // === Xóa Phạt Thủ Công handler ===
    const handleDeleteFine = useCallback((fineIndex: number, fineId?: string) => {
        if (checkLocked()) return;
        const fine = fineId ? extraFines.find(item => item.id === fineId) : extraFines[fineIndex];
        if (!fine) {
            message.error('Không tìm thấy khoản phạt cần xóa. Vui lòng tải lại bảng công.');
            return;
        }
        Modal.confirm({
            title: 'Xác nhận xóa khoản phạt',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa khoản phạt này?</p>
                    <div style={{ padding: '8px 12px', background: '#fff1f0', borderRadius: 8, border: '1px solid #ffccc7' }}>
                        <Text strong>{employees.find(e => e.id === fine.empId)?.name}</Text>
                        <div><Text type="secondary">{fine.type}: {fine.detail} — {fmt(fine.amount)}</Text></div>
                    </div>
                </div>
            ),
            okText: 'Xóa phạt',
            cancelText: 'Hủy',
            okType: 'danger' as const,
            onOk: async () => {
                const now = new Date().toLocaleString('vi-VN');
                const nextExtraFines = fineId
                    ? extraFines.filter(item => item.id !== fineId)
                    : extraFines.filter((_, i) => i !== fineIndex);
                const nextFineAuditLog: FineAuditLog[] = [...fineAuditLog, {
                    id: 'flog-' + Date.now(),
                    action: 'delete',
                    timestamp: now,
                    changedBy: fineAuditActor.username,
                    changedByName: fineAuditActor.displayName,
                    before: fine,
                    note: 'Xóa khoản phạt: ' + (employees.find(e => e.id === fine.empId)?.name || '') + ' — ' + fmt(fine.amount) + ' — "' + fine.detail + '"',
                }];
                setExtraFines(nextExtraFines);
                setFineAuditLog(nextFineAuditLog);
                const saved = await persistAttendanceSnapshotNow({ extraFines: nextExtraFines, fineAuditLog: nextFineAuditLog });
                if (!saved) {
                    message.error('Chưa lưu được thay đổi phạt vào DB. Vui lòng thử lại trước khi reload app.');
                    return;
                }

                message.success('Đã xóa khoản phạt (Đã lưu lịch sử)!');
            },
        });
    }, [extraFines, fineAuditLog, employees, fineAuditActor, persistAttendanceSnapshotNow]);

    const handleEditFineRecord = useCallback((record: any) => {
        if (!isAdmin || checkLocked()) return;
        const fineDate = record.date && dayjs(record.date).isValid() ? dayjs(record.date) : dayjs();
        setEditingFine({
            isManual: !!record.isManual,
            manualIndex: record.manualIndex ?? -1,
            overrideKey: record.overrideKey,
            fine: record,
        });
        fineForm.setFieldsValue({
            date: fineDate,
            empId: record.empId,
            type: record.type ? [record.type] : undefined,
            amount: record.amount,
            detail: record.detail,
        });
        setFineModalOpen(true);
    }, [fineForm, isAdmin]);

    const handleDeleteFineRecord = useCallback((record: any) => {
        if (!isAdmin || checkLocked()) return;
        if (record.isManual) {
            handleDeleteFine(record.manualIndex, record.id);
            return;
        }

        if (!record.overrideKey) return;
        Modal.confirm({
            title: 'Xác nhận xóa khoản phạt hệ thống',
            icon: <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />,
            content: (
                <div>
                    <p>Khoản phạt này được tạo tự động. Khi xóa, hệ thống sẽ ẩn khoản này khỏi Bảng công và lương tháng.</p>
                    <div style={{ padding: '8px 12px', background: '#fff1f0', borderRadius: 8, border: '1px solid #ffccc7' }}>
                        <Text strong>{employees.find(e => e.id === record.empId)?.name}</Text>
                        <div><Text type="secondary">{record.type}: {record.detail} — {fmt(record.amount)}</Text></div>
                    </div>
                </div>
            ),
            okText: 'Xóa phạt',
            cancelText: 'Hủy',
            okType: 'danger' as const,
            onOk: () => {
                const disabledFine: FineRecord = {
                    empId: record.empId,
                    type: record.type,
                    detail: record.detail,
                    amount: record.amount,
                    date: record.date,
                    source: record.source,
                    disabled: true,
                };

                const now = new Date().toLocaleString('vi-VN');
                const nextFineOverrides = { ...fineOverrides, [record.overrideKey]: disabledFine };
                const nextFineAuditLog: FineAuditLog[] = [...fineAuditLog, {
                    id: 'flog-' + Date.now(),
                    action: 'delete',
                    timestamp: now,
                    changedBy: fineAuditActor.username,
                    changedByName: fineAuditActor.displayName,
                    before: record,
                    note: 'Xóa khoản phạt hệ thống: ' + (employees.find(e => e.id === record.empId)?.name || '') + ' — ' + fmt(record.amount) + ' — "' + record.detail + '"',
                }];
                setFineOverrides(nextFineOverrides);
                setFineAuditLog(nextFineAuditLog);
                void persistAttendanceSnapshotNow({ fineOverrides: nextFineOverrides, fineAuditLog: nextFineAuditLog });

                message.success('Đã xóa khoản phạt hệ thống khỏi Bảng công.');
            },
        });
    }, [employees, fineAuditActor, fineAuditLog, fineOverrides, handleDeleteFine, isAdmin, persistAttendanceSnapshotNow]);

    // === Thêm/Sửa Giao dịch Quỹ handler ===
    const handleAddFundTx = useCallback(() => {
        if (checkLocked()) return;
        const activeType = editingFundTx ? editingFundTx.type : fundModalType;
        if (!activeType && !editingFundTx) return;
        if (editingFundTx) {
            if (!canEditFundTx(editingFundTx)) {
                message.warning('Giao dịch này đã quá 1 giờ hoặc không thuộc quyền sửa của bạn. Chỉ admin được phép sửa.');
                return;
            }
        } else if (!canCreateFundTx) {
            message.warning('Bạn không có quyền thêm giao dịch quỹ.');
            return;
        }
        fundForm.validateFields().then(values => {
            const now = new Date();
            const ts = now.toLocaleString('vi-VN');

            if (editingFundTx) {
                // === EDIT MODE ===
                const oldTx = editingFundTx;
                const updatedTx: FundTransaction = {
                    ...oldTx,
                    note: values.note,
                    amount: values.amount,
                    person: values.person,
                    updatedAt: now.toISOString(),
                    updatedBy: user?.username || currentUser || 'System',
                };
                // Ghi audit log
                const changes: string[] = [];
                if (oldTx.note !== values.note) changes.push(`Nội dung: "${oldTx.note}" → "${values.note}"`);
                if (oldTx.amount !== values.amount) changes.push(`Số tiền: ${fmt(oldTx.amount)} → ${fmt(values.amount)}`);
                if (oldTx.person !== values.person) changes.push(`Người TH: "${oldTx.person}" → "${values.person}"`);

                setFundAuditLog(prev => [{
                    timestamp: ts,
                    action: 'edit',
                    txId: oldTx.id,
                    detail: changes.length > 0 ? changes.join(' | ') : 'Không đổi',
                    oldData: { note: oldTx.note, amount: oldTx.amount, person: oldTx.person },
                    newData: { note: values.note, amount: values.amount, person: values.person },
                }, ...prev]);

                // Cập nhật data
                setExtraFundTx(prev => prev.map(t => t.id === oldTx.id ? updatedTx : t));
                setEditingFundTx(null);
                message.success('Đã cập nhật giao dịch + ghi lịch sử!');
            } else {
                // === CREATE MODE ===
                const newId = `f${Date.now()}`;
                const newTx: FundTransaction = {
                    id: newId,
                    date: now.toLocaleDateString('vi-VN'),
                    createdAt: now.toISOString(),
                    createdBy: user?.username || currentUser || 'System',
                    note: values.note,
                    type: activeType!,
                    amount: values.amount,
                    person: values.person,
                };
                setExtraFundTx(prev => [...prev, newTx]);
                setFundAuditLog(prev => [{
                    timestamp: ts,
                    action: 'create',
                    txId: newId,
                    detail: `${activeType === 'in' ? 'Thu' : 'Chi'} ${fmt(values.amount)} — ${values.note}`,
                }, ...prev]);
                setFundModalType(null);
                message.success(`Đã ${activeType === 'in' ? 'thu' : 'chi'} ${fmt(values.amount)} thành công!`);
            }
            fundForm.resetFields();
        });
    }, [canCreateFundTx, canEditFundTx, currentUser, editingFundTx, fundForm, fundModalType, user?.username]);

    // === Xóa Giao dịch Quỹ (có audit) ===
    const handleDeleteFundTx = useCallback((tx: FundTransaction) => {
        if (checkLocked()) return;
        if (!canEditFundTx(tx)) {
            message.warning('Giao dịch này đã quá 1 giờ hoặc không thuộc quyền xóa của bạn. Chỉ admin được phép xóa.');
            return;
        }
        Modal.confirm({
            title: 'Xác nhận xóa giao dịch',
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa giao dịch này?</p>
                    <div style={{ padding: '8px 12px', background: '#fff1f0', borderRadius: 8, border: '1px solid #ffccc7' }}>
                        <Text strong>{tx.note}</Text>
                        <div><Text type="secondary">{tx.type === 'in' ? 'Thu' : 'Chi'}: {fmt(tx.amount)} — {tx.person} ({tx.date})</Text></div>
                    </div>
                    <p style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12, fontStyle: 'italic' }}>
                        ⚠️ Hành động này sẽ được ghi vào Lịch sử thay đổi.
                    </p>
                </div>
            ),
            okText: 'Xóa vĩnh viễn',
            cancelText: 'Hủy',
            okType: 'danger' as const,
            onOk: () => {
                const ts = new Date().toLocaleString('vi-VN');
                setFundAuditLog(prev => [{
                    timestamp: ts,
                    action: 'delete',
                    txId: tx.id,
                    detail: `Đã xóa: ${tx.type === 'in' ? 'Thu' : 'Chi'} ${fmt(tx.amount)} — "${tx.note}" (${tx.person}, ${tx.date})`,
                    oldData: { note: tx.note, amount: tx.amount, person: tx.person, type: tx.type },
                }, ...prev]);
                setExtraFundTx(prev => prev.filter(t => t.id !== tx.id));
                message.success('Xóa thành công + đã ghi lịch sử!');
            },
        });
    }, [canEditFundTx]);

    // === Mở modal sửa ===
    const handleEditFundTx = useCallback((tx: FundTransaction) => {
        if (checkLocked()) return;
        if (!canEditFundTx(tx)) {
            message.warning('Giao dịch này đã quá 1 giờ hoặc không thuộc quyền sửa của bạn. Chỉ admin được phép sửa.');
            return;
        }
        setEditingFundTx(tx);
        fundForm.setFieldsValue({ note: tx.note, amount: tx.amount, person: tx.person });
        setFundModalType(tx.type); // mở modal đúng loại
    }, [canEditFundTx, fundForm]);




    const saveConfig = () => { if (checkLocked()) return; setConfig({ ...tempConfig }); setConfigModalOpen(false); message.success('Đã lưu cấu hình!'); };

    const lockPayroll = () => {
        if (isCurrentPeriodLocked) {
            message.warning('Kỳ này đã được chốt rồi!');
            return;
        }
        const startStr = overviewDateRange[0].format('DD/MM/YYYY');
        const endStr = overviewDateRange[1].format('DD/MM/YYYY');
        Modal.confirm({
            title: 'Xác nhận chốt bảng lương',
            content: (
                <div>
                    <p>Xác nhận chốt và khóa bảng lương kỳ <strong>{startStr} — {endStr}</strong>?</p>
                    <p style={{ color: '#ff4d4f', fontSize: 13 }}>Sau khi chốt, dữ liệu kỳ này sẽ bị khóa. Admin cần mở khóa trước khi chỉnh sửa.</p>
                </div>
            ),
            okText: 'Chốt & Khóa',
            cancelText: 'Hủy',
            okType: 'primary',
            onOk: () => {
                const newLock: LockedPeriod = {
                    id: 'lock-' + Date.now(),
                    start: overviewDateRange[0].startOf('day').toISOString(),
                    end: overviewDateRange[1].endOf('day').toISOString(),
                    lockedAt: new Date().toISOString(),
                    lockedBy: currentUser,
                };
                setLockedPeriods(prev => [...prev, newLock]);
                message.success(`Đã chốt bảng lương kỳ ${startStr} — ${endStr}!`);
            },
        });
    };

    // ============================================
    // TAB 1: TỔNG QUÁT
    // ============================================
    const renderOverview = () => {
        const totalBaseSalary = privatePayrollData.reduce((sum, item) => sum + (item.salaryBase || 0), 0);
        const totalPackIncome = privatePayrollData.reduce((sum, item) => sum + (item.packIncome || 0), 0);
        const totalBonus = privatePayrollData.reduce((sum, item) => sum + (item.totalBonus || 0), 0);
        const totalFines = privatePayrollData.reduce((sum, item) => sum + (item.myFines || 0), 0);
        const totalLeaveDeduction = privatePayrollData.reduce((sum, item) => sum + (item.leaveDeduction || 0), 0);
        const totalFinalSalary = privatePayrollData.reduce((sum, item) => sum + (item.finalSalary || 0), 0);

        return (
        <div className="att-table-card">
            <Table
                dataSource={privatePayrollData.map(d => ({ ...d, key: d.id }))}
                pagination={false}
                size="middle"
                scroll={{ x: 1180 }}
                summary={() => (
                    <Table.Summary fixed>
                        <Table.Summary.Row className="att-overview-total-row">
                            <Table.Summary.Cell index={0} colSpan={2} className="att-overview-total-label-cell">
                                <span className="att-overview-total-label">
                                    Tổng cộng
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right" className="att-overview-total-cell">
                                <span className="att-overview-total-value-base">
                                    {fmt(totalBaseSalary)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="right" className="att-overview-total-cell">
                                <span className="att-overview-total-value-pack">
                                    + {fmt(totalPackIncome)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right" className="att-overview-total-cell">
                                <span className="att-overview-total-value-bonus">
                                    + {fmt(totalBonus)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={5} align="right" className="att-overview-total-cell">
                                <span className="att-overview-total-value-fine">
                                    {totalFines > 0 ? `- ${fmt(totalFines)}` : fmt(0)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={6} align="right" className="att-overview-total-cell-final">
                                <span className="att-overview-total-value-fine">
                                    {totalLeaveDeduction > 0 ? `- ${fmt(totalLeaveDeduction)}` : fmt(0)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={7} align="right" className="att-overview-total-cell-final">
                                <span className="att-overview-total-money">
                                    {fmt(totalFinalSalary)}
                                </span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={8} className="att-overview-total-action-cell" />
                        </Table.Summary.Row>
                    </Table.Summary>
                )}
                columns={[
                    {
                        title: 'Nhân viên', dataIndex: 'name', key: 'name', width: 200, fixed: 'left' as const,
                        render: (name: string) => {
                            const initial = name.split(' ').pop()?.charAt(0) || '';
                            return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div className="att-avatar">{initial}</div>
                                    <span className="att-emp-name">{name}</span>
                                </div>
                            );
                        },
                    },
                    {
                        title: 'Loại', dataIndex: 'type', key: 'type', width: 100, align: 'center' as const,
                        render: (t: string) => (
                            <span className={t === 'Official' ? 'att-tag-green' : 'att-tag-orange'}>
                                {t === 'Official' ? 'CHÍNH THỨC' : 'THỜI VỤ'}
                            </span>
                        ),
                    },
                    {
                        title: 'Lương cơ bản', dataIndex: 'salaryBase', key: 'base', align: 'right' as const, width: 150,
                        render: (v: number) => (
                            <span className="att-money-gray">{fmt(v)}</span>
                        ),
                    },
                    {
                        title: 'Thưởng đóng gói', dataIndex: 'packIncome', key: 'pack', align: 'right' as const, width: 160,
                        render: (v: number, r: any) => <Tooltip title={`${r.packTotalUnits || 0} SP × ${PACKING_UNIT_PRICE}đ`}><span className="att-money-emerald">+ {fmt(v)}</span></Tooltip>,
                    },
                    {
                        title: 'Thưởng', dataIndex: 'totalBonus', key: 'bonus', align: 'right' as const, width: 120,
                        render: (v: number) => <span className="att-money-emerald">+ {fmt(v)}</span>,
                    },
                    {
                        title: 'Phạt', dataIndex: 'myFines', key: 'fine', align: 'right' as const, width: 120,
                        render: (v: number) => <span className="att-money-red">{v > 0 ? `- ${fmt(v)}` : `${fmt(0)}`}</span>,
                    },
                    {
                        title: 'Nghỉ', dataIndex: 'leaveDeduction', key: 'leaveDeduction', align: 'right' as const, width: 120,
                        render: (v: number, r: any) => (
                            <Tooltip title={r.absentDays > 0 ? `${r.absentDays} ngày/ca nghỉ đã tính` : 'Không có khoản trừ nghỉ'}>
                                <span className="att-money-red">{v > 0 ? `- ${fmt(v)}` : `${fmt(0)}`}</span>
                            </Tooltip>
                        ),
                    },
                    {
                        title: 'Tổng lương', dataIndex: 'finalSalary', key: 'final', align: 'right' as const, width: 150,
                        render: (v: number) => <span className="att-money-final">{fmt(v)}</span>,
                    },
                    {
                        title: 'Chi tiết', key: 'detail', align: 'center' as const, width: 130, fixed: 'right' as const,
                        render: (_: any, record: any) => (
                            <Button size="small" icon={<EyeOutlined />} onClick={() => { setPayslipPdfDetailOpen(false); setPayslipModal(record); }}>
                                Xem chi tiết
                            </Button>
                        ),
                    },
                ]}
            />
        </div>
        );
    };

    // ============================================
    // TAB 2: ĐÓNG GÓI (TEAM)
    // ============================================
    const renderPackaging = () => {
        const unitPrice = PACKING_UNIT_PRICE; // 20đ/SP

        const orderLogs = overviewPackingLogs;

        // Tính tổng số lượng SP (theo SKU cha) từ tất cả đơn
        let filteredTotalSP = 0;
        orderLogs.forEach(order => {
            filteredTotalSP += calcPacksFromItems(order.items);
        });
        const filteredPackValue = filteredTotalSP * unitPrice;
        const filteredTotalUnits = orderLogs.length; // Tổng đơn hàng

        const totalOrders = orderLogs.length;
        const totalPackedSKU = orderLogs.reduce((s, o) => s + o.totalSKU, 0);
        const issueCount = orderLogs.filter(o => o.status === 'issue').length;
        const uniquePackers = [...new Set(orderLogs.map(o => o.packer))].length;

        const platformColor: Record<string, string> = {
            Shopee: '#ee4d2d', TikTok: '#000000', POS: '#1890ff', Web: '#722ed1', 'Khác': '#8c8c8c',
        };
        const platformIcon: Record<string, string> = {
            Shopee: '🛒', TikTok: '🎵', POS: '💰', Web: '🌐', 'Khác': '📋',
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{overviewDateRange[0].format('DD/MM/YYYY')} — {overviewDateRange[1].format('DD/MM/YYYY')}</Text>
                    <Button size="small" icon={<SyncOutlined />} onClick={() => loadPackingOrders(overviewDateRange[0].startOf('day').toISOString())}>Tải lại</Button>
                </div>

                {/* Stats + Chart Header */}
                {(() => {
                    const CHART_COLORS = ['#00ab56', '#1890ff', '#fa8c16', '#722ed1', '#10b981', '#f5222d', '#13c2c2'];
                    const chartData = [...payrollData]
                        .filter((d: any) => (d.packOrderCount || 0) > 0)
                        .sort((a: any, b: any) => (b.packOrderCount || 0) - (a.packOrderCount || 0))
                        .map((d: any) => ({ name: d.name, value: d.packOrderCount || 0, income: d.packIncome || 0 }));
                    return (
                        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                            {/* Title bar */}
                            <div style={{ padding: '10px 20px', background: '#f6ffed', borderBottom: '1px solid #d9f7be', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#389e0d', textTransform: 'uppercase', letterSpacing: 0.5 }}>📦 Lương đóng gói</span>
                                <span style={{ fontSize: 12, color: '#8c8c8c' }}>{overviewDateRange[0].format('DD/MM')} — {overviewDateRange[1].format('DD/MM/YYYY')}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 420px' }}>
                                {/* Left: Stats */}
                                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    {/* Quỹ thưởng - số to */}
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Tổng quỹ thưởng</div>
                                        <div style={{ fontSize: 36, fontWeight: 900, color: '#00ab56', lineHeight: 1 }}>{fmt(filteredPackValue)}</div>
                                        <div style={{ fontSize: 12, color: '#52c41a', marginTop: 3 }}>{filteredTotalSP.toLocaleString()} SP × {unitPrice.toLocaleString()}đ/SP</div>
                                    </div>
                                    <Divider style={{ margin: '0' }} />
                                    {/* 4 stats nhỏ */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tổng đơn</div>
                                            <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981' }}>{totalOrders.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 500, color: '#aaa', marginLeft: 4 }}>đơn</span></div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tổng sản phẩm</div>
                                            <div style={{ fontSize: 22, fontWeight: 900, color: '#1890ff' }}>{filteredTotalSP.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 500, color: '#aaa', marginLeft: 4 }}>SP</span></div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.4 }}>Đơn giá</div>
                                            <div style={{ fontSize: 22, fontWeight: 900, color: '#722ed1' }}>{unitPrice.toLocaleString()}<span style={{ fontSize: 12, fontWeight: 500, color: '#aaa', marginLeft: 4 }}>đ/SP</span></div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.4 }}>Nhân sự</div>
                                            <div style={{ fontSize: 22, fontWeight: 900, color: '#fa8c16' }}>{uniquePackers}<span style={{ fontSize: 12, fontWeight: 500, color: '#aaa', marginLeft: 4 }}>người</span></div>
                                        </div>
                                    </div>
                                </div>
                                {/* Divider */}
                                <div style={{ background: '#f0f0f0' }} />
                                {/* Right: Donut Chart */}
                                <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.5 }}>Phân bổ đóng gói</div>
                                    {chartData.length > 0 ? (<>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <PieChart>
                                                <Pie
                                                    data={chartData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={58}
                                                    outerRadius={90}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                >
                                                    {chartData.map((_: any, i: number) => (
                                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <ReTooltip
                                                    formatter={(value: any, name: any, props: any) => [
                                                        <span><b>{value} đơn</b> — {fmt(props.payload.income)}</span>, name
                                                    ]}
                                                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        {/* Custom legend bên dưới */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 4 }}>
                                            {chartData.map((entry: any, i: number) => {
                                                const pct = totalOrders > 0 ? Math.round(entry.value / totalOrders * 100) : 0;
                                                return (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                                                        <span style={{ fontSize: 12, color: '#595959', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                                                        <span style={{ fontSize: 12, fontWeight: 700, color: CHART_COLORS[i % CHART_COLORS.length] }}>{entry.value} đơn</span>
                                                        <span style={{ fontSize: 11, color: '#aaa', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>) : (
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d9d9d9', fontSize: 13 }}>Chưa có dữ liệu</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* Distribution Table */}
                <Card
                    bodyStyle={{ padding: 0 }}
                    style={{ borderTop: '3px solid #00ab56' }}
                    title={<Space><TeamOutlined style={{ color: '#00ab56' }} /><Text strong>Bảng xếp hạng đóng gói</Text></Space>}
                >
                    <Table
                        dataSource={[...payrollData]
                            .sort((a, b) => (b.packOrderCount || 0) - (a.packOrderCount || 0))
                            .map((d, index) => ({ ...d, key: d.id, _rank: index + 1 }))}
                        pagination={false}
                        size="middle"
                        rowClassName={(record: any) => record._rank <= 3 && record.packOrderCount > 0 ? `rank-${record._rank}-row` : ''}
                        columns={[
                            {
                                title: 'Hạng', dataIndex: '_rank', key: 'rank', width: 90, align: 'center' as const,
                                render: (r: number, record: any) => {
                                    if (record.packOrderCount === 0) return <div style={{ color: '#bfbfbf', fontWeight: 'bold' }}>-</div>;
                                    if (r === 1) return <Tag color="gold" style={{ margin: 0, fontWeight: 900, fontSize: 13, border: 'none', background: 'linear-gradient(135deg, #fadb14, #d48806)', color: 'white', padding: '2px 8px', borderRadius: 4, boxShadow: '0 2px 5px rgba(250, 173, 20, 0.4)' }}>TOP 1 🥇</Tag>;
                                    if (r === 2) return <Tag color="default" style={{ margin: 0, fontWeight: 900, fontSize: 13, border: 'none', background: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', color: '#0f172a', padding: '2px 8px', borderRadius: 4, boxShadow: '0 2px 5px rgba(148, 163, 184, 0.4)' }}>TOP 2 🥈</Tag>;
                                    if (r === 3) return <Tag color="orange" style={{ margin: 0, fontWeight: 900, fontSize: 13, border: 'none', background: 'linear-gradient(135deg, #ffbb96, #d4380d)', color: 'white', padding: '2px 8px', borderRadius: 4, boxShadow: '0 2px 5px rgba(250, 84, 28, 0.4)' }}>TOP 3 🥉</Tag>;
                                    return <Tag style={{ margin: 0, fontWeight: 700, fontSize: 12, border: '1px solid #d9d9d9', color: '#8c8c8c', background: '#fafafa', borderRadius: 4 }}>TOP {r}</Tag>;
                                }
                            },
                            {
                                title: 'Nhân viên', dataIndex: 'name', key: 'name', render: (n: string, r: any) => (
                                    <div>
                                        <Text strong style={{ color: r._rank <= 3 && r.packOrderCount > 0 ? '#000' : '#595959', fontSize: r._rank <= 3 && r.packOrderCount > 0 ? 15 : 14 }}>{n}</Text>
                                        <div><Tag color={r._rank <= 3 && r.packOrderCount > 0 ? "blue" : "default"} style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, border: 'none', background: r._rank <= 3 && r.packOrderCount > 0 ? '#e6f7ff' : '#f5f5f5' }}>@{r.username || '—'}</Tag></div>
                                    </div>
                                )
                            },
                            { title: 'Loại HĐ', dataIndex: 'type', key: 'type', width: 120, render: (t: string) => <Tag color={t === 'Official' ? 'green' : 'orange'} style={{ border: 'none' }}>{t === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag> },
                            {
                                title: <Text strong style={{ color: '#1890ff' }}>SL đóng gói</Text>,
                                dataIndex: 'packOrderCount', key: 'packCount', width: 140, align: 'center' as const,
                                render: (count: number, r: any) => (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                        <span style={{ fontSize: r._rank <= 3 && count > 0 ? 24 : 18, fontWeight: 900, color: count > 0 ? '#1890ff' : '#d9d9d9' }}>{count || 0}</span>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: count > 0 ? '#91caff' : '#d9d9d9', textTransform: 'uppercase' }}>đơn</span>
                                    </div>
                                ),
                            },
                            {
                                title: <Text strong style={{ color: '#722ed1' }}>Tỷ lệ %</Text>,
                                key: 'percentage',
                                width: 110,
                                align: 'center' as const,
                                render: (_: any, r: any) => {
                                    const totalPackCount = payrollData.reduce((s, d) => s + (d.packOrderCount || 0), 0);
                                    const pct = totalPackCount > 0 ? ((r.packOrderCount || 0) / totalPackCount * 100).toFixed(1) : '0.0';
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                            <span style={{
                                                fontSize: r._rank <= 3 && r.packOrderCount > 0 ? 17 : 14,
                                                fontWeight: 900,
                                                color: r.packOrderCount > 0 ? '#722ed1' : '#d9d9d9'
                                            }}>
                                                {pct}%
                                            </span>
                                            {r.packOrderCount > 0 && (
                                                <div style={{
                                                    width: 48,
                                                    height: 4,
                                                    background: '#f3f4f6',
                                                    borderRadius: 2,
                                                    overflow: 'hidden'
                                                }}>
                                                    <div style={{
                                                        width: `${pct}%`,
                                                        height: '100%',
                                                        background: 'linear-gradient(to right, #b7eb8f, #722ed1)',
                                                        borderRadius: 2
                                                    }} />
                                                </div>
                                            )}
                                        </div>
                                    );
                                }
                            },
                            { title: <Text strong style={{ color: '#00ab56', fontStyle: 'italic' }}>Thu nhập cá nhân</Text>, dataIndex: 'packIncome', key: 'income', align: 'right' as const, render: (v: number, r: any) => <Text strong style={{ color: v > 0 ? '#00ab56' : '#d9d9d9', fontStyle: 'italic', fontSize: r._rank <= 3 && r.packOrderCount > 0 ? 18 : 16 }}>{fmt(v || 0)}</Text> },
                        ]}
                        summary={() => {
                            const totalPackCount = payrollData.reduce((s, d) => s + (d.packOrderCount || 0), 0);
                            const totalIncome = payrollData.reduce((s, d) => s + (d.packIncome || 0), 0);
                            return (
                                <Table.Summary.Row style={{ background: '#f0fdf4' }}>
                                    <Table.Summary.Cell index={0} colSpan={3}><Text strong style={{ color: '#15803d', fontSize: 12, paddingLeft: 16 }}>TỔNG CỘNG</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={3} align="center"><Text strong style={{ color: '#1890ff', fontSize: 18 }}>{totalPackCount} đơn</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={4} align="center"><Text strong style={{ color: '#722ed1', fontSize: 16 }}>100.0%</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={5} align="right"><Text strong style={{ color: '#00ab56', fontSize: 18 }}>{fmt(totalIncome)}</Text></Table.Summary.Cell>
                                </Table.Summary.Row>
                            );
                        }}
                    />
                </Card>

                {/* Chi tiết đơn hàng - Expandable Table */}
                <Card
                    title={
                        <Space>
                            <FileTextOutlined style={{ color: '#1890ff' }} />
                            <Text strong>Nhật ký đóng gói theo đơn hàng</Text>
                            <Tag color="blue" style={{ fontSize: 10, fontWeight: 600 }}>{totalOrders} đơn</Tag>
                        </Space>
                    }
                    bodyStyle={{ padding: 0 }}
                    style={{ borderTop: '3px solid #1890ff' }}
                >
                    <Table
                        dataSource={orderLogs.map(o => ({ ...o, key: o.id }))}
                        pagination={orderLogs.length > 8 ? { pageSize: 8, size: 'small' } : false}
                        size="small"
                        scroll={{ x: 900 }}
                        expandable={{
                            expandedRowRender: (record: PackingOrderLog) => (
                                <div style={{ padding: '8px 16px', background: '#f8fafc' }}>
                                    {/* Banner đơn hàng */}
                                    <div style={{
                                        display: 'flex', gap: 24, fontSize: 12, color: '#64748b', marginBottom: 8,
                                        padding: '8px 12px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0',
                                    }}>
                                        <span><strong>Đơn:</strong> <span style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 700 }}>{record.orderNumber}</span></span>
                                        <span><strong>Sàn:</strong> <span style={{ color: platformColor[record.platform] }}>{platformIcon[record.platform]} {record.platform}</span></span>
                                        <span><strong>Khách:</strong> {record.customerName}</span>
                                        <span><strong>Người đóng:</strong> <span style={{ color: '#1890ff' }}>👤 {record.packer}</span></span>
                                        <span><strong>Tổng:</strong> <b style={{ color: '#00ab56' }}>{record.totalSKU} SKU</b></span>
                                    </div>
                                    {/* Items table */}
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                        <thead>
                                            <tr style={{ background: '#e2e8f0' }}>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#475569' }}>SKU</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, fontSize: 11, color: '#475569' }}>Sản phẩm</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: '#475569' }}>Phân loại</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: '#475569' }}>SL đóng</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {record.items.map((item, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                                    <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>
                                                        📌 {item.sku}
                                                    </td>
                                                    <td style={{ padding: '5px 10px', fontWeight: 500, color: '#374151' }}>{item.productName}</td>
                                                    <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                                                        {item.variant ? <Tag color="cyan" style={{ fontSize: 10 }}>{item.variant}</Tag> : '—'}
                                                    </td>
                                                    <td style={{ padding: '5px 10px', textAlign: 'center', fontWeight: 800, color: '#0f172a', fontSize: 14 }}>{item.quantity}</td>
                                                </tr>
                                            ))}
                                            <tr style={{ background: '#f0fdf4', fontWeight: 700, borderTop: '2px solid #86efac' }}>
                                                <td colSpan={3} style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#15803d' }}>TỔNG ĐƠN:</td>
                                                <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: 14, color: '#15803d' }}>{record.totalSKU} SKU</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    {record.note && (
                                        <div style={{ marginTop: 8, padding: '6px 10px', background: record.status === 'issue' ? '#fff1f0' : '#fffbe6', borderRadius: 4, border: `1px solid ${record.status === 'issue' ? '#ffccc7' : '#ffe58f'}`, fontSize: 11, color: record.status === 'issue' ? '#cf1322' : '#d48806' }}>
                                            {record.status === 'issue' ? '⚠️' : '📝'} {record.note}
                                        </div>
                                    )}
                                </div>
                            ),
                            expandIcon: () => null,
                            showExpandColumn: false,
                            expandedRowKeys: expandedPackingKeys,
                            onExpandedRowsChange: (keys) => setExpandedPackingKeys(keys as string[]),
                        }}
                        onRow={(record) => ({
                            onClick: () => {
                                const key = record.id;
                                setExpandedPackingKeys(prev =>
                                    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                                );
                            },
                            style: { cursor: 'pointer' },
                        })}
                        columns={[
                            {
                                title: 'Thời gian', dataIndex: 'timestamp', key: 'ts', width: 140,
                                render: (ts: string) => {
                                    const dt = dayjs(ts);
                                    if (!ts || !dt.isValid()) return <Text type="secondary">—</Text>;
                                    return (
                                        <div>
                                            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>{dt.format('DD/MM')}</Text>
                                            <div style={{ fontSize: 10, color: '#bfbfbf' }}>{dt.format('HH:mm')}</div>
                                        </div>
                                    );
                                },
                            },
                            {
                                title: 'Mã đơn hàng', dataIndex: 'orderNumber', key: 'order', width: 160,
                                render: (o: string) => <Text strong style={{ fontFamily: 'monospace', color: '#1890ff', fontSize: 12 }}>{o}</Text>,
                            },
                            {
                                title: 'Sàn', dataIndex: 'platform', key: 'platform', width: 100, align: 'center' as const,
                                render: (p: string) => (
                                    <Tag style={{ fontWeight: 700, fontSize: 10, color: platformColor[p], borderColor: platformColor[p], background: 'transparent' }}>
                                        {platformIcon[p]} {p}
                                    </Tag>
                                ),
                            },
                            {
                                title: 'Khách hàng', dataIndex: 'customerName', key: 'cust', width: 140,
                                render: (c: string) => <Text style={{ fontSize: 12 }}>{c}</Text>,
                            },
                            {
                                title: 'Người đóng', dataIndex: 'packer', key: 'packer', width: 150,
                                render: (p: string) => (
                                    <Space size={4}>
                                        <UserOutlined style={{ fontSize: 11, color: '#1890ff' }} />
                                        <Text strong style={{ fontSize: 12 }}>{p}</Text>
                                    </Space>
                                ),
                            },
                            {
                                title: 'GHI NHẬN LƯƠNG', key: 'sku', width: 160, align: 'right' as const,
                                render: (_: any, r: PackingOrderLog) => {
                                    const totalPacks = calcPacksFromItems(r.items);
                                    const totalMoney = totalPacks * unitPrice;
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                                            <Tag color="blue" style={{ margin: 0, fontWeight: 700, fontSize: 10 }}>{totalPacks} SP × {unitPrice}đ</Tag>
                                            <Text style={{ fontSize: 11, fontWeight: 800, color: '#00ab56', marginTop: 2 }}>+{totalMoney.toLocaleString('vi-VN')} đ</Text>
                                        </div>
                                    );
                                },
                            },
                            {
                                title: 'TT', dataIndex: 'status', key: 'status', width: 60, align: 'center' as const,
                                render: (s: string) => (
                                    s === 'completed'
                                        ? <Tooltip title="Hoàn thành"><CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} /></Tooltip>
                                        : <Tooltip title="Đóng sai / Thiếu"><WarningOutlined style={{ color: '#ff4d4f', fontSize: 16 }} /></Tooltip>
                                ),
                            },
                        ]}
                    />
                </Card>

            </div>
        );
    };

    // ============================================
    // TAB 3: THƯỞNG
    // ============================================
    const renderBonuses = () => {
        const auditColorMap: Record<string, string> = { create: 'green', edit: 'blue', delete: 'red' };
        const auditLabelMap: Record<string, string> = { create: 'Thêm', edit: 'Sửa', delete: 'Xóa' };

        const visibleBonusAuditLog = canViewAllPayroll
            ? bonusAuditLog
            : bonusAuditLog.filter(log => {
                const empId = log.after?.empId ?? log.before?.empId;
                return empId !== undefined && privatePayrollData.some(emp => emp.id === empId);
            });

        const bonusTabsItems = privatePayrollData.map(emp => {
            const empBonusRows: any[] = [];
            overviewBonuses.filter(b => b.empId === emp.id).forEach((b) => {
                empBonusRows.push({ key: `bonus-${b.id}`, name: emp.name, source: b.type, sourceColor: 'blue', detail: b.detail, amount: b.amount, isManual: true, bonusRef: b });
            });

            const totalEmpBonus = empBonusRows.reduce((sum, r) => sum + r.amount, 0);

            return {
                key: String(emp.id),
                label: (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 'max-content' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#1f2937', whiteSpace: 'nowrap' }}>{emp.name}</span>
                        <div style={{
                            background: 'linear-gradient(to right, #1890ff, #36cfc9)',
                            padding: '2px 12px',
                            borderRadius: 12,
                            boxShadow: '0 2px 6px rgba(24,144,255,0.2)'
                        }}>
                            <span style={{ fontSize: 12, color: '#fff', fontWeight: 800, whiteSpace: 'nowrap' }}>+{fmt(totalEmpBonus)}</span>
                        </div>
                    </div>
                ),
                children: (
                    <div style={{ padding: '0' }}>
                        <div style={{
                            background: '#fff',
                            padding: '16px',
                            borderRadius: '0 0 16px 16px'
                        }}>
                            <Table
                                dataSource={empBonusRows}
                                pagination={false}
                                size="middle"
                                style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}
                                columns={[
                                    { title: 'Nguồn tiền', dataIndex: 'source', key: 'src', width: 160, render: (s: string, r: any) => <Tag color={s === 'Thưởng tăng ca' ? 'orange' : r.sourceColor} style={{ fontWeight: 800, fontSize: 11, textTransform: 'uppercase', padding: '2px 8px' }}>{s}</Tag> },
                                    { title: 'Nội dung', dataIndex: 'detail', key: 'detail', render: (d: string) => <Text style={{ fontStyle: 'italic', color: '#4b5563' }}>{d}</Text> },
                                    { title: <Text style={{ color: '#1890ff', fontWeight: 700 }}>SỐ TIỀN NHẬN</Text>, dataIndex: 'amount', key: 'amount', width: 160, align: 'right' as const, render: (v: number) => <Text strong style={{ color: '#1890ff', fontSize: 15 }}>+ {fmt(v)}</Text> },
                                    {
                                        title: '', key: 'actions', width: 100, align: 'center' as const,
                                        render: (_: any, r: any) => (r.isManual && canManageBonuses && !isCurrentPeriodLocked) ? (
                                            <Space size={8}>
                                                <Tooltip title="Sửa">
                                                    <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => {
                                                        setEditingBonus(r.bonusRef);
                                                        bonusForm.setFieldsValue({
                                                            empId: r.bonusRef.empId,
                                                            bonusKind: r.bonusRef.type === 'Thưởng tăng ca' ? 'overtime' : 'manual',
                                                            amount: r.bonusRef.amount,
                                                            overtimeHours: r.bonusRef.overtimeHours,
                                                            detail: r.bonusRef.detail
                                                        });
                                                        setBonusModalOpen(true);
                                                    }} />
                                                </Tooltip>
                                                <Tooltip title="Xóa">
                                                    <Button size="small" type="primary" danger ghost icon={<DeleteOutlined />} onClick={() => {
                                                        Modal.confirm({
                                                            title: 'Xóa khoản thưởng?',
                                                            content: 'Thao tác sẽ được ghi vào lịch sử dù đã xóa.',
                                                            okText: 'Xóa', okType: 'danger', cancelText: 'Hủy',
                                                            onOk: () => handleDeleteBonus(r.bonusRef),
                                                        });
                                                    }} />
                                                </Tooltip>
                                            </Space>
                                        ) : null,
                                    },
                                ]}
                            />
                        </div>
                    </div>
                )
            };
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'linear-gradient(135deg, #1890ff 0%, #36cfc9 100%)', width: 8, height: 24, borderRadius: 4 }} />
                        <Title level={4} style={{ margin: 0, color: '#1f2937' }}>Phân bổ Thưởng & Chia phạt</Title>
                    </div>
                    {canManageBonuses && !isCurrentPeriodLocked && <Button type="primary" icon={<PlusOutlined />} style={{ fontWeight: 700, borderRadius: 8, height: 38, background: 'linear-gradient(to right, #1890ff, #36cfc9)', border: 'none', boxShadow: '0 4px 10px rgba(24,144,255,0.3)' }} onClick={() => { setEditingBonus(null); bonusForm.resetFields(); bonusForm.setFieldsValue({ bonusKind: 'manual' }); setBonusModalOpen(true); }}>Thêm thưởng thủ công</Button>}
                </div>
                <Card
                    bodyStyle={{ padding: 0 }}
                    style={{
                        border: 'none',
                        borderRadius: 16,
                        overflow: 'hidden',
                        boxShadow: '0 4px 24px rgba(24, 144, 255, 0.12)'
                    }}
                >
                    <div style={{
                        background: 'linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)',
                        padding: '16px 16px 0',
                        borderBottom: '1px solid #bae0ff'
                    }}>
                        <Tabs
                            defaultActiveKey={privatePayrollData[0] ? String(privatePayrollData[0].id) : "1"}
                            items={bonusTabsItems}
                            type="line"
                            tabBarStyle={{ margin: 0, border: 'none' }}
                            animated={{ inkBar: true, tabPane: true }}
                        />
                    </div>
                </Card>
                {visibleBonusAuditLog.length > 0 && (
                    <Card
                        bodyStyle={{ padding: 0 }}
                        style={{ borderTop: '3px solid #faad14' }}
                        title={<Space><HistoryOutlined style={{ color: '#faad14' }} /><Text strong>Lịch sử chỉnh sửa thưởng</Text><Tag color="gold">{visibleBonusAuditLog.length} thao tác</Tag></Space>}
                    >
                        <Table
                            dataSource={[...visibleBonusAuditLog].reverse().map(l => ({ ...l, key: l.id }))}
                            pagination={visibleBonusAuditLog.length > 5 ? { pageSize: 5, size: 'small' } : false}
                            size="small"
                            columns={[
                                { title: 'Thời gian', dataIndex: 'timestamp', key: 'ts', width: 150, render: (t: string) => <Text type="secondary" style={{ fontSize: 11 }}>{t}</Text> },
                                {
                                    title: 'Người thay đổi',
                                    key: 'changedBy',
                                    width: 150,
                                    render: (_: unknown, record: FineAuditLog) => (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            <Text strong style={{ fontSize: 12 }}>{record.changedByName || record.changedBy || 'Chưa ghi nhận'}</Text>
                                            {record.changedByName && record.changedBy && record.changedByName !== record.changedBy && (
                                                <Text type="secondary" style={{ fontSize: 11 }}>{record.changedBy}</Text>
                                            )}
                                        </div>
                                    ),
                                },
                                { title: 'Thao tác', dataIndex: 'action', key: 'action', width: 70, render: (a: string) => <Tag color={auditColorMap[a]} style={{ fontWeight: 700, fontSize: 10 }}>{auditLabelMap[a]}</Tag> },
                                { title: 'Nội dung', dataIndex: 'note', key: 'note', render: (n: string) => <Text style={{ fontSize: 12 }}>{n}</Text> },
                                {
                                    title: 'Thay đổi', key: 'diff', width: 220,
                                    render: (_: any, r: BonusAuditLog) => r.action === 'edit' && r.before && r.after ? (
                                        <div style={{ fontSize: 11 }}>
                                            {r.before.amount !== r.after.amount && <div><Text delete type="secondary">{fmt(r.before.amount!)}</Text>{' → '}<Text strong style={{ color: '#1890ff' }}>{fmt(r.after.amount!)}</Text></div>}
                                            {r.before.detail !== r.after.detail && <div style={{ color: '#888', fontStyle: 'italic' }}>"{r.before.detail}" → "{r.after.detail}"</div>}
                                        </div>
                                    ) : null,
                                },
                            ]}
                        />
                    </Card>
                )}
            </div>
        );
    };

    // ============================================
    // TAB 4: PHẠT
    // ============================================
    const renderFines = () => {
        // Gộp phạt gốc + phạt thủ công, đánh dấu nguồn
        const systemFineRow = (fine: FineRecord, key: string) => {
            const overrideKey = getFineOverrideKey(fine);
            const overridden = applyFineOverride(fine);
            if (overridden.disabled) return null;
            return {
                ...overridden,
                key,
                empName: employees.find(e => e.id === overridden.empId)?.name,
                isManual: false,
                manualIndex: -1,
                overrideKey,
                source: overridden.source,
            };
        };
        const combinedFinesRaw = [
            ...finesData
                .filter(f => inOverviewRange(f.date))
                .map((f, i) => systemFineRow(f, `base-${i}`))
                .filter(Boolean),
            ...extraFines
                .map((f, i) => ({ fine: f, manualIndex: i }))
                .filter(({ fine }) => inOverviewRange(fine.date))
                .map(({ fine, manualIndex }) => ({ ...fine, key: fine.id || `manual-${manualIndex}`, empName: employees.find(e => e.id === fine.empId)?.name, isManual: true, manualIndex, source: fine.source })),
            ...autoVatOverdueFines
                .filter(f => inOverviewRange(f.date))
                .map((f, i) => systemFineRow(f, `vat-${i}`))
                .filter(Boolean),
            ...autoDeadlineOverdueFines
                .filter(f => inOverviewRange(f.date))
                .map((f, i) => systemFineRow(f, `deadline-${i}`))
                .filter(Boolean),
            ...autoEvidenceOverdueFines
                .filter(f => inOverviewRange(f.date))
                .map((f, i) => systemFineRow(f, `evidence-${i}`))
                .filter(Boolean),
            ...autoStockCheckMissingFines
                .filter(f => inOverviewRange(f.date))
                .map((f, i) => systemFineRow(f, `stock-check-${i}`))
                .filter(Boolean),
        ];
        const vatRows = new Map<string, any>();
        const combinedFines = combinedFinesRaw.filter(fine => {
            const detailText = String(fine.detail || '');
            const isVatFine = fine.source === 'purchase_vat_overdue'
                || String(fine.type || '').toLocaleLowerCase('vi-VN').includes('vat')
                || detailText.toLocaleLowerCase('vi-VN').includes('hđ vat');
            if (!isVatFine) return true;
            const codeMatch = detailText.match(/(?:pn[-\s]*)?(\d{6}\s*-\s*\d{3})/i);
            const code = codeMatch?.[1]?.replace(/\s+/g, '') || detailText.trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
            const key = `${fine.empId}|vat|${code.toLocaleLowerCase('vi-VN')}`;
            const existing = vatRows.get(key);
            if (existing) {
                if (fine.source === 'purchase_vat_overdue' && existing.source !== 'purchase_vat_overdue') vatRows.set(key, fine);
                return false;
            }
            vatRows.set(key, fine);
            return true;
        });
        // If the system row arrived after a duplicate manual row, replace it
        // in-place while preserving the rest of the table ordering.
        vatRows.forEach((fine, key) => {
            const index = combinedFines.findIndex(row => {
                const detail = String(row.detail || '');
                const match = detail.match(/(?:pn[-\s]*)?(\d{6}\s*-\s*\d{3})/i);
                const code = match?.[1]?.replace(/\s+/g, '') || detail.trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
                return `${row.empId}|vat|${code.toLocaleLowerCase('vi-VN')}` === key;
            });
            if (index >= 0) combinedFines[index] = fine;
        });
        combinedFines.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const fineEmployeeOptions = Array.from(new Map(
            combinedFines.map(f => [
                f.empId,
                employees.find(e => e.id === f.empId)?.name || f.empName || `Nhân viên #${f.empId}`,
            ])
        ).entries())
            .map(([id, name]) => ({ value: id, label: name }))
            .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
        const filteredFines = fineEmployeeFilter === 'all'
            ? combinedFines
            : combinedFines.filter(f => f.empId === fineEmployeeFilter);
        const selectedFineEmployeeName = fineEmployeeFilter === 'all'
            ? ''
            : fineEmployeeOptions.find(option => option.value === fineEmployeeFilter)?.label || '';
        const totalFineAmount = filteredFines.reduce((sum, f) => sum + f.amount, 0);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <Title level={4} style={{ margin: 0, color: '#ff4d4f' }}>Khấu trừ & Phạt</Title>
                        <Tag color="error" style={{ fontWeight: 800, fontSize: 13, padding: '2px 12px' }}>
                            {fineEmployeeFilter === 'all' ? `${combinedFines.length} khoản` : `${filteredFines.length}/${combinedFines.length} khoản`}
                        </Tag>
                        <Space size={8}>
                            <Text type="secondary" style={{ fontSize: 12, fontWeight: 700 }}>Lọc nhân viên</Text>
                            <Select
                                size="middle"
                                value={fineEmployeeFilter}
                                onChange={(value) => setFineEmployeeFilter(value as number | 'all')}
                                showSearch
                                optionFilterProp="label"
                                style={{ width: 220 }}
                                options={[
                                    { value: 'all', label: 'Tất cả nhân viên' },
                                    ...fineEmployeeOptions,
                                ]}
                            />
                        </Space>
                    </div>
                    {isAdmin && !isCurrentPeriodLocked && (
                        <Button
                            type="primary"
                            danger
                            icon={<PlusOutlined />}
                            onClick={() => { setEditingFine(null); fineForm.resetFields(); fineForm.setFieldsValue({ date: dayjs() }); setFineModalOpen(true); }}
                            style={{ fontWeight: 700 }}
                        >
                            Thêm phạt thủ công
                        </Button>
                    )}
                </div>

                {/* Tổng phạt summary */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 20px', borderRadius: 10,
                    background: 'linear-gradient(135deg, #fff1f0 0%, #ffccc7 100%)',
                    border: '1px solid #ffa39e',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <WarningOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                        <Text strong style={{ color: '#cf1322', fontSize: 13 }}>
                            {fineEmployeeFilter === 'all' ? 'Tổng khấu trừ tháng này' : `Tổng khấu trừ của ${selectedFineEmployeeName}`}
                        </Text>
                    </div>
                    <Text strong style={{ color: '#cf1322', fontSize: 18 }}>- {fmt(totalFineAmount)}</Text>
                </div>

                <Card bodyStyle={{ padding: 0 }} style={{ borderTop: '3px solid #ff4d4f' }}>
                    <Table
                        dataSource={filteredFines}
                        pagination={{ pageSize: 10, size: 'small', showTotal: (total) => `Tổng ${total} vi phạm` }}
                        size="middle"
                        scroll={{ x: 'max-content' }}
                        columns={[
                            {
                                title: 'Nhân viên', dataIndex: 'empName', key: 'name', width: 200,
                                render: (n: string) => <Text strong>{n}</Text>,
                            },
                            {
                                title: 'Lỗi vi phạm', dataIndex: 'type', key: 'type', width: 160,
                                render: (t: string) => <Tag color="error" style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>{t}</Tag>,
                            },
                            {
                                title: 'Thời gian', dataIndex: 'date', key: 'date', width: 140,
                                render: (date: string) => {
                                    const d = date ? dayjs(date) : null;
                                    if (!d?.isValid()) return <Text type="secondary">-</Text>;
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                                            <Text strong style={{ fontSize: 12 }}>{d.format('DD/MM/YYYY')}</Text>
                                            <Text type="secondary" style={{ fontSize: 11 }}>{d.format('HH:mm')}</Text>
                                        </div>
                                    );
                                },
                            },
                            {
                                title: 'Chi tiết', dataIndex: 'detail', key: 'detail',
                                render: (d: string, record: any) => {
                                    // 1. Phạt Trả hàng (Returns)
                                    if (record.source === 'returns') {
                                        const match = String(d).match(/Mã phiếu:\s*([^)]+)/);
                                        const code = match?.[1]?.trim();
                                        if (code) {
                                            return (
                                                <Space size={4}>
                                                    <Text style={{ color: '#595959', fontWeight: 500 }}>Phát sinh THHT</Text>
                                                    <Tag color="magenta" style={{ margin: 0, fontWeight: 700, fontFamily: 'monospace', fontSize: 12, border: 'none', background: '#fff0f6', color: '#c41d7f' }}>
                                                        <Text copyable={{ text: code }} style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontFamily: 'inherit' }}>
                                                            {code}
                                                        </Text>
                                                    </Tag>
                                                </Space>
                                            );
                                        }
                                    }

                                    // 2. Phạt Đi muộn (Attendance)
                                    const lateMatch = String(d).match(/^Đi muộn ca (sáng|chiều) (\d+) phút \(Mức (Nhẹ|TB|Nặng)\)/);
                                    if (record.source === 'attendance' && lateMatch) {
                                        const [, ca, minutes, level] = lateMatch;
                                        const levelColors: Record<string, { bg: string, text: string }> = {
                                            'Nhẹ': { bg: '#fffbe6', text: '#d48806' },
                                            'TB': { bg: '#fff7e6', text: '#d46b08' },
                                            'Nặng': { bg: '#fff1f0', text: '#cf1322' }
                                        };
                                        const color = levelColors[level] || { bg: '#f5f5f5', text: '#595959' };
                                        return (
                                            <Space size={6}>
                                                <Text style={{ color: '#595959', fontWeight: 500 }}>Trễ ca {ca} <span style={{ fontWeight: 700, color: '#262626' }}>{minutes} phút</span></Text>
                                                <Tag style={{ margin: 0, fontWeight: 700, fontSize: 10, border: 'none', background: color.bg, color: color.text }}>
                                                    MỨC {level.toUpperCase()}
                                                </Tag>
                                            </Space>
                                        );
                                    }

                                    // 3. Phạt VAT quá hạn (Purchase VAT Overdue)
                                    if (record.source === 'purchase_vat_overdue' || d.includes('chưa cập nhật HĐ VAT')) {
                                        const cleanText = d.replace(/\s*quá 5 ngày chưa cập nhật HĐ VAT\s*$/, '');
                                        const poCode = cleanText.replace(/^Phiếu\s+/, '');
                                        const parts = poCode.split(/\s*-\s*/);
                                        const rawCode = parts[0].trim();
                                        const code = /^PN[-\s]/i.test(rawCode)
                                            ? rawCode.replace(/\s+/g, '')
                                            : `PN-${rawCode.replace(/\s+/g, '')}`;
                                        const supplier = parts.slice(1).join(' - ');
                                        return (
                                            <Space size={4}>
                                                <Text style={{ color: '#595959', fontWeight: 500 }}>Trễ HĐ VAT — quá hạn 5 ngày</Text>
                                                <Tag color="cyan" style={{ margin: 0, fontWeight: 700, fontFamily: 'monospace', fontSize: 11, border: 'none', background: '#e6fffb', color: '#08979c' }}>
                                                    <Text copyable={{ text: code }} style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', fontFamily: 'inherit' }}>
                                                        {code}
                                                    </Text>
                                                </Tag>
                                                {supplier && <Text type="secondary" style={{ fontSize: 11 }}>({supplier})</Text>}
                                            </Space>
                                        );
                                    }

                                    // 4. Trễ deadline công việc (Daily Task Overdue)
                                    if (record.source === 'daily_task_overdue' || d.endsWith('quá deadline')) {
                                        const taskTitle = d.replace(/\s*quá deadline\s*$/, '');
                                        return (
                                            <Space size={4}>
                                                <Text style={{ color: '#595959', fontWeight: 500 }}>Trễ deadline</Text>
                                                <Tag color="volcano" style={{ margin: 0, fontWeight: 600, fontSize: 11, border: 'none', background: '#fff2e8', color: '#d4380d' }}>
                                                    {taskTitle}
                                                </Tag>
                                            </Space>
                                        );
                                    }

                                    // 5. Thiếu công việc hàng ngày (Daily Report Missing)
                                    if (record.source === 'daily_report_missing' || d.includes('Không ghi nhận Công việc')) {
                                        const matchDate = d.match(/ngày\s+(\d{2}\/\d{2}\/\d{4})/);
                                        const missingDate = matchDate?.[1];
                                        return (
                                            <Space size={4}>
                                                <Text style={{ color: '#595959', fontWeight: 500 }}>Thiếu báo cáo ngày</Text>
                                                {missingDate && (
                                                    <Tag color="blue" style={{ margin: 0, fontWeight: 700, fontSize: 11, border: 'none', background: '#e6f7ff', color: '#096dd9' }}>
                                                        {missingDate}
                                                    </Tag>
                                                )}
                                            </Space>
                                        );
                                    }

                                    // 6. Thiếu kiểm hàng ngày (Stock Check Missing)
                                    if (record.source === 'stock_check_missing' || d.includes('Không kiểm hàng')) {
                                        const matchDate = d.match(/ngày\s+(\d{2}\/\d{2}\/\d{4})/);
                                        const missingDate = matchDate?.[1];
                                        return (
                                            <Space size={4}>
                                                <Text style={{ color: '#595959', fontWeight: 500 }}>Thiếu kiểm hàng ngày</Text>
                                                {missingDate && (
                                                    <Tag color="purple" style={{ margin: 0, fontWeight: 700, fontSize: 11, border: 'none', background: '#f9f0ff', color: '#531dab' }}>
                                                        {missingDate}
                                                    </Tag>
                                                )}
                                            </Space>
                                        );
                                    }

                                    // Mặc định cho các loại phạt nhập tay hoặc khác
                                    return <Text strong style={{ color: '#595959' }}>{d}</Text>;
                                },
                            },
                            {
                                title: 'Nguồn', key: 'source', width: 100, align: 'center' as const,
                                render: (_: any, record: any) => {
                                    if (record.source === 'attendance')
                                        return <Tag color="blue" style={{ fontWeight: 700, fontSize: 10 }}>ĐIỂM DANH</Tag>;
                                    if (record.source === 'returns')
                                        return <Tag color="volcano" style={{ fontWeight: 700, fontSize: 10 }}>TRẢ HÀNG</Tag>;
                                    if (record.isManual)
                                        return <Tag color="orange" style={{ fontWeight: 700, fontSize: 10 }}>THỦ CÔNG</Tag>;
                                    return <Tag style={{ fontWeight: 700, fontSize: 10, color: '#8c8c8c' }}>HỆ THỐNG</Tag>;
                                },
                            },
                            {
                                title: <Text style={{ color: '#ff4d4f' }}>Số tiền trừ</Text>,
                                dataIndex: 'amount', key: 'amount', width: 140, align: 'right' as const,
                                render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>- {fmt(v)}</Text>,
                            },
                            {
                                title: '', key: 'actions', width: 90, align: 'center' as const,
                                render: (_: any, record: any) => {
                                    if (!isAdmin || isCurrentPeriodLocked) return null;
                                    return (
                                        <Space size={2}>
                                            <Tooltip title="Sửa phạt">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<EditOutlined style={{ fontSize: 14 }} />}
                                                    onClick={() => handleEditFineRecord(record)}
                                                />
                                            </Tooltip>
                                            <Tooltip title="Xóa phạt">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    icon={<DeleteOutlined style={{ fontSize: 14 }} />}
                                                    onClick={() => handleDeleteFineRecord(record)}
                                                />
                                            </Tooltip>
                                        </Space>
                                    );
                                },
                            },
                        ]}
                    />
                </Card>

                {fineAuditLog.length > 0 && (
                    <Card
                        bodyStyle={{ padding: 0 }}
                        style={{ borderTop: '3px solid #faad14', marginTop: 16 }}
                        title={<Space><HistoryOutlined style={{ color: '#faad14' }} /><Text strong>Lịch sử thay đổi phạt</Text><Tag color="gold">{fineAuditLog.length} thao tác</Tag></Space>}
                    >
                        <Table
                            dataSource={[...fineAuditLog].reverse().map(l => ({ ...l, key: l.id }))}
                            pagination={fineAuditLog.length > 5 ? { pageSize: 5, size: 'small' } : false}
                            size="small"
                            columns={[
                                { title: 'Thời gian', dataIndex: 'timestamp', key: 'ts', width: 150, render: (t: string) => <Text type="secondary" style={{ fontSize: 11 }}>{t}</Text> },
                                { title: 'Thao tác', dataIndex: 'action', key: 'action', width: 70, render: (a: string) => <Tag color={a === 'create' ? 'green' : 'red'} style={{ fontWeight: 700, fontSize: 10 }}>{a === 'create' ? 'Thêm' : 'Xóa'}</Tag> },
                                { title: 'Nội dung', dataIndex: 'note', key: 'note', render: (n: string) => <Text style={{ fontSize: 12 }}>{n}</Text> },
                            ]}
                        />
                    </Card>
                )}
            </div>
        );
    };

    const saveWorkScheduleInline = useCallback((
        emp: any,
        date: dayjs.Dayjs,
        action: 'save' | 'clear' | 'leave' | 'exempt',
        scope: LeaveSession | 'full_day',
        note: string = ''
    ) => {
        if (!canManageAttendance || !canManageAttendanceEmployee(emp)) return;
        if (checkLocked()) return;
        if (!canEditAttendanceDate(date)) {
            message.warning('Quản lý chỉ được lên lịch cho ngày tương lai. Hôm nay hoặc ngày đã qua chỉ admin được sửa.');
            return;
        }

        const dateStr = date.format('YYYY-MM-DD');
        const sessions: LeaveSession[] = scope === 'full_day' ? ['morning', 'afternoon'] : [scope];

        if (action === 'leave' || action === 'exempt') {
            setLeaveRecords(prev => {
                const withoutCurrent = prev.filter(leave => !(leave.empId === emp.id && leave.date === dateStr && sessions.includes(leave.session)));
                const now = new Date().toISOString();
                const nextRecords = sessions.map(session => ({
                    id: `${emp.id}-${dateStr}-${session}`,
                    empId: emp.id,
                    date: dateStr,
                    session,
                    exempt: action === 'exempt',
                    note,
                    createdAt: now,
                    createdBy: currentUser || user?.username || 'System',
                }));
                return [...withoutCurrent, ...nextRecords];
            });
            message.success(action === 'exempt' ? 'Đã ghi nhận miễn trừ ca.' : 'Đã ghi nhận xin nghỉ ca.');
            return;
        }

        setWorkSchedules(prev => {
            const withoutCurrent = prev.filter(schedule => !(schedule.empId === emp.id && schedule.date === dateStr));
            if (action === 'clear') return withoutCurrent;
            const now = new Date().toISOString();
            const nextRecords = sessions.map(session => ({
                id: `${emp.id}-${dateStr}-${session}`,
                empId: emp.id,
                date: dateStr,
                session,
                note,
                createdAt: now,
                createdBy: currentUser || user?.username || 'System',
            }));
            return [...withoutCurrent, ...nextRecords];
        });
        message.success(action === 'clear' ? 'Đã xóa lịch làm.' : 'Đã xếp lịch làm việc.');
    }, [canManageAttendance, canManageAttendanceEmployee, canEditAttendanceDate, checkLocked, currentUser, user?.username]);

    const saveLeaveRequestInline = useCallback((
        emp: any,
        date: dayjs.Dayjs,
        action: 'save' | 'clear' | 'exempt',
        scope: LeaveSession | 'full_day',
        note: string = ''
    ) => {
        if (!canManageAttendance || !canManageAttendanceEmployee(emp)) return;
        if (checkLocked()) return;
        if (!canEditAttendanceDate(date)) {
            message.warning('Quản lý chỉ được lên lịch cho ngày tương lai. Hôm nay hoặc ngày đã qua chỉ admin được sửa.');
            return;
        }

        const dateStr = date.format('YYYY-MM-DD');
        const sessions: LeaveSession[] = scope === 'full_day' ? ['morning', 'afternoon'] : [scope];

        setLeaveRecords(prev => {
            const withoutCurrent = prev.filter(l => !(l.empId === emp.id && l.date === dateStr && sessions.includes(l.session)));
            if (action === 'clear') return withoutCurrent;
            const now = new Date().toISOString();
            const nextRecords = sessions.map(session => ({
                id: `${emp.id}-${dateStr}-${session}`,
                empId: emp.id,
                date: dateStr,
                session,
                exempt: action === 'exempt',
                note,
                createdAt: now,
                createdBy: currentUser || user?.username || 'System',
            }));
            return [...withoutCurrent, ...nextRecords];
        });
        message.success(action === 'clear' ? 'Đã xóa lịch xin nghỉ.' : (action === 'exempt' ? 'Đã ghi nhận miễn trừ.' : 'Đã ghi nhận nghỉ phép.'));
    }, [canManageAttendance, canManageAttendanceEmployee, canEditAttendanceDate, checkLocked, currentUser, user?.username]);

    const openLeaveRequestModal = useCallback((emp: Employee, date: dayjs.Dayjs, defaultSession: LeaveSession, existingLeave?: LeaveRequest) => {
        if (!canManageAttendance || !canManageAttendanceEmployee(emp)) return;
        if (checkLocked()) return;
        if (!canEditAttendanceDate(date)) {
            message.warning('Quản lý chỉ được lên lịch cho ngày tương lai. Hôm nay hoặc ngày đã qua chỉ admin được sửa.');
            return;
        }

        const dateStr = date.format('YYYY-MM-DD');
        let selectedAction: 'save' | 'clear' = 'save';
        let selectedScope: LeaveSession | 'full_day' = defaultSession;
        let note = existingLeave?.note || '';

        Modal.confirm({
            title: `Lên lịch xin nghỉ - ${emp.name} (${date.format('DD/MM/YYYY')})`,
            icon: <CalendarOutlined style={{ color: '#1677ff' }} />,
            width: 460,
            content: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                    {existingLeave && (
                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 6 }}>Thao tác</Text>
                            <Select
                                defaultValue={selectedAction}
                                style={{ width: '100%' }}
                                onChange={(value) => { selectedAction = value; }}
                                options={[
                                    { value: 'save', label: 'Cập nhật lịch xin nghỉ' },
                                    { value: 'clear', label: 'Xóa lịch xin nghỉ' },
                                ]}
                            />
                        </div>
                    )}
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Phạm vi</Text>
                        <Select
                            defaultValue={selectedScope}
                            style={{ width: '100%' }}
                            onChange={(value) => { selectedScope = value; }}
                            options={[
                                { value: 'full_day', label: 'Cả ngày' },
                                { value: 'morning', label: 'Ca sáng' },
                                { value: 'afternoon', label: 'Ca chiều' },
                            ]}
                        />
                    </div>
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Ghi chú</Text>
                        <Input defaultValue={note} placeholder="VD: Báo trước, việc gia đình..." onChange={(event) => { note = event.target.value; }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                        Đến ngày nghỉ, nếu nhân viên không chấm công và đã có lịch xin nghỉ thì hệ thống tính nghỉ có phép. Nếu không có lịch xin nghỉ thì tự tính nghỉ không phép.
                    </div>
                </div>
            ),
            okText: 'Lưu lịch xin nghỉ',
            cancelText: 'Hủy',
            onOk: () => {
                const sessions: LeaveSession[] = selectedScope === 'full_day' ? ['morning', 'afternoon'] : [selectedScope];
                setLeaveRecords(prev => {
                    const withoutCurrent = prev.filter(leave => !(leave.empId === emp.id && leave.date === dateStr && sessions.includes(leave.session)));
                    if (selectedAction === 'clear') return withoutCurrent;
                    const now = new Date().toISOString();
                    const nextRecords = sessions.map(session => ({
                        id: `${emp.id}-${dateStr}-${session}`,
                        empId: emp.id,
                        date: dateStr,
                        session,
                        note,
                        createdAt: now,
                        createdBy: currentUser || user?.username || 'System',
                    }));
                    return [...withoutCurrent, ...nextRecords];
                });
                message.success(selectedAction === 'clear' ? 'Đã xóa lịch xin nghỉ.' : 'Đã lưu lịch xin nghỉ.');
            },
        });
    }, [canManageAttendance, canManageAttendanceEmployee, canEditAttendanceDate, checkLocked, currentUser, user?.username]);

    const openWorkScheduleModal = useCallback((emp: Employee, date: dayjs.Dayjs, defaultSession: LeaveSession, existingSchedule?: WorkScheduleRecord) => {
        if (!canManageAttendance || !canManageAttendanceEmployee(emp)) return;
        if (checkLocked()) return;
        if (!canEditAttendanceDate(date)) {
            message.warning('Quản lý chỉ được lên lịch cho ngày tương lai. Hôm nay hoặc ngày đã qua chỉ admin được sửa.');
            return;
        }
        if (emp.type !== 'Seasonal') {
            message.info('Lịch làm việc theo ca chỉ áp dụng cho nhân viên thời vụ.');
            return;
        }

        const dateStr = date.format('YYYY-MM-DD');
        let selectedAction: 'save' | 'clear' | 'leave' = 'save';
        let selectedScope: LeaveSession | 'full_day' = defaultSession;
        let note = existingSchedule?.note || '';

        Modal.confirm({
            title: `Xếp lịch làm việc - ${emp.name} (${date.format('DD/MM/YYYY')})`,
            icon: <CalendarOutlined style={{ color: '#722ed1' }} />,
            width: 460,
            content: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                    {existingSchedule && (
                        <div>
                            <Text strong style={{ display: 'block', marginBottom: 6 }}>Thao tác</Text>
                            <Select
                                defaultValue={selectedAction}
                                style={{ width: '100%' }}
                                onChange={(value) => { selectedAction = value; }}
                                options={[
                                    { value: 'save', label: 'Cập nhật lịch làm' },
                                    { value: 'leave', label: 'Ghi nhận xin nghỉ ca này' },
                                    { value: 'clear', label: 'Xóa lịch làm' },
                                ]}
                            />
                        </div>
                    )}
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Ca làm</Text>
                        <Select
                            defaultValue={selectedScope}
                            style={{ width: '100%' }}
                            onChange={(value) => { selectedScope = value; }}
                            options={[
                                { value: 'full_day', label: 'Cả ngày' },
                                { value: 'morning', label: 'Ca sáng' },
                                { value: 'afternoon', label: 'Ca chiều' },
                            ]}
                        />
                    </div>
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Ghi chú</Text>
                        <Input defaultValue={note} placeholder="VD: Xếp ca bán hàng, phụ kho..." onChange={(event) => { note = event.target.value; }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                        Nếu đã xếp lịch mà không đi làm và không có lịch xin nghỉ, hệ thống sẽ tính không phép.
                    </div>
                </div>
            ),
            okText: 'Lưu lịch làm',
            cancelText: 'Hủy',
            onOk: () => {
                const sessions: LeaveSession[] = selectedScope === 'full_day' ? ['morning', 'afternoon'] : [selectedScope];
                if (selectedAction === 'leave') {
                    setLeaveRecords(prev => {
                        const withoutCurrent = prev.filter(leave => !(leave.empId === emp.id && leave.date === dateStr && sessions.includes(leave.session)));
                        const now = new Date().toISOString();
                        const nextRecords = sessions.map(session => ({
                            id: `${emp.id}-${dateStr}-${session}`,
                            empId: emp.id,
                            date: dateStr,
                            session,
                            note,
                            createdAt: now,
                            createdBy: currentUser || user?.username || 'System',
                        }));
                        return [...withoutCurrent, ...nextRecords];
                    });
                    message.success('Đã ghi nhận xin nghỉ cho ca đã xếp.');
                    return;
                }
                setWorkSchedules(prev => {
                    const withoutCurrent = prev.filter(schedule => !(schedule.empId === emp.id && schedule.date === dateStr));
                    if (selectedAction === 'clear') return withoutCurrent;
                    const now = new Date().toISOString();
                    const nextRecords = sessions.map(session => ({
                        id: `${emp.id}-${dateStr}-${session}`,
                        empId: emp.id,
                        date: dateStr,
                        session,
                        note,
                        createdAt: now,
                        createdBy: currentUser || user?.username || 'System',
                    }));
                    return [...withoutCurrent, ...nextRecords];
                });
                message.success(selectedAction === 'clear' ? 'Đã xóa lịch làm.' : 'Đã lưu lịch làm.');
            },
        });
    }, [canManageAttendance, canManageAttendanceEmployee, canEditAttendanceDate, checkLocked, currentUser, user?.username]);

    // ============================================
    // TAB 5: ĐIỂM DANH & LỊCH SỬ
    // ============================================
    const matrixColumns = useMemo(() => {
        const columns: any[] = [
            {
                title: 'Nhân viên', dataIndex: 'name', key: 'name', width: 130, fixed: 'left' as const,
                render: (name: string) => (
                    <div className="att-matrix-name-cell">
                        <Text strong style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{name}</Text>
                    </div>
                ),
            }
        ];

        for (let i = 0; i < daysInMonth; i++) {
            const currentDay = dayjs(`${selectedYear}-${selectedMonth}-${i + 1}`, 'YYYY-M-D');
            const dayOfWeek = currentDay.day();
            const isSunday = dayOfWeek === 0;
            const holidayName = isPublicHoliday(currentDay);
            const isHoliday = !!holidayName;
            const isToday = currentDay.isSame(dayjs(), 'day');
            const titleLabel = dayOfWeek === 0 ? 'CN' : `T${dayOfWeek + 1}`;

            columns.push({
                title: (
                    <div style={{ textAlign: 'center' as const, position: 'relative' }}>
                        {isToday && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#1677ff', color: '#fff', fontSize: 8, padding: '0 4px', borderRadius: 4, fontWeight: 700 }}>H.NAY</div>}
                        {isHoliday && !isToday && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: '#fa541c', color: '#fff', fontSize: 7, padding: '0 4px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>🎌 LỄ</div>}
                        <div style={{ fontWeight: 800, fontSize: 11, color: isToday ? '#1677ff' : (isHoliday ? '#d4380d' : (isSunday ? '#bfbfbf' : (dayOfWeek === 6 ? '#00ab56' : '#595959'))), marginTop: isToday || isHoliday ? 4 : 0 }}>
                            {currentDay.format('DD/MM')}
                        </div>
                        <div style={{ fontSize: 8, color: isToday ? '#1677ff' : (isHoliday ? '#fa541c' : (isSunday ? '#bfbfbf' : '#8c8c8c')), fontWeight: isToday ? 800 : 600 }}>
                            {titleLabel}
                        </div>
                    </div>
                ),
                key: `day-${i}`, align: 'center' as const, width: isToday ? 110 : 100,
                onHeaderCell: () => ({
                    className: isToday ? 'att-today-col-header' : undefined,
                    style: { background: isToday ? '#e6f4ff' : (isHoliday ? '#fff2e8' : (isSunday ? '#fafafa' : undefined)), borderLeft: isSunday || isToday || isHoliday ? '2px solid #f0f0f0' : undefined, borderRight: isToday ? '2px solid #f0f0f0' : undefined }
                }),
                onCell: () => ({ style: { background: isToday ? '#f0f5ff' : (isHoliday ? '#fff9f7' : (isSunday ? '#fafafa' : undefined)), borderLeft: isSunday || isToday || isHoliday ? '2px solid #f0f0f0' : undefined, borderRight: isToday ? '2px solid #f0f0f0' : undefined } }),
                render: (_: any, record: any, rowIdx: number) => {
                    const d = liveAttendanceMatrix[rowIdx]?.[i] || {
                        am: 0, pm: 0,
                        amTime: '', pmTime: '',
                        amOutTime: '', pmOutTime: '',
                        amLeave: undefined, pmLeave: undefined,
                        amSchedule: undefined, pmSchedule: undefined
                    };
                    if (isHoliday && d.am === 0 && d.pm === 0) return <HolidayRestCell label={holidayName!} />;
                    if (isSunday && d.am === 0 && d.pm === 0) return <SundayRestCell />;

                    const emp = employees.find(e => e.id === record.key) || employees[rowIdx];
                    if (!emp) return null;

                    const canEdit = canManageAttendance && canManageAttendanceEmployee(emp) && canEditAttendanceDate(currentDay) && !isCurrentPeriodLocked;

                    const renderSessionCell = (
                        session: LeaveSession,
                        status: 0 | 1 | 2,
                        time?: string,
                        outTime?: string,
                        schedule?: WorkScheduleRecord,
                        leave?: LeaveRequest
                    ) => {
                        const label = session === 'morning' ? 'Sáng' : 'Chiều';
                        const isSessionDue = isAttendanceSessionDue(currentDay, session);

                        if (emp.type === 'Seasonal') {
                            if (status > 0) {
                                return <ShiftPill label={label} status={status} time={time} outTime={outTime} />;
                            }

                            if (canEdit) {
                                return (
                                    <InlineSchedulePopover
                                        emp={emp}
                                        date={currentDay}
                                        session={session}
                                        schedule={schedule}
                                        request={leave}
                                        isDue={isSessionDue}
                                        onSave={(action, scope, note) => saveWorkScheduleInline(emp, currentDay, action, scope, note)}
                                    >
                                        <WorkSchedulePill
                                            label={label}
                                            schedule={schedule}
                                            request={leave}
                                            isDue={isSessionDue}
                                            onClick={() => {}}
                                        />
                                    </InlineSchedulePopover>
                                );
                            }

                            return (
                                <WorkSchedulePill
                                    label={label}
                                    schedule={schedule}
                                    request={leave}
                                    isDue={isSessionDue}
                                />
                            );
                        } else {
                            if (status > 0) {
                                return <ShiftPill label={label} status={status} time={time} outTime={outTime} />;
                            }

                            if (canEdit) {
                                return (
                                    <InlineLeavePopover
                                        emp={emp}
                                        date={currentDay}
                                        session={session}
                                        request={leave}
                                        isDue={isSessionDue}
                                        onSave={(action, scope, note) => saveLeaveRequestInline(emp, currentDay, action, scope, note)}
                                    >
                                        <LeavePill
                                            label={label}
                                            request={leave}
                                            isDue={isSessionDue}
                                            onClick={() => {}}
                                        />
                                    </InlineLeavePopover>
                                );
                            }

                            return (
                                <LeavePill
                                    label={label}
                                    request={leave}
                                    isDue={isSessionDue}
                                />
                            );
                        }
                    };

                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {renderSessionCell('morning', d.am as 0 | 1 | 2, d.amTime, d.amOutTime, d.amSchedule, d.amLeave)}
                            {renderSessionCell('afternoon', d.pm as 0 | 1 | 2, d.pmTime, d.pmOutTime, d.pmSchedule, d.pmLeave)}
                        </div>
                    );
                },
            });
        }

        columns.push({
            title: (
                <div style={{
                    textAlign: 'center',
                    background: 'linear-gradient(135deg, #00ab56 0%, #00c76a 100%)',
                    margin: '-12px -10px',
                    padding: '12px 10px',
                    color: '#fff',
                }}>
                    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.9 }}>TỔNG</div>
                    <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>CA</div>
                </div>
            ),
            key: 'total', width: 72, align: 'center' as const, fixed: 'right' as const,
            onHeaderCell: () => ({ className: 'att-total-col-header', style: { padding: 0 } }),
            onCell: () => ({ className: 'att-total-col-cell' }),
            render: (_: any, __: any, rowIdx: number) => {
                const stat = employeeStats[rowIdx] || { shiftCount: 0 };
                return (
                    <div style={{ textAlign: 'center', padding: '4px 0' }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: '#00ab56', lineHeight: 1, letterSpacing: -1 }}>{stat.shiftCount}</div>
                        <div style={{
                            display: 'inline-block', marginTop: 4,
                            fontSize: 8, fontWeight: 900, letterSpacing: 1.5,
                            color: '#059669', textTransform: 'uppercase' as const,
                            background: '#d1fae5', borderRadius: 4,
                            padding: '1px 6px', border: '1px solid #a7f3d0',
                        }}>CA LÀM</div>
                    </div>
                );
            },
        });
        return columns;
    }, [employeeStats, liveAttendanceMatrix, daysInMonth, selectedMonth, selectedYear, openLeaveRequestModal, saveWorkScheduleInline, saveLeaveRequestInline, canManageAttendance, canManageAttendanceEmployee, canEditAttendanceDate, isCurrentPeriodLocked, employees, isAttendanceSessionDue]);

    useEffect(() => {
        const isCurrentMonth = selectedMonth === dayjs().month() + 1 && selectedYear === dayjs().year();
        if (!isCurrentMonth || activeTab !== 'attendance') return;

        let cancelled = false;
        let retryCount = 0;

        const scrollToTodayColumn = () => {
            if (cancelled) return;

            const wrap = attendanceMatrixWrapRef.current;
            const todayHeader = wrap?.querySelector('.att-today-col-header') as HTMLElement | null;
            if (!wrap || !todayHeader) {
                if (retryCount < 8) {
                    retryCount += 1;
                    window.setTimeout(scrollToTodayColumn, 80);
                }
                return;
            }

            todayHeader.scrollIntoView({
                behavior: 'auto',
                block: 'nearest',
                inline: 'center',
            });
        };

        const frame1 = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(scrollToTodayColumn);
        });

        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame1);
        };
    }, [selectedMonth, selectedYear, activeTab, daysInMonth]);

    const renderAttendance = () => (
        <FaceAttendanceTab
            employees={employees}
            onLogAdded={() => { if (isDbLoaded) fetchMonthLogs(); }}
            config={config}
            isAdmin={isAdmin}
            onLateFine={(fine) => {
                setExtraFines(prev => prev.some(item => item.id === fine.id) ? prev : [...prev, fine]);
                message.warning(`⚠️ Phạt đi muộn: ${fine.detail} — ${fine.amount.toLocaleString('vi-VN')}đ`);
            }}
        >
            <Divider style={{ margin: '8px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <Space size={12}>
                    <Badge color="#52c41a" text={<Text style={{ fontSize: 11, fontWeight: 700 }}>Đúng giờ</Text>} />
                    <Badge color="#fa8c16" text={<Text style={{ fontSize: 11, fontWeight: 700 }}>Đi muộn</Text>} />
                    <Badge color="#d9d9d9" text={<Text style={{ fontSize: 11, fontWeight: 700 }}>Nghỉ</Text>} />
                </Space>
            </div>

            {/* Matrix */}
            <Card
                title={<Space><CalendarOutlined style={{ color: '#00ab56' }} /><Text strong>Ma trận công ca hàng ngày</Text><Tag style={{ fontSize: 10, fontWeight: 600 }}>Hiển thị chi tiết Ca Sáng & Ca Chiều</Tag></Space>}
                bodyStyle={{ padding: 0 }}
                style={{ borderTop: '3px solid #00ab56' }}
            >
                <div ref={attendanceMatrixWrapRef}>
                    <Table
                        className="att-matrix-table"
                        dataSource={employees.map((emp, idx) => ({ key: emp.id, name: emp.name, idx }))}
                        columns={matrixColumns}
                        pagination={false}
                        size="small"
                        bordered
                        scroll={{ x: 'max-content' }}
                    />
                </div>
            </Card>

            {/* Stats */}
            <Card title={<Space><UserOutlined style={{ color: '#00ab56' }} /><Text strong>Thống kê tháng 03</Text></Space>} style={{ borderTop: '3px solid #00ab56' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    {employeeStats.map((emp) => (
                        <div key={emp.id} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '10px 12px', borderRadius: 10, border: '1px solid #f0f0f0', background: '#fafafa',
                        }}>
                            <div>
                                <Text strong style={{ fontSize: 13 }}>{emp.name}</Text>
                                <div><Text type="secondary" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{emp.shiftCount} ca làm</Text></div>
                            </div>
                            <Space size={16}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: '#fa8c16', textTransform: 'uppercase' }}>Muộn</div>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: emp.lateCount > 0 ? '#fa8c16' : '#d9d9d9' }}>{emp.lateCount}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: '#8c8c8c', textTransform: 'uppercase' }}>Vắng</div>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: emp.absentCount > 0 ? '#ff4d4f' : '#d9d9d9' }}>{emp.absentCount}</div>
                                </div>
                            </Space>
                        </div>
                    ))}
                </div>
            </Card>
        </FaceAttendanceTab>
    );

    // ============================================
    // TAB 6: QUẢN LÝ QUỸ
    // ============================================
    const renderFund = () => {
        const allFundTx = [...fundTransactions, ...extraFundTx];
        const dynamicTotals = allFundTx.reduce((acc, t) => {
            if (t.type === 'in') acc.income += t.amount;
            else acc.expense += t.amount;
            return acc;
        }, { income: 0, expense: 0 });
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <Row gutter={16}>
                    <Col xs={24} sm={8}>
                        <Card style={{ background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)', border: 'none' }}>
                            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>Số dư quỹ hiện tại</span>} value={dynamicTotals.income - dynamicTotals.expense} precision={0} suffix="đ" valueStyle={{ color: '#fff', fontWeight: 900, fontSize: 28 }} />
                        </Card>
                    </Col>
                    <Col xs={24} sm={8}>
                        <Card><Statistic title="Tổng thu tháng" value={dynamicTotals.income} precision={0} suffix="đ" valueStyle={{ color: '#00ab56', fontWeight: 800 }} /></Card>
                    </Col>
                    <Col xs={24} sm={8}>
                        <Card><Statistic title="Tổng chi tháng" value={dynamicTotals.expense} precision={0} suffix="đ" valueStyle={{ color: '#ff4d4f', fontWeight: 800 }} /></Card>
                    </Col>
                </Row>

                <Card
                    title={<Space><WalletOutlined style={{ color: '#722ed1' }} /><Text strong>Nhật ký thu chi nội bộ</Text></Space>}
                    extra={
                        <Space>
                            <Tooltip title={fundAuditLog.length === 0 ? 'Chưa có lịch sử thay đổi' : `${fundAuditLog.length} thay đổi`}>
                                <Button
                                    icon={<HistoryOutlined />}
                                    onClick={() => setAuditDrawerOpen(true)}
                                    disabled={fundAuditLog.length === 0}
                                >
                                    Lịch sử{fundAuditLog.length > 0 ? ` (${fundAuditLog.length})` : ''}
                                </Button>
                            </Tooltip>
                            {canCreateFundTx && (
                                <Dropdown menu={{
                                    items: [
                                        { key: 'in', label: <span style={{ color: '#00ab56', fontWeight: 700 }}>💰 Thu vào quỹ</span>, onClick: () => { fundForm.resetFields(); fundForm.setFieldsValue({ person: currentUser || '' }); setEditingFundTx(null); setFundModalType('in'); } },
                                        { key: 'out', label: <span style={{ color: '#ff4d4f', fontWeight: 700 }}>💸 Chi ra từ quỹ</span>, onClick: () => { fundForm.resetFields(); fundForm.setFieldsValue({ person: currentUser || '' }); setEditingFundTx(null); setFundModalType('out'); } },
                                    ],
                                }}>
                                    <Button type="primary" style={{ background: '#722ed1', borderColor: '#722ed1', fontWeight: 700 }} icon={<PlusOutlined />}>
                                        Thêm giao dịch <DownOutlined />
                                    </Button>
                                </Dropdown>
                            )}
                        </Space>
                    }
                    bodyStyle={{ padding: 0 }}
                    style={{ borderTop: '3px solid #722ed1' }}
                >
                    <Table
                        dataSource={allFundTx.map((t) => ({ ...t, key: t.id }))}
                        pagination={{ pageSize: 10, size: 'small', showTotal: (total) => `${total} giao dịch`, hideOnSinglePage: true }}
                        size="middle"
                        columns={[
                            { title: 'Ngày', dataIndex: 'date', key: 'date', width: '15%', render: (d: string) => <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{d}</Text> },
                            { title: 'Mục chi tiêu', dataIndex: 'note', key: 'note', render: (n: string) => <Text strong style={{ color: '#595959' }}>{n}</Text> },
                            { title: 'Người TH', dataIndex: 'person', key: 'person', width: '15%', render: (p: string) => <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{p}</Text> },
                            { title: 'Số tiền', dataIndex: 'amount', key: 'amount', width: '20%', align: 'right' as const, render: (v: number, r: any) => <Text strong style={{ color: r.type === 'in' ? '#00ab56' : '#ff4d4f', whiteSpace: 'nowrap', fontSize: 15 }}>{r.type === 'in' ? '+' : '-'} {fmt(v)}</Text> },
                            {
                                title: '', key: 'actions', width: '10%', align: 'center' as const,
                                render: (_: any, record: FundTransaction) => {
                                    const isEditable = canEditFundTx(record);
                                    if (!isEditable) return null;
                                    return (
                                        <Space size={4} style={{ whiteSpace: 'nowrap' }}>
                                            <Tooltip title="Sửa">
                                                <Button type="text" size="small" icon={<EditOutlined style={{ color: '#1890ff' }} />} onClick={() => handleEditFundTx(record)} />
                                            </Tooltip>
                                            <Tooltip title="Xóa">
                                                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteFundTx(record)} />
                                            </Tooltip>
                                        </Space>
                                    );
                                },
                            },
                        ]}
                    />
                </Card>

                {/* AUDIT DRAWER - Lịch sử thay đổi */}
                <Drawer
                    title={<Space><HistoryOutlined style={{ color: '#722ed1' }} /><span>Lịch sử biến động (Audit Trail)</span></Space>}
                    placement="right"
                    width={500}
                    open={auditDrawerOpen}
                    onClose={() => setAuditDrawerOpen(false)}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>Không thể xóa</Text>}
                    bodyStyle={{ padding: 0, background: '#f5f7fa' }}
                >
                    {fundAuditLog.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#8c8c8c', paddingTop: 60 }}>
                            <HistoryOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
                            <div>Chưa có biến động nào được ghi nhận</div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {fundAuditLog.map((log, i) => {
                                const isCreate = log.action === 'create';
                                const isEdit = log.action === 'edit';
                                const isDelete = log.action === 'delete';

                                // Extracting +/- visual clues from detail if possible
                                const hasPositiveStr = log.detail.includes('Thu') || log.detail.includes('+');
                                const hasNegativeStr = log.detail.includes('Chi') || log.detail.includes('-');

                                return (
                                    <div key={`audit-${i}`} style={{
                                        background: '#fff',
                                        padding: '16px 20px',
                                        borderBottom: '1px solid #f0f0f0',
                                        transition: 'all 0.2s',
                                        cursor: 'default'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', gap: 14 }}>
                                                <div style={{
                                                    width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                                    background: isCreate ? '#f6ffed' : isEdit ? '#e6f7ff' : '#fff1f0',
                                                    color: isCreate ? '#52c41a' : isEdit ? '#1890ff' : '#ff4d4f',
                                                    fontSize: 22,
                                                    border: `1px solid ${isCreate ? '#b7eb8f' : isEdit ? '#91caff' : '#ffa39e'}`
                                                }}>
                                                    {isCreate ? <WalletOutlined /> : isEdit ? <EditOutlined /> : <DeleteOutlined />}
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1f2937' }}>
                                                        {isCreate ? 'THÊM MỚI GIAO DỊCH' : isEdit ? 'ĐIỀU CHỈNH GIAO DỊCH' : 'HỦY GIAO DỊCH'}
                                                    </div>
                                                    <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5, wordBreak: 'break-word', maxWidth: 350 }}>
                                                        {log.detail}
                                                    </div>
                                                    {log.oldData && isEdit && (
                                                        <div style={{
                                                            background: '#f8fafc', borderRadius: 8, padding: '8px 12px', marginTop: 4,
                                                            borderLeft: '4px solid #1890ff', fontSize: 12
                                                        }}>
                                                            <div style={{ color: '#64748b', marginBottom: 2, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Dữ liệu trước thay đổi</div>
                                                            <div style={{ color: '#334155' }}>
                                                                <Text strong style={{ color: '#475569' }}>{log.oldData.note}</Text> —
                                                                <Text strong style={{ color: '#475569', marginLeft: 4 }}>{fmt(log.oldData.amount || 0)}</Text>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <ClockCircleOutlined />
                                                        {log.timestamp}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Optional highlight side */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'flex-start' }}>
                                                <Tag
                                                    style={{ margin: 0, border: 'none', fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}
                                                    color={isCreate ? 'success' : isEdit ? 'processing' : 'error'}
                                                >
                                                    {isCreate ? '+ TẠO MỚI' : isEdit ? '✎ SỬA' : '− XÓA'}
                                                </Tag>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            <div style={{ textAlign: 'center', padding: '16px 0', color: '#bfbfbf', fontSize: 12 }}>
                                Hết biến động
                            </div>
                        </div>
                    )}
                </Drawer>
            </div>
        );
    };

    // === RENDER NHÂN SỰ ===
    const renderEmployees = () => {
        return (
            <Card bordered={false} style={{ borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>Danh sách nhân sự</div>
                    {isAdmin && (
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingEmp(null); empForm.resetFields(); setEmpModalOpen(true); }}>
                            Thêm Nhân Sự
                        </Button>
                    )}
                </div>
                <Table
                    dataSource={employees}
                    rowKey="id"
                    pagination={false}
                    size="middle"
                    columns={[
                        { title: 'ID', dataIndex: 'id', width: 50, align: 'center' },
                        { title: 'Họ và tên', dataIndex: 'name', width: 180, render: (n) => <Text strong>{n}</Text> },
                        { title: 'Username', dataIndex: 'username', width: 100, render: (u) => <Tag color="blue" style={{ fontWeight: 700, fontFamily: 'monospace' }}>{u || '—'}</Tag> },
                        {
                            title: 'Hợp đồng', dataIndex: 'type', width: 110,
                            render: (t) => <Tag color={t === 'Official' ? 'blue' : 'green'} style={{ fontWeight: 600 }}>{t === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag>
                        },
                        { title: 'Đơn giá', dataIndex: 'baseSalary', align: 'right', render: (v, r) => <Text>{fmt(v)}{r.isHourly ? ' / giờ' : ' / tháng'}</Text> },
                        {
                            title: 'Thao tác', align: 'center', width: 100,
                            render: (_, record) => isAdmin ? (
                                <Space>
                                    <Button size="small" type="text" icon={<EditOutlined style={{ color: '#1890ff' }} />} onClick={() => {
                                        setEditingEmp(record);
                                        empForm.resetFields();
                                        empForm.setFieldsValue({
                                            ...record,
                                            username: record.username || '',
                                            bankId: record.bankId ?? null,
                                            bankAccount: record.bankAccount ?? null,
                                            bankAccountName: record.bankAccountName ?? null,
                                        });
                                        setEmpModalOpen(true);
                                    }} />
                                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                                        setEmployees(prev => prev.filter(e => e.id !== record.id));
                                        message.success('Đã xóa nhân viên!');
                                    }} />
                                </Space>
                            ) : null
                        }
                    ]}
                />
            </Card>
        );
    };

    const handleSaveEmp = () => {
        empForm.validateFields().then(values => {
            const newEmp: Employee = {
                id: editingEmp ? editingEmp.id : Date.now(),
                name: values.name,
                username: (values.username || '').trim().toLowerCase(),
                type: values.type,
                baseSalary: values.baseSalary,
                isHourly: values.type === 'Seasonal',
                bankId: values.bankId || undefined,
                bankAccount: (values.bankAccount || '').replace(/\s+/g, '') || undefined,
                bankAccountName: (values.bankAccountName || '').trim().toUpperCase() || undefined,
            };
            if (editingEmp) {
                setEmployees(prev => prev.map(e => e.id === editingEmp.id ? newEmp : e));
                message.success('Đã cập nhật nhân viên!');
            } else {
                setEmployees(prev => [...prev, newEmp]);
                message.success('Đã thêm nhân viên mới!');
            }
            setEmpModalOpen(false);
        });
    };

    // ============================================
    // TABS CONFIG (nav-only, no children)
    // ============================================
    const tabNavItems = [
        { key: 'overview', label: <><ProfileOutlined /> Tổng quát</> },
        { key: 'packaging', label: <><TeamOutlined /> Đóng gói</> },
        { key: 'bonuses', label: 'Thưởng' },
        { key: 'fines', label: 'Phạt' },
        { key: 'attendance', label: <><CalendarOutlined /> Điểm danh</> },
        {
            key: 'fund',
            label: (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    background: 'linear-gradient(90deg, #00b09b 0%, #96c93d 100%)',
                    color: '#fff',
                    padding: '4px 12px',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0, 176, 155, 0.2)'
                }}>
                    <CoffeeOutlined style={{ fontSize: 16 }} />
                    <span>QUẢN LÝ QUỸ</span>
                </div>
            )
        },
    ];

    // Render content theo tab active
    const renderActiveTabContent = () => {
        switch (activeTab) {
            case 'overview': return renderOverview();
            case 'packaging': return renderPackaging();
            case 'bonuses': return renderBonuses();
            case 'fines': return renderFines();
            case 'attendance': return renderAttendance();
            case 'fund': return renderFund();
            default: return renderOverview();
        }
    };

    // ===== RENDER =====
    if (!isDbLoaded) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F8F9FA' }}>
                <Spin size="large" tip="Đang tải dữ liệu Máy chấm công từ database..." />
            </div>
        );
    }

    return (
        <div className="attendance-module">
            {/* Tab Nav - Sticky on top */}
            <div className="att-tabs-sticky">
                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={tabNavItems}
                    size="large"
                />
            </div>

            {/* Page Header */}
            <div className="att-page-header">
                <Space size={8} wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                    {/* Custom Time Range Selector — kiểu Google Analytics */}
                    {(() => {
                        const now = dayjs();
                        const rangeLabel = (() => {
                            const s = overviewDateRange[0];
                            const e = overviewDateRange[1];
                            if (s.isSame(now, 'day') && e.isSame(now, 'day')) return 'Hôm nay';
                            if (s.isSame(now.subtract(1, 'day'), 'day') && e.isSame(now.subtract(1, 'day'), 'day')) return 'Hôm qua';
                            if (s.isSame(now.subtract(6, 'day'), 'day') && e.isSame(now, 'day')) return 'Trong 7 ngày qua';
                            if (s.isSame(now.subtract(29, 'day'), 'day') && e.isSame(now, 'day')) return 'Trong 30 ngày qua';
                            if (s.isSame(e, 'day')) return s.format('DD/MM/YYYY');
                            if (s.isSame(s.startOf('month'), 'day') && e.isSame(s.endOf('month'), 'day')) {
                                if (s.isSame(now.startOf('month'), 'day')) return 'Tháng này';
                                if (s.isSame(now.subtract(1, 'month').startOf('month'), 'day')) return 'Tháng trước';
                                return `Tháng ${s.format('MM/YYYY')}`;
                            }
                            if (s.isSame(s.startOf('week'), 'day') && e.isSame(s.endOf('week'), 'day')) return `Tuần ${s.format('DD/MM')} — ${e.format('DD/MM')}`;
                            if (s.isSame(s.startOf('year'), 'day') && e.isSame(s.endOf('year'), 'day')) return `Năm ${s.format('YYYY')}`;
                            return `${s.format('DD/MM/YYYY')} — ${e.format('DD/MM/YYYY')}`;
                        })();
                        const setRange = (start: dayjs.Dayjs, end: dayjs.Dayjs) => setOverviewDateRange([start, end]);
                        return (
                            <Dropdown
                                trigger={['click']}
                                popupRender={() => (
                                    <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 6px 16px rgba(0,0,0,.12)', padding: '8px 0', minWidth: 220, border: '1px solid #f0f0f0' }}>
                                        {/* Quick presets */}
                                        {[
                                            { label: 'Tháng này', fn: () => setRange(now.startOf('month'), now.endOf('month')) },
                                            { label: 'Tháng trước', fn: () => setRange(now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')) },
                                        ].map(opt => (
                                            <div key={opt.label}
                                                onClick={opt.fn}
                                                style={{ padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: rangeLabel === opt.label ? '#1677ff' : '#262626', background: rangeLabel === opt.label ? '#e6f4ff' : 'transparent', transition: 'all .15s' }}
                                                onMouseEnter={e => { if (rangeLabel !== opt.label) e.currentTarget.style.background = '#f5f5f5'; }}
                                                onMouseLeave={e => { if (rangeLabel !== opt.label) e.currentTarget.style.background = 'transparent'; }}
                                            >{opt.label}</div>
                                        ))}
                                        <div style={{ height: 1, background: '#f0f0f0', margin: '6px 0' }} />
                                        {/* Theo ngày */}
                                        <div style={{ padding: '4px 16px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo ngày</div>
                                            <DatePicker
                                                size="small"
                                                format="DD/MM/YYYY"
                                                placeholder="Chọn ngày..."
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('day'), d.endOf('day')); }}
                                            />
                                        </div>
                                        {/* Theo tháng */}
                                        <div style={{ padding: '4px 16px', paddingBottom: 8 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo tháng</div>
                                            <DatePicker
                                                picker="month"
                                                size="small"
                                                format="MM/YYYY"
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('month'), d.endOf('month')); }}
                                            />
                                        </div>
                                    </div>
                                )}
                            >
                                <Button
                                    style={{ borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', height: 'auto' }}
                                >
                                    <CalendarOutlined style={{ color: '#1677ff' }} />
                                    <span style={{ color: '#1677ff', fontWeight: 700 }}>{rangeLabel}</span>
                                    <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                                        {overviewDateRange[0].isSame(overviewDateRange[1], 'day')
                                            ? overviewDateRange[0].format('DD/MM/YYYY')
                                            : `${overviewDateRange[0].format('DD/MM')} → ${overviewDateRange[1].format('DD/MM/YYYY')}`}
                                    </span>
                                    <DownOutlined style={{ fontSize: 10, color: '#8c8c8c' }} />
                                </Button>
                            </Dropdown>
                        );
                    })()}
                    {isAdmin && <Button className="att-btn-config" icon={<SettingOutlined />} onClick={openConfigModal} disabled={isCurrentPeriodLocked}>Cấu hình</Button>}
                    {isCurrentPeriodLocked ? (
                        currentUser === 'admin' ? (
                            <Button
                                icon={<LockOutlined />}
                                onClick={() => {
                                    Modal.confirm({
                                        title: 'Mở khóa kỳ lương',
                                        content: `Mở khóa kỳ ${overviewDateRange[0].format('DD/MM/YYYY')} — ${overviewDateRange[1].format('DD/MM/YYYY')}? Nhân viên sẽ có thể chỉnh sửa lại.`,
                                        okText: 'Mở khóa',
                                        cancelText: 'Hủy',
                                        okType: 'primary',
                                        onOk: () => {
                                            setLockedPeriods(prev => prev.filter(lp =>
                                                !(dayjs(lp.start).isSame(overviewDateRange[0], 'day') &&
                                                    dayjs(lp.end).isSame(overviewDateRange[1], 'day'))
                                            ));
                                            message.success('Đã mở khóa kỳ lương!');
                                        },
                                    });
                                }}
                                style={{
                                    borderRadius: 8,
                                    fontWeight: 700,
                                    background: '#fff7e6',
                                    borderColor: '#ffa940',
                                    color: '#d46b08',
                                }}
                            >
                                Mở khóa (Admin)
                            </Button>
                        ) : (
                            <Button
                                icon={<LockOutlined />}
                                disabled
                                style={{
                                    borderRadius: 8,
                                    fontWeight: 700,
                                    background: '#fff7e6',
                                    borderColor: '#ffa940',
                                    color: '#d46b08',
                                    cursor: 'not-allowed',
                                    opacity: 1,
                                }}
                            >
                                Đã chốt
                            </Button>
                        )
                    ) : (
                        <Button
                            className="att-btn-lock"
                            icon={<LockOutlined />}
                            onClick={lockPayroll}
                            type="primary"
                            danger
                        >
                            Chốt & Khóa
                        </Button>
                    )}
                    {isCurrentPeriodLocked && (
                        <Tooltip title="Gửi Gmail hàng loạt">
                            <Button
                                size="small"
                                icon={<SendOutlined />}
                                onClick={handleBulkSendGmail}
                                loading={gmailSending || packingOrdersLoading}
                                disabled={gmailSending || packingOrdersLoading}
                                style={{ borderRadius: 6, background: '#f6ffed', borderColor: '#b7eb8f', color: '#389e0d' }}
                            />
                        </Tooltip>
                    )}
                </Space>
            </div>

            {/* Tab Content */}
            <div className="att-tab-content">
                {renderActiveTabContent()}
            </div>

            {/* ===== MODAL: Phiếu Lương ===== */}
            <Modal
                title={<div style={{ textAlign: 'center', fontWeight: 900, fontSize: 18, textTransform: 'uppercase' }}>Phiếu Lương Chi Tiết</div>}
                open={!!payslipModal}
                onCancel={() => { setPayslipModal(null); setPayslipPdfDetailOpen(false); }}
                footer={null}
                width={payslipPdfDetailOpen ? 920 : 520}
                className="att-payslip-modal"
            >
                {payslipModal && (() => {
                    const p = payslipModal;
                    const periodKey = `${overviewDateRange[0].year()}-${String(overviewDateRange[0].month() + 1).padStart(2, '0')}`;
                    const overrideKey = `${p.id}_${periodKey}`;
                    const currentOverride = payrollOverrides[overrideKey] || {};

                    const empFines = overviewFines.filter(f => f.empId === p.id);
                    const empBonuses = overviewBonuses.filter(b => b.empId === p.id);
                    const fineDescription = (f: FineRecord) => {
                        const fineDate = f.date ? dayjs(f.date) : null;
                        let text = (f.detail || f.type || 'Phạt').trim();
                        if (fineDate?.isValid()) {
                            const datePatterns = [
                                fineDate.format('D/M/YYYY'),
                                fineDate.format('DD/M/YYYY'),
                                fineDate.format('D/MM/YYYY'),
                                fineDate.format('DD/MM/YYYY'),
                            ];
                            datePatterns.forEach(dateText => {
                                text = text
                                    .replace(new RegExp(`\\s*[—-]\\s*${dateText.replace(/\//g, '\\/')}`, 'g'), '')
                                    .replace(new RegExp(`\\s*ngày\\s+${dateText.replace(/\//g, '\\/')}`, 'gi'), '');
                            });
                        }
                        return text.replace(/\s{2,}/g, ' ').replace(/\s*[—-]\s*$/, '').trim();
                    };
                    const fineTime = (f: FineRecord) => f.date ? dayjs(f.date).format('DD/MM HH:mm') : '';
                    const positiveAdjust = Math.max(p.extraAdjust || 0, 0);
                    const negativeAdjust = Math.max(-(p.extraAdjust || 0), 0);
                    const totalEarnings = p.salaryBase + p.packIncome + (p.totalBonus || 0) + positiveAdjust;
                    const totalDeductions = (p.myFines || 0) + (p.leaveDeduction || 0) + negativeAdjust;
                    const issueDate = dayjs().format('DD/MM/YYYY');
                    const periodLabel = `Tháng ${overviewDateRange[0].format('MM/YYYY')} (${overviewDateRange[0].format('DD/MM')} - ${overviewDateRange[1].format('DD/MM/YYYY')})`;

                    // Helper: Lưu override cho NV này
                    const saveOverride = (patch: Partial<PayrollOverride>) => {
                        if (checkLocked()) return;
                        setPayrollOverrides(prev => ({
                            ...prev,
                            [overrideKey]: {
                                ...prev[overrideKey],
                                ...patch,
                                updatedAt: new Date().toISOString(),
                                updatedBy: currentUser,
                            }
                        }));
                        message.success('Đã cập nhật ghi đè lương!');
                    };

                    // Helper: Xóa toàn bộ override
                    const clearOverride = () => {
                        if (checkLocked()) return;
                        Modal.confirm({
                            title: 'Xóa tất cả điều chỉnh?',
                            content: 'Lương sẽ được tính tự động theo hệ thống chấm công. Thêm ca và điều chỉnh tiền sẽ bị xóa.',
                            okText: 'Xóa điều chỉnh',
                            okType: 'danger',
                            cancelText: 'Hủy',
                            onOk: () => {
                                setPayrollOverrides(prev => {
                                    const next = { ...prev };
                                    delete next[overrideKey];
                                    return next;
                                });
                                // Refresh payslip data
                                setTimeout(() => {
                                    const updated = payrollData.find((pd: any) => pd.id === p.id);
                                    if (updated) setPayslipModal(updated);
                                }, 100);
                                message.success('Đã xóa điều chỉnh — dùng lại dữ liệu tự động!');
                            }
                        });
                    };

                    // Helper: row hiển thị
                    const row = (label: string, value: string, color?: string, sub?: string) => (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '4px 0' }}>
                            <div style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, color: '#555' }}>{label}</Text>
                                {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{sub}</div>}
                            </div>
                            <Text strong style={{ fontSize: 13, color: '#111', whiteSpace: 'nowrap', marginLeft: 16 }}>{value}</Text>
                        </div>
                    );

                    // Helper: editable row - hiển thị giá trị + nút sửa (admin only)
                    // Khi bấm sửa → popup xác nhận tuyệt đối trước khi ghi đè
                    const editableRow = (
                        label: string,
                        autoVal: number,
                        overrideVal: number | undefined,
                        onSave: (val: number) => void,
                        opts?: { suffix?: string; sub?: string; color?: string; step?: number; min?: number; fieldName?: string }
                    ) => {
                        const hasOv = overrideVal != null;
                        const displayVal = hasOv ? overrideVal : autoVal;
                        const handleEditClick = () => {
                            let newVal = displayVal;
                            Modal.confirm({
                                title: `⚠️ Sửa thủ công: ${opts?.fieldName || label}`,
                                icon: <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />,
                                width: 420,
                                content: (
                                    <div style={{ padding: '12px 0' }}>
                                        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#ad6800', marginBottom: 4 }}>⚠️ LƯU Ý QUAN TRỌNG</div>
                                            <div style={{ fontSize: 12, color: '#8c6d1f' }}>
                                                Giá trị hiện tại <b>{autoVal}{opts?.suffix || ''}</b> được tính tự động từ hệ thống chấm công.
                                                Sau khi sửa, giá trị thủ công sẽ <b>ghi đè</b> và không bị thay đổi bởi điểm danh.
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Nhập giá trị mới:</div>
                                        <InputNumber
                                            autoFocus
                                            size="large"
                                            defaultValue={displayVal}
                                            min={opts?.min ?? 0}
                                            step={opts?.step ?? 1}
                                            style={{ width: '100%', fontWeight: 700 }}
                                            onChange={(v) => { newVal = v ?? displayVal; }}
                                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={(v: any) => v.replace(/,/g, '')}
                                            addonAfter={opts?.suffix}
                                        />
                                        <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
                                            Gốc (tự động): <b>{autoVal}{opts?.suffix || ''}</b>
                                        </div>
                                    </div>
                                ),
                                okText: '✅ Xác nhận ghi đè',
                                okType: 'primary',
                                cancelText: 'Hủy',
                                onOk: () => { if (newVal != null) onSave(newVal); },
                            });
                        };
                        return (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Text style={{ fontSize: 13, color: '#555' }}>{label}</Text>
                                        {hasOv && (
                                            <Tooltip title={`Gốc (tự động): ${autoVal}${opts?.suffix || ''}`}>
                                                <Tag style={{ fontSize: 9, padding: '0 4px', lineHeight: '16px', border: '1px solid #ccc', background: '#f0f0f0', color: '#555', cursor: 'help' }}>
                                                    ✏ Đã sửa
                                                </Tag>
                                            </Tooltip>
                                        )}
                                    </div>
                                    {opts?.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{opts.sub}</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Text strong style={{ fontSize: 13, color: hasOv ? '#555' : '#111' }}>
                                        {displayVal}{opts?.suffix || ''}
                                    </Text>
                                    {isAdmin && (
                                        <Button type="text" size="small" icon={<EditOutlined />}
                                            style={{ color: '#8c8c8c', padding: '0 4px' }}
                                            onClick={handleEditClick}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    };

                    const sectionTitle = (label: string, _color?: string, _bg?: string) => (
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: '#94a3b8', marginBottom: 6, marginTop: 2 }}>
                            {label}
                        </div>
                    );

                    return (
                        <div style={{ fontSize: 13, paddingTop: 0 }}>
                            {!payslipPdfDetailOpen && (<>
                                <div className="ps-summary-card">
                                    <div className="ps-summary-brand">
                                        <div className="ps-summary-brand-left">
                                            <BankOutlined className="ps-summary-brand-icon" />
                                            <div>
                                                <div className="ps-summary-brand-name">DBY Software</div>
                                                <div className="ps-summary-brand-sub">Phiếu lương nội bộ</div>
                                            </div>
                                        </div>
                                        <div className="ps-summary-period">{periodLabel}</div>
                                    </div>

                                    <div className="ps-summary-employee">
                                        <div className="ps-summary-avatar">
                                            {p.name.split(' ').map((w: string) => w[0]).slice(-2).join('').toUpperCase()}
                                        </div>
                                        <div className="ps-summary-emp-main">
                                            <div className="ps-summary-name">{p.name}</div>
                                            <div className="ps-summary-tags">
                                                <span className="ps-summary-tag">{p.type === 'Official' ? 'Chính thức' : 'Thời vụ'}</span>
                                                <span className="ps-summary-tag"><CalendarOutlined /> {overviewDateRange[0].format('DD/MM')} - {overviewDateRange[1].format('DD/MM/YYYY')}</span>
                                                {isAdmin && <span className="ps-summary-tag ps-summary-tag-dark"><LockOutlined /> Admin</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="ps-summary-table-wrap">
                                        <table className="ps-summary-table">
                                            <tbody>
                                                <tr>
                                                    <td>
                                                        <span className="ps-summary-row-label">Lương cơ bản</span>
                                                        <span className="ps-summary-row-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                            {p.isHourly ? (
                                                                <>
                                                                    <span>{p.shifts} ca × {fmt(p.salaryPerShift)}/ca</span>
                                                                    {isAdmin && !isCurrentPeriodLocked && (
                                                                        <Button
                                                                            type="text"
                                                                            size="small"
                                                                            icon={<EditOutlined />}
                                                                            style={{ color: '#1890ff', padding: '0 2px', height: 18, lineHeight: '18px' }}
                                                                            onClick={() => {
                                                                                let newTotalShifts = p.shifts;
                                                                                Modal.confirm({
                                                                                    title: 'Sửa số ca làm việc',
                                                                                    icon: <ExclamationCircleOutlined style={{ color: '#1890ff' }} />,
                                                                                    width: 400,
                                                                                    content: (
                                                                                        <div style={{ padding: '12px 0' }}>
                                                                                            <div style={{ background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#0050b3' }}>
                                                                                                Ca tự động (điểm danh): <b>{p.autoShifts} ca</b>
                                                                                                {p.autoShifts !== p.shifts && (
                                                                                                    <span style={{ marginLeft: 8, color: '#fa8c16' }}>
                                                                                                        + {p.shifts - p.autoShifts} ca thủ công
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Tổng số ca làm việc:</div>
                                                                                            <InputNumber
                                                                                                autoFocus
                                                                                                size="large"
                                                                                                min={0}
                                                                                                defaultValue={p.shifts}
                                                                                                style={{ width: '100%', fontWeight: 700 }}
                                                                                                onChange={(v) => { newTotalShifts = v ?? 0; }}
                                                                                                addonAfter="ca"
                                                                                            />
                                                                                            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                                                                                                Mỗi ca = {fmt(p.salaryPerShift)}đ
                                                                                            </div>
                                                                                        </div>
                                                                                    ),
                                                                                    okText: 'Xác nhận',
                                                                                    okType: 'primary',
                                                                                    cancelText: 'Hủy',
                                                                                    onOk: () => {
                                                                                        saveOverride({ extraShifts: newTotalShifts - p.autoShifts });
                                                                                        setTimeout(() => {
                                                                                            const updated = payrollData.find((pd: any) => pd.id === p.id);
                                                                                            if (updated) setPayslipModal(updated);
                                                                                        }, 100);
                                                                                    },
                                                                                });
                                                                            }}
                                                                        />
                                                                    )}
                                                                </>
                                                            ) : 'Theo hợp đồng lao động'}
                                                        </span>
                                                    </td>
                                                    <td>{fmt(p.salaryBase)}</td>
                                                </tr>
                                                <tr>
                                                    <td>
                                                        <span className="ps-summary-row-label">Lương năng suất (Đóng gói)</span>
                                                        <span className="ps-summary-row-note">{p.packTotalUnits || 0} SP × {PACKING_UNIT_PRICE}đ · {p.packOrderCount || 0} đơn</span>
                                                    </td>
                                                    <td className="ps-summary-green">+ {fmt(p.packIncome || 0)}</td>
                                                </tr>
                                                {(p.totalBonus || 0) > 0 && (
                                                    <tr>
                                                        <td>
                                                            <span className="ps-summary-row-label">Thưởng</span>
                                                            <span className="ps-summary-row-note">{empBonuses.length ? `${empBonuses.length} khoản thưởng` : 'Thưởng bổ sung'}</span>
                                                        </td>
                                                        <td className="ps-summary-green">+ {fmt(p.totalBonus || 0)}</td>
                                                    </tr>
                                                )}
                                                {(p.myFines || 0) > 0 && (
                                                    <tr>
                                                        <td>
                                                            <span className="ps-summary-row-label ps-summary-red">Khấu trừ vi phạm</span>
                                                            <span className="ps-summary-row-note">{empFines.length ? `${empFines.length} khoản phạt` : 'Phạt vi phạm nội quy'}</span>
                                                        </td>
                                                        <td className="ps-summary-red">- {fmt(p.myFines || 0)}</td>
                                                    </tr>
                                                )}
                                                {(p.leaveDeduction || 0) > 0 && (
                                                    <tr>
                                                        <td>
                                                            <span className="ps-summary-row-label ps-summary-red">Khấu trừ nghỉ</span>
                                                            <span className="ps-summary-row-note">{p.absentDays || 0} ngày/ca nghỉ đã tính</span>
                                                        </td>
                                                        <td className="ps-summary-red">- {fmt(p.leaveDeduction || 0)}</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    {(isAdmin || p.extraAdjust !== 0) && (
                                        <div className="ps-summary-adjust">
                                            <div>
                                                <div className="ps-summary-adjust-title">Điều chỉnh</div>
                                                <div className="ps-summary-adjust-note">{currentOverride.adjustNote || p.adjustNote || 'Chưa có điều chỉnh'}</div>
                                            </div>
                                            <div className="ps-summary-adjust-actions">
                                                <span>{(currentOverride.extraAdjust || 0) > 0 ? '+' : ''}{fmt(currentOverride.extraAdjust || 0)}</span>
                                                {isAdmin && !isCurrentPeriodLocked && (
                                                    <Button type="text" size="small" icon={<EditOutlined />}
                                                        onClick={() => {
                                                            let newAdjust = currentOverride.extraAdjust ?? 0;
                                                            let newNote = currentOverride.adjustNote || '';
                                                            Modal.confirm({
                                                                title: 'Điều chỉnh lương thủ công',
                                                                icon: <ExclamationCircleOutlined style={{ color: '#fa8c16' }} />,
                                                                width: 420,
                                                                content: (
                                                                    <div style={{ padding: '12px 0' }}>
                                                                        <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                                                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#ad6800', marginBottom: 4 }}>Lưu ý quan trọng</div>
                                                                            <div style={{ fontSize: 12, color: '#8c6d1f' }}>
                                                                                Số dương = <b>cộng thêm tiền</b>, số âm = <b>trừ bớt tiền</b>. Thao tác này ảnh hưởng trực tiếp đến lương thực lĩnh.
                                                                            </div>
                                                                        </div>
                                                                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Số tiền điều chỉnh:</div>
                                                                        <InputNumber
                                                                            autoFocus
                                                                            size="large"
                                                                            defaultValue={currentOverride.extraAdjust ?? 0}
                                                                            step={10000}
                                                                            style={{ width: '100%', fontWeight: 700 }}
                                                                            onChange={(v) => { newAdjust = v ?? 0; }}
                                                                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                                            parser={(v: any) => v.replace(/,/g, '')}
                                                                            addonAfter="đ"
                                                                        />
                                                                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, marginTop: 12 }}>Ghi chú lý do:</div>
                                                                        <Input
                                                                            placeholder="VD: Bù ca thiếu, thưởng thêm..."
                                                                            defaultValue={currentOverride.adjustNote || ''}
                                                                            onChange={e => { newNote = e.target.value; }}
                                                                        />
                                                                    </div>
                                                                ),
                                                                okText: 'Xác nhận điều chỉnh',
                                                                okType: 'primary',
                                                                cancelText: 'Hủy',
                                                                onOk: () => { saveOverride({ extraAdjust: newAdjust, adjustNote: newNote }); },
                                                            });
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="ps-summary-total">
                                        <div>
                                            <div className="ps-summary-total-label"><WalletOutlined /> Thực lĩnh cuối kỳ</div>
                                            <div className="ps-summary-total-formula">
                                                {fmt(p.salaryBase)} + {fmt(p.packIncome || 0)}
                                                {(p.totalBonus || 0) > 0 ? ` + ${fmt(p.totalBonus || 0)}` : ''}
                                                {(p.myFines || 0) > 0 ? ` - ${fmt(p.myFines || 0)}` : ''}
                                                {(p.leaveDeduction || 0) > 0 ? ` - ${fmt(p.leaveDeduction || 0)}` : ''}
                                                {!!p.extraAdjust ? ` ${p.extraAdjust > 0 ? '+' : '-'} ${fmt(Math.abs(p.extraAdjust))}` : ''}
                                            </div>
                                        </div>
                                        <div className="ps-summary-total-amount">{fmt(p.finalSalary)}</div>
                                    </div>
                                </div>
                            </>)}

                            {/* ===== PRINT / DETAIL VIEW ===== */}
                            <div className={payslipPdfDetailOpen ? 'ps-print-view ps-print-view-detail ps-inv-redesign' : 'ps-print-view ps-inv-redesign'}>
                                <div className="ps-inv-container">
                                    <img className="ps-inv-watermark" src="/logo_navbar.png" alt="" aria-hidden="true" />
                                    <div className="ps-inv-header">
                                        <div className="ps-inv-brand">
                                            <img className="ps-inv-brand-logo" src="/logo-ngang.png" alt="DBY Software" />
                                        </div>
                                        <div className="ps-inv-title-group">
                                            <div className="ps-inv-title">Phiếu Lương</div>
                                            <div className="ps-inv-subtitle">
                                                <span>Kỳ thanh toán: <b>{periodLabel}</b></span>
                                                <span>Ngày kết xuất: <b>{issueDate}</b></span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="ps-inv-company">
                                        <div><b>Đơn vị:</b> DBY Software</div>
                                        <div><b>Địa chỉ:</b> Ngõ 80 Đại Linh, Trung Văn, Nam Từ Liêm</div>
                                    </div>

                                    <div className="ps-inv-emp-box">
                                        <div className="ps-inv-emp-item">
                                            <span className="ps-inv-emp-label">Họ và tên nhân viên</span>
                                            <span className="ps-inv-emp-value">{p.name}</span>
                                        </div>
                                        <div className="ps-inv-emp-item">
                                            <span className="ps-inv-emp-label">Mã nhân viên</span>
                                            <span className="ps-inv-emp-value ps-inv-mono">EMP{overviewDateRange[0].format('YYYYMM')}{String(p.id || 0).padStart(2, '0')}</span>
                                        </div>
                                        <div className="ps-inv-emp-item">
                                            <span className="ps-inv-emp-label">Chức vụ / Vị trí</span>
                                            <span className="ps-inv-emp-value">{p.type === 'Official' ? 'Nhân viên chính thức' : 'Nhân viên thời vụ'}</span>
                                        </div>
                                        <div className="ps-inv-emp-item">
                                            <span className="ps-inv-emp-label">Trạng thái tài khoản</span>
                                            <span className="ps-inv-status"><span /> Đang hoạt động</span>
                                        </div>
                                    </div>

                                    <div className="ps-inv-body">
                                        <table className="ps-inv-table">
                                            <thead>
                                                <tr>
                                                    <th>Danh mục thu nhập / Khấu trừ</th>
                                                    <th>Diễn giải / Chi tiết đối soát</th>
                                                    <th className="text-right">Số tiền (VNĐ)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td><span className="ps-inv-item-title">Lương cơ bản</span></td>
                                                    <td className="ps-inv-note">
                                                        {p.type === 'Official'
                                                            ? 'Theo hợp đồng lao động chính thức'
                                                            : `${p.shifts} ca làm việc × ${fmt(p.salaryPerShift)}/ca`}
                                                    </td>
                                                    <td className="text-right">{fmt(p.salaryBase)}</td>
                                                </tr>

                                                <tr>
                                                    <td>
                                                        <span className="ps-inv-row-label">
                                                            <span className="ps-inv-icon ps-inv-icon-green"><TeamOutlined /></span>
                                                            Lương năng suất (Đóng gói)
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <b>{(p.packTotalUnits || 0).toLocaleString('vi-VN')} SP × {PACKING_UNIT_PRICE}đ</b>
                                                        <span className="ps-inv-text-muted">Tổng số: {(p.packOrderCount || 0).toLocaleString('vi-VN')} đơn hàng</span>
                                                    </td>
                                                    <td className="text-right ps-inv-text-green">+{fmt(p.packIncome || 0)}</td>
                                                </tr>

                                                {empBonuses.map((b: any, i: number) => (
                                                    <tr key={`bonus-${i}`}>
                                                        <td>
                                                            <span className="ps-inv-row-label">
                                                                <span className="ps-inv-icon ps-inv-icon-green"><CheckCircleOutlined /></span>
                                                                {b.type || 'Thưởng bổ sung'}
                                                            </span>
                                                        </td>
                                                        <td className="ps-inv-note">{b.detail || 'Khen thưởng / Phụ cấp'}</td>
                                                        <td className="text-right ps-inv-text-green">+{fmt(b.amount)}</td>
                                                    </tr>
                                                ))}

                                                {p.mBonus > 0 && empBonuses.length === 0 && (
                                                    <tr>
                                                        <td>
                                                            <span className="ps-inv-row-label">
                                                                <span className="ps-inv-icon ps-inv-icon-green"><CheckCircleOutlined /></span>
                                                                Thưởng khác
                                                            </span>
                                                        </td>
                                                        <td className="ps-inv-note">Theo quy định công ty</td>
                                                        <td className="text-right ps-inv-text-green">+{fmt(p.mBonus)}</td>
                                                    </tr>
                                                )}

                                                {p.myFines > 0 && (
                                                    <tr className="ps-inv-section-row">
                                                        <td colSpan={3}>Các khoản khấu trừ vi phạm</td>
                                                    </tr>
                                                )}

                                                {p.myFines > 0 && (empFines.length > 0
                                                    ? empFines.map((f: any, i: number) => (
                                                        <tr key={`fine-${i}`}>
                                                            <td>
                                                                <span className="ps-inv-row-label ps-inv-fine-label">
                                                                    <span className="ps-inv-fine-dot">
                                                                        {String(f.type || f.detail || '').toLowerCase().includes('muộn') ? <ClockCircleOutlined /> : <WarningOutlined />}
                                                                    </span>
                                                                    {f.type || 'Phạt vi phạm'}
                                                                </span>
                                                            </td>
                                                            <td>{fineDescription(f)}{fineTime(f) && <span className="ps-inv-text-muted">{fineTime(f)}</span>}</td>
                                                            <td className="text-right ps-inv-text-red">-{fmt(f.amount)}</td>
                                                        </tr>
                                                    ))
                                                    : (
                                                        <tr>
                                                            <td><span className="ps-inv-row-label ps-inv-fine-label"><span className="ps-inv-fine-dot"><WarningOutlined /></span>Phạt vi phạm nội quy</span></td>
                                                            <td className="ps-inv-note">Kỷ luật / Lỗi nghiệp vụ</td>
                                                            <td className="text-right ps-inv-text-red">-{fmt(p.myFines)}</td>
                                                        </tr>
                                                    )
                                                )}

                                                {(p.leaveDeduction || 0) > 0 && (
                                                    <tr>
                                                        <td><span className="ps-inv-row-label ps-inv-fine-label"><span className="ps-inv-fine-dot"><WarningOutlined /></span>Khấu trừ nghỉ</span></td>
                                                        <td className="ps-inv-note">{p.absentDays || 0} ngày/ca nghỉ đã tính</td>
                                                        <td className="text-right ps-inv-text-red">-{fmt(p.leaveDeduction || 0)}</td>
                                                    </tr>
                                                )}

                                                {p.extraAdjust !== 0 && p.extraAdjust != null && (
                                                    <tr className="ps-inv-section-row ps-inv-section-neutral">
                                                        <td className="ps-inv-item-title">{p.adjustNote || 'Điều chỉnh thủ công'}</td>
                                                        <td className="ps-inv-note">Ghi nhận bởi quản trị viên</td>
                                                        <td className={p.extraAdjust > 0 ? 'text-right ps-inv-text-green' : 'text-right ps-inv-text-red'}>
                                                            {p.extraAdjust > 0 ? '+' : '-'}{fmt(Math.abs(p.extraAdjust))}
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="ps-inv-summary">
                                        {(() => {
                                            const empData = employees.find(e => e.id === p.id);
                                            if (isCurrentPeriodLocked && empData?.bankId && empData?.bankAccount) {
                                                const cleanAccount = empData.bankAccount.replace(/\s+/g, '');
                                                const addInfo = encodeURIComponent(`Luong ${overviewDateRange[0].format('MM/YYYY')} ${p.name}`);
                                                const accountName = encodeURIComponent((empData.bankAccountName || p.name).toUpperCase());
                                                const vietQrUrl = `https://img.vietqr.io/image/${empData.bankId}-${cleanAccount}-compact2.png?amount=${Math.round(p.finalSalary)}&addInfo=${addInfo}&accountName=${accountName}`;
                                                return (
                                                    <img src={vietQrUrl} alt="QR chuyển khoản" style={{ width: 220, height: 220, display: 'block', borderRadius: 8, border: '1px solid #dbe3ec' }} />
                                                );
                                            }
                                            return (
                                                <div className="ps-inv-verify">
                                                    <div className="ps-inv-qr">
                                                        <QrcodeOutlined />
                                                    </div>
                                                    <div>
                                                        <div className="ps-inv-verify-title">Xác thực điện tử</div>
                                                        <div className="ps-inv-verify-text">Quét mã QR để đối soát lịch sử đóng gói và chi tiết vi phạm trên DBY Portal.</div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        <div className="ps-inv-totals">
                                            <div className="ps-inv-total-row">
                                                <span>Tổng thu nhập (+)</span>
                                                <span>{fmt(totalEarnings)}</span>
                                            </div>
                                            <div className="ps-inv-total-row">
                                                <span>Tổng khấu trừ (-)</span>
                                                <span className="ps-inv-text-red">-{fmt(totalDeductions)}</span>
                                            </div>
                                            <div className="ps-inv-total-net">
                                                <span>Thực lĩnh cuối kỳ</span>
                                                <span className="amount">{fmt(p.finalSalary)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="ps-inv-footer">
                                        <div className="ps-inv-footer-brand">
                                            <SafetyCertificateOutlined />
                                            Xác nhận bởi: Bộ phận Tài chính & Nhân sự DBY Software
                                        </div>
                                        <div className="ps-inv-footer-brand">
                                            <CheckCircleOutlined />
                                            DBY-SIGN-VERIFIED-{overviewDateRange[0].format('YYYY')}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Footer actions */}
                            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, position: 'sticky', bottom: 0, background: '#fff', paddingTop: 8, paddingBottom: 4, zIndex: 10, borderTop: '1px solid #f0f0f0' }}>
                                <div>
                                    {isAdmin && !isCurrentPeriodLocked && p.hasOverride && (
                                        <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={clearOverride}>
                                            Xóa điều chỉnh
                                        </Button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {payslipPdfDetailOpen ? (
                                        <>
                                            <Button onClick={() => setPayslipPdfDetailOpen(false)}>Quay lại</Button>
                                            {isCurrentPeriodLocked ? (() => {
                                                const periodKey = `${overviewDateRange[0].year()}-${String(overviewDateRange[0].month() + 1).padStart(2, '0')}`;
                                                const sentAt = gmailSentLog[`${p.id}_${periodKey}`];
                                                const sentTime = sentAt ? dayjs(sentAt).format('DD/MM HH:mm') : null;
                                                return sentTime ? (
                                                    <Tooltip title={`Đã gửi lúc ${sentTime} — Bấm để gửi lại`}>
                                                        <Button
                                                            loading={gmailSending}
                                                            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                                                            style={{ borderColor: '#52c41a', color: '#52c41a' }}
                                                            onClick={() => Modal.confirm({
                                                                title: 'Gửi lại phiếu lương?',
                                                                content: `Phiếu đã được gửi lúc ${sentTime}. Bạn có muốn gửi lại không?`,
                                                                okText: 'Gửi lại',
                                                                cancelText: 'Hủy',
                                                                onOk: handleSendPayslipGmail,
                                                            })}
                                                        >
                                                            Đã gửi {sentTime}
                                                        </Button>
                                                    </Tooltip>
                                                ) : (
                                                    <Button loading={gmailSending} onClick={handleSendPayslipGmail}>Gửi Gmail</Button>
                                                );
                                            })() : (
                                                <Tooltip title="Cần Chốt & Khóa bảng lương trước khi gửi Gmail">
                                                    <Button disabled>Gửi Gmail</Button>
                                                </Tooltip>
                                            )}
                                            {isCurrentPeriodLocked ? (
                                                <Button icon={<FileTextOutlined />} loading={pdfExporting} onClick={handleExportPayslipPDF}>Xuất PDF</Button>
                                            ) : (
                                                <Tooltip title="Cần Chốt & Khóa bảng lương trước khi xuất PDF">
                                                    <Button icon={<FileTextOutlined />} disabled>Xuất PDF</Button>
                                                </Tooltip>
                                            )}
                                        </>
                                    ) : (
                                        <Button icon={<EyeOutlined />} onClick={() => setPayslipPdfDetailOpen(true)}>Xem phiếu</Button>
                                    )}
                                    <Button type="primary" onClick={() => { setPayslipModal(null); setPayslipPdfDetailOpen(false); }}>Đóng</Button>
                                </div>
                            </div>

                            {/* Updated info */}
                            {currentOverride.updatedAt && (
                                <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af', textAlign: 'right' }}>
                                    Cập nhật bởi <b>{currentOverride.updatedBy}</b> lúc {dayjs(currentOverride.updatedAt).format('DD/MM/YYYY HH:mm')}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </Modal>

            {/* ===== MODAL: Cấu hình ===== */}
            <Modal
                title={<Space><SettingOutlined style={{ color: '#00ab56' }} /><span style={{ fontWeight: 700 }}>Cấu hình</span></Space>}
                open={configModalOpen}
                onCancel={() => setConfigModalOpen(false)}
                footer={activeConfigTab === 'rules' ? [
                    <Button key="cancel" onClick={() => setConfigModalOpen(false)}>Hủy</Button>,
                    <Button key="ok" type="primary" icon={<SaveOutlined />} onClick={saveConfig}>Lưu cấu hình</Button>,
                ] : [
                    <Button key="close" onClick={() => setConfigModalOpen(false)}>Đóng</Button>,
                ]}
                width={640}
            >
                <Tabs
                    activeKey={activeConfigTab}
                    onChange={setActiveConfigTab}
                    size="small"
                    style={{ marginTop: -8 }}
                    items={[
                        {
                            key: 'rules',
                            label: <span><SettingOutlined /> Quy tắc & Phạt</span>,
                            children: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>

                                    {/* Biên độ miễn phạt */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
                                        <div>
                                            <Text strong style={{ fontSize: 13 }}>Biên độ miễn phạt</Text>
                                            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>— số phút tối đa cho phép đi trễ</Text>
                                        </div>
                                        <InputNumber value={tempConfig.graceMinutes} onChange={v => setTempConfig({ ...tempConfig, graceMinutes: v || 0 })} min={0} max={30} addonAfter="phút" style={{ width: 120 }} />
                                    </div>

                                    {/* Phạt đi muộn: 2 cột song song */}
                                    <div style={{ background: '#fafafa', borderRadius: 10, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
                                        {/* Header */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: '#f0f0f0', padding: '7px 14px', gap: 8 }}>
                                            <Text style={{ fontSize: 11, fontWeight: 700, color: '#595959', textTransform: 'uppercase', letterSpacing: 0.5 }}>Mức phạt đi muộn</Text>
                                            <Text style={{ fontSize: 11, fontWeight: 700, color: '#1677ff', textAlign: 'center' }}>Chính thức</Text>
                                            <Text style={{ fontSize: 11, fontWeight: 700, color: '#fa8c16', textAlign: 'center' }}>Thời vụ</Text>
                                        </div>
                                        {/* Rows */}
                                        {[
                                            { label: '🟡 Nhẹ (6–15 phút)', off: 'officialFineLevel1' as const, sea: 'seasonalFineLevel1' as const },
                                            { label: '🟠 TB (16–30 phút)', off: 'officialFineLevel2' as const, sea: 'seasonalFineLevel2' as const },
                                            { label: '🔴 Nặng (>30 phút)', off: 'officialFineLevel3' as const, sea: 'seasonalFineLevel3' as const },
                                        ].map((row, i) => (
                                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 14px', gap: 8, alignItems: 'center', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
                                                <Text style={{ fontSize: 12, fontWeight: 600 }}>{row.label}</Text>
                                                <InputNumber
                                                    value={tempConfig[row.off]}
                                                    onChange={v => setTempConfig({ ...tempConfig, [row.off]: v || 0 })}
                                                    min={0} step={5000}
                                                    formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                    parser={v => Number(v!.replace(/,/g, '')) as any}
                                                    addonAfter="đ" style={{ width: '100%' }} size="small"
                                                />
                                                <InputNumber
                                                    value={tempConfig[row.sea]}
                                                    onChange={v => setTempConfig({ ...tempConfig, [row.sea]: v || 0 })}
                                                    min={0} step={5000}
                                                    formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                                    parser={v => Number(v!.replace(/,/g, '')) as any}
                                                    addonAfter="đ" style={{ width: '100%' }} size="small"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    {/* Đóng sai đơn */}
                                    <div style={{ background: '#fafafa', borderRadius: 10, border: '1px solid #f0f0f0', overflow: 'hidden' }}>
                                        <div style={{ background: '#f0f0f0', padding: '7px 14px' }}>
                                            <Text style={{ fontSize: 11, fontWeight: 700, color: '#595959', textTransform: 'uppercase', letterSpacing: 0.5 }}><WarningOutlined style={{ marginRight: 4, color: '#fa8c16' }} />Đóng sai đơn</Text>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '10px 14px', gap: 12, background: '#fff', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <Text style={{ fontSize: 11, fontWeight: 700, color: '#1677ff' }}>Chính thức</Text>
                                                <InputNumber value={tempConfig.wrongOrderFineOfficial} onChange={v => setTempConfig({ ...tempConfig, wrongOrderFineOfficial: v || 0 })} min={0} step={5000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={v => Number(v!.replace(/,/g, '')) as any} addonAfter="đ/đơn" style={{ width: '100%' }} size="small" />
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <Text style={{ fontSize: 11, fontWeight: 700, color: '#fa8c16' }}>Thời vụ</Text>
                                                <InputNumber value={tempConfig.wrongOrderFineSeasonal} onChange={v => setTempConfig({ ...tempConfig, wrongOrderFineSeasonal: v || 0 })} min={0} step={5000} formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={v => Number(v!.replace(/,/g, '')) as any} addonAfter="đ/đơn" style={{ width: '100%' }} size="small" />
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            ),
                        },
                        {
                            key: 'employees',
                            label: <span><TeamOutlined /> Nhân viên</span>,
                            children: (
                                <div style={{ marginTop: 4 }}>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                                        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { setEditingEmp(null); empForm.resetFields(); setEmpModalOpen(true); }}>
                                            Thêm nhân viên
                                        </Button>
                                    </div>
                                    <Table
                                        dataSource={employees}
                                        rowKey="id"
                                        pagination={false}
                                        size="small"
                                        scroll={{ x: 'max-content' }}
                                        columns={[
                                            { title: 'Tên', dataIndex: 'name', render: (n) => <Text strong style={{ fontSize: 13 }}>{n}</Text> },
                                            { title: 'Username', dataIndex: 'username', width: 120, render: (u) => <Tag color="blue" style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{u || '—'}</Tag> },
                                            { title: 'HĐ', dataIndex: 'type', width: 95, render: (t) => <Tag color={t === 'Official' ? 'blue' : 'green'} style={{ fontSize: 11 }}>{t === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag> },
                                            { title: 'Đơn giá', dataIndex: 'baseSalary', align: 'right' as const, width: 120, render: (v, r: Employee) => <Text style={{ fontSize: 12 }}>{fmt(v)}{r.isHourly ? '/h' : '/th'}</Text> },
                                            {
                                                title: 'Ngân hàng', key: 'bank', width: 140,
                                                render: (_: any, r: Employee) => r.bankId && r.bankAccount
                                                    ? <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                                                        <Tag color="geekblue" style={{ fontSize: 10, fontWeight: 700 }}>{r.bankId}</Tag>
                                                        <span style={{ fontFamily: 'monospace', color: '#555' }}>{r.bankAccount}</span>
                                                    </div>
                                                    : <Text type="secondary" style={{ fontSize: 11 }}>Chưa có</Text>
                                            },
                                            {
                                                title: '', align: 'center' as const, width: 70,
                                                render: (_: any, record: Employee) => (
                                                    <Space size={4}>
                                                        <Button size="small" type="text" icon={<EditOutlined style={{ color: '#1890ff' }} />} onClick={() => { setEditingEmp(record); empForm.resetFields(); empForm.setFieldsValue({ ...record, username: record.username || '', bankId: record.bankId ?? null, bankAccount: record.bankAccount ?? null, bankAccountName: record.bankAccountName ?? null }); setEmpModalOpen(true); }} />
                                                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => { if (checkLocked()) return; setEmployees(prev => prev.filter(e => e.id !== record.id)); message.success('Đã xóa!'); }} />
                                                    </Space>
                                                )
                                            }
                                        ]}
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            </Modal>

            {/* ===== MODAL: Thêm Thưởng Lẻ ===== */}
            <Modal
                title={<Space><GiftOutlined style={{ color: '#1890ff' }} /><span>{editingBonus ? 'Sửa khoản thưởng' : 'Thêm khoản thưởng'}</span></Space>}
                open={bonusModalOpen}
                onCancel={() => { setBonusModalOpen(false); setEditingBonus(null); bonusForm.resetFields(); }}
                onOk={handleAddBonus}
                okText={editingBonus ? "Lưu thay đổi" : "Thêm thưởng"}
                cancelText="Hủy"
                okButtonProps={{ icon: <PlusOutlined /> }}
                width={480}
            >
                <Form form={bonusForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="empId" label="Nhân viên" rules={[{ required: true, message: 'Vui lòng chọn nhân viên' }]}>
                        <Select placeholder="Chọn nhân viên nhận thưởng" size="large">
                            {employees.map(emp => (
                                <Select.Option key={emp.id} value={emp.id}>
                                    {emp.name} ({emp.type === 'Official' ? 'Chính thức' : 'Thời vụ'})
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item name="bonusKind" label="Loại thưởng" initialValue="manual" rules={[{ required: true, message: 'Chọn loại thưởng' }]}>
                        <Select size="large">
                            <Select.Option value="manual">Thưởng lẻ</Select.Option>
                            <Select.Option value="overtime">Thưởng tăng ca</Select.Option>
                        </Select>
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, cur) => prev.bonusKind !== cur.bonusKind}>
                        {({ getFieldValue }) => getFieldValue('bonusKind') === 'overtime' ? (
                            <>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: 8,
                                    marginBottom: 12,
                                }}>
                                    <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fff7e6', border: '1px solid #ffd591' }}>
                                        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Giờ đầu</Text>
                                        <Text strong style={{ color: '#d46b08' }}>{fmt(OVERTIME_FIRST_HOUR_RATE)}đ</Text>
                                    </div>
                                    <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fff7e6', border: '1px solid #ffd591' }}>
                                        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Giờ tiếp theo</Text>
                                        <Text strong style={{ color: '#d46b08' }}>{fmt(OVERTIME_NEXT_HOUR_RATE)}đ/giờ</Text>
                                    </div>
                                </div>
                                <Row gutter={12}>
                                    <Col span={24}>
                                    <Form.Item name="overtimeHours" label="Số giờ tăng ca" rules={[{ required: true, message: 'Nhập số giờ' }]}>
                                        <InputNumber
                                            style={{ width: '100%' }}
                                            size="large"
                                            min={0.25}
                                            step={0.25}
                                            placeholder="VD: 2.5"
                                        />
                                    </Form.Item>
                                    </Col>
                                </Row>
                            </>
                        ) : null}
                    </Form.Item>
                    <Form.Item name="amount" label="Số tiền thưởng (VNĐ)" rules={[{ required: true, message: 'Nhập số tiền' }]}>
                        <InputNumber
                            style={{ width: '100%' }}
                            size="large"
                            min={1000}
                            step={10000}
                            disabled={bonusKind === 'overtime'}
                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={v => Number(v!.replace(/,/g, '')) as any}
                            placeholder={bonusKind === 'overtime' ? 'Tự tính theo giờ x đơn giá' : 'VD: 200,000'}
                        />
                    </Form.Item>
                    <Form.Item name="detail" label="Lý do thưởng" rules={[{ required: true, message: 'Nhập lý do' }]}>
                        <Input.TextArea rows={2} placeholder={bonusKind === 'overtime' ? 'VD: Tăng ca xử lý đơn gấp ngày 28/03' : 'VD: Hoàn thành KPI xuất sắc tháng 03'} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* ===== MODAL: Thu/Chi Quỹ (2 modal dựa trên type) ===== */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                            background: fundModalType === 'in' ? '#f6ffed' : '#fff1f0',
                            border: `2px solid ${fundModalType === 'in' ? '#b7eb8f' : '#ffccc7'}`,
                        }}>
                            {fundModalType === 'in' ? '💰' : '💸'}
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 16, color: fundModalType === 'in' ? '#00ab56' : '#ff4d4f' }}>
                                {fundModalType === 'in' ? 'THU VÀO Quỹ Nội Bộ' : 'CHI RA từ Quỹ Nội Bộ'}
                            </div>
                            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>Ghi nhận giao dịch quỹ team</div>
                        </div>
                    </div>
                }
                open={!!fundModalType}
                onCancel={() => { setFundModalType(null); fundForm.resetFields(); }}
                onOk={handleAddFundTx}
                okText={fundModalType === 'in' ? '✅ Xác nhận Thu' : '✅ Xác nhận Chi'}
                cancelText="Hủy"
                okButtonProps={{
                    icon: <PlusOutlined />,
                    style: fundModalType === 'in'
                        ? { background: '#00ab56', borderColor: '#00ab56', fontWeight: 700 }
                        : { fontWeight: 700 },
                    danger: fundModalType === 'out',
                }}
                width={480}
            >
                {/* Banner nhắc loại giao dịch */}
                <div style={{
                    padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                    background: fundModalType === 'in' ? '#f6ffed' : '#fff1f0',
                    border: `1px solid ${fundModalType === 'in' ? '#b7eb8f' : '#ffccc7'}`,
                    color: fundModalType === 'in' ? '#00ab56' : '#ff4d4f',
                    fontWeight: 600, fontSize: 13, textAlign: 'center',
                }}>
                    {fundModalType === 'in'
                        ? '📥 Bạn đang ghi nhận khoản THU VÀO quỹ'
                        : '📤 Bạn đang ghi nhận khoản CHI RA từ quỹ'}
                </div>
                <Form form={fundForm} layout="vertical">
                    <Form.Item name="note" label="Nội dung" rules={[{ required: true, message: 'Nhập nội dung giao dịch' }]}>
                        <Input size="large" placeholder={fundModalType === 'in' ? 'VD: Đóng quỹ tháng 3 (Team)' : 'VD: Mua nước uống cho team'} />
                    </Form.Item>
                    <Form.Item name="amount" label="Số tiền (VNĐ)" rules={[{ required: true, message: 'Nhập số tiền' }]}>
                        <InputNumber
                            style={{ width: '100%' }}
                            size="large"
                            min={1000}
                            step={10000}
                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={v => Number(v!.replace(/,/g, '')) as any}
                            placeholder="VD: 120,000"
                        />
                    </Form.Item>
                    <Form.Item name="person" label="Người thực hiện" rules={[{ required: true }]}>
                        <Input size="large" readOnly style={{ background: '#f5f5f5', cursor: 'default', color: '#595959', fontWeight: 600 }} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* ===== MODAL: Thêm Phạt Thủ Công ===== */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                            background: '#fff1f0', border: '2px solid #ffccc7',
                        }}>
                            ⚠️
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 16, color: '#ff4d4f' }}>{editingFine ? 'Sửa khoản phạt' : 'Thêm Phạt Thủ Công'}</div>
                            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>{editingFine ? 'Cập nhật khoản phạt đang ghi nhận trong bảng công' : 'Ghi nhận khoản phạt ngoài hệ thống tự động'}</div>
                        </div>
                    </div>
                }
                open={fineModalOpen}
                onCancel={() => { setFineModalOpen(false); setFineTypeDropdownOpen(false); setEditingFine(null); fineForm.resetFields(); }}
                onOk={handleAddFine}
                okText={editingFine ? 'Lưu thay đổi' : 'Xác nhận phạt'}
                cancelText="Hủy"
                okButtonProps={{ icon: <PlusOutlined />, danger: true, style: { fontWeight: 700 } }}
                width={520}
            >
                <Form form={fineForm} layout="vertical">
                    <Form.Item noStyle shouldUpdate={(p, c) => p.date !== c.date}>
                        {({ getFieldValue }) => {
                            const d = getFieldValue('date');
                            const monthLabel = d ? d.format('MM/YYYY') : '...';
                            return (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 8, marginBottom: 16, marginTop: 8,
                                    background: '#fff1f0', border: '1px solid #ffccc7',
                                    color: '#cf1322', fontWeight: 600, fontSize: 12, textAlign: 'center',
                                }}>
                                    ⚠️ Khoản phạt này sẽ được khấu trừ vào lương tháng <b>{monthLabel}</b>
                                </div>
                            );
                        }}
                    </Form.Item>
                    <Form.Item name="date" label="Ngày vi phạm" rules={[{ required: true, message: 'Chọn ngày vi phạm' }]}>
                        <DatePicker
                            style={{ width: '100%' }}
                            size="large"
                            format="DD/MM/YYYY"
                            placeholder="Chọn ngày vi phạm"
                        />
                    </Form.Item>
                    <Form.Item name="empId" label="Nhân viên bị phạt" rules={[{ required: true, message: 'Vui lòng chọn nhân viên' }]}>
                        <Select placeholder="Chọn nhân viên" size="large">
                            {employees.map(emp => (
                                <Select.Option key={emp.id} value={emp.id}>
                                    {emp.name} ({emp.type === 'Official' ? 'Chính thức' : 'Thời vụ'})
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item name="type" label="Loại lỗi vi phạm" rules={[{ required: true, message: 'Chọn hoặc nhập loại lỗi' }]}>
                        <Select
                            placeholder="Chọn loại lỗi"
                            size="large"
                            mode="tags"
                            maxCount={1}
                            open={fineTypeDropdownOpen}
                            onDropdownVisibleChange={setFineTypeDropdownOpen}
                            onSelect={() => setFineTypeDropdownOpen(false)}
                        >
                            <Select.Option value="Đi muộn">Đi muộn</Select.Option>
                            <Select.Option value="Đóng gói sai">Đóng gói sai</Select.Option>
                            <Select.Option value="Vi phạm nội quy">Vi phạm nội quy</Select.Option>
                            <Select.Option value="Hàng hư hỏng">Hàng hư hỏng</Select.Option>
                            <Select.Option value="Mất đồ / Thất thoát">Mất đồ / Thất thoát</Select.Option>
                            <Select.Option value="Khác">Khác</Select.Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="amount" label="Số tiền phạt (VNĐ)" rules={[{ required: true, message: 'Nhập số tiền phạt' }]}>
                        <InputNumber
                            style={{ width: '100%' }}
                            size="large"
                            min={1000}
                            step={5000}
                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={v => Number(v!.replace(/,/g, '')) as any}
                            placeholder="VD: 30,000"
                        />
                    </Form.Item>
                    <Form.Item name="detail" label="Mô tả chi tiết" rules={[{ required: true, message: 'Nhập mô tả chi tiết vi phạm' }]}>
                        <Input.TextArea rows={2} placeholder="VD: Sáng 28/03 — Muộn 25 phút, không có lý do" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* ===== MODAL: Quản lý Nhân sự ===== */}
            <Modal
                title={editingEmp ? "✏️ Sửa Nhân Sự" : "➕ Thêm Nhân Sự"}
                open={empModalOpen}
                onCancel={() => setEmpModalOpen(false)}
                onOk={handleSaveEmp}
                okText="Lưu Nhân Sự" cancelText="Hủy"
                destroyOnHidden
            >
                <Form form={empForm} layout="vertical">
                    <Row gutter={16}>
                        <Col span={14}>
                            <Form.Item name="name" label="Họ và tên" rules={[{ required: true, message: 'Nhập tên nhân viên' }]}>
                                <Input size="large" placeholder="VD: Nguyễn Văn A" />
                            </Form.Item>
                        </Col>
                        <Col span={10}>
                            <Form.Item name="username" label="Username (hệ thống)" rules={[{ required: true, message: 'Chọn hoặc nhập username' }]}>
                                <Select
                                    size="large"
                                    showSearch
                                    placeholder="Chọn username"
                                    style={{ fontFamily: 'monospace' }}
                                    optionFilterProp="children"
                                    notFoundContent="Không tìm thấy"
                                >
                                    {systemUsernames.map(u => (
                                        <Select.Option key={u} value={u}>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{u}</span>
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="type" label="Loại hợp đồng/ca" rules={[{ required: true }]}>
                                <Select size="large">
                                    <Select.Option value="Official">Chính thức (tháng)</Select.Option>
                                    <Select.Option value="Seasonal">Thời vụ (theo giờ)</Select.Option>
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
                                {({ getFieldValue }) => (
                                    <Form.Item name="baseSalary" label={getFieldValue('type') === 'Seasonal' ? 'Đơn giá / giờ' : 'Lương / tháng'} rules={[{ required: true }]}>
                                        <InputNumber size="large" style={{ width: '100%' }} min={0} step={1000}
                                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={v => Number(v!.replace(/,/g, '')) as any}
                                        />
                                    </Form.Item>
                                )}
                            </Form.Item>
                        </Col>
                    </Row>
                    <Divider style={{ margin: '8px 0 12px' }}><Text type="secondary" style={{ fontSize: 11 }}>Tài khoản ngân hàng (QR chuyển lương)</Text></Divider>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="bankId" label="Ngân hàng">
                                <Select size="large" placeholder="Chọn ngân hàng" allowClear showSearch optionFilterProp="label">
                                    {VIET_QR_BANKS.map(b => (
                                        <Select.Option key={b.value} value={b.value} label={b.label}>{b.label}</Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="bankAccount" label="Số tài khoản">
                                <Input size="large" placeholder="VD: 1234567890" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row>
                        <Col span={24}>
                            <Form.Item name="bankAccountName" label="Tên chủ tài khoản">
                                <Input size="large" placeholder="VD: NGUYEN VAN A" style={{ textTransform: 'uppercase' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            {/* ===== MODAL: Bulk Send Gmail Progress ===== */}
            {bulkSendProgress && (
                <Modal
                    title={<Space><SendOutlined style={{ color: '#1677ff' }} /><span>Gửi Gmail hàng loạt</span></Space>}
                    open={true}
                    closable={!bulkSendProgress.running}
                    maskClosable={false}
                    onCancel={() => setBulkSendProgress(null)}
                    footer={bulkSendProgress.running ? null : (
                        <Button type="primary" onClick={() => setBulkSendProgress(null)}>Đóng</Button>
                    )}
                    width={480}
                >
                    {bulkSendProgress.running ? (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                            <Spin size="large" />
                            <div style={{ marginTop: 16, fontSize: 15, fontWeight: 600 }}>
                                Đang gửi {bulkSendProgress.current}/{bulkSendProgress.total}
                            </div>
                            <div style={{ marginTop: 8, color: '#888', fontSize: 13 }}>{bulkSendProgress.currentName}</div>
                        </div>
                    ) : (
                        <div>
                            <div style={{ marginBottom: 16, textAlign: 'center' }}>
                                <Text style={{ fontSize: 15 }}>
                                    Đã gửi xong:{' '}
                                    <strong style={{ color: '#52c41a' }}>{bulkSendProgress.results.filter(r => r.success).length}</strong> thành công,{' '}
                                    <strong style={{ color: '#ff4d4f' }}>{bulkSendProgress.results.filter(r => !r.success).length}</strong> thất bại
                                </Text>
                            </div>
                            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                                {bulkSendProgress.results.map((r, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                                        {r.success
                                            ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                                            : <MinusCircleOutlined style={{ color: '#ff4d4f' }} />
                                        }
                                        <span style={{ flex: 1 }}>{r.name}</span>
                                        {!r.success && <Text type="danger" style={{ fontSize: 12 }}>{r.error}</Text>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
