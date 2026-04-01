import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
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
    WalletOutlined,
    HistoryOutlined,
    ProfileOutlined,
    DeleteOutlined,
    EditOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

// ===== TYPES =====
interface Employee {
    id: number;
    name: string;
    username: string;
    type: 'Official' | 'Seasonal';
    baseSalary: number;
    isHourly?: boolean;
}

interface ShiftStatus {
    am: 0 | 1 | 2;
    pm: 0 | 1 | 2;
}

interface FineRecord {
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string; // ISO string — ngày tạo phạt
}

interface BonusRecord {
    id: string;
    empId: number;
    type: string;
    detail: string;
    amount: number;
    date?: string; // ISO string — ngày tạo thưởng
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

const manualBonuses: BonusRecord[] = []; // Xóa mock — thưởng nhập tay qua extraBonuses

const weekDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const attendanceMatrix: ShiftStatus[][] = [
    [{ am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 2, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }],
    [{ am: 1, pm: 1 }, { am: 1, pm: 2 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }, { am: 1, pm: 1 }],
    [{ am: 1, pm: 0 }, { am: 1, pm: 0 }, { am: 1, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 0 }, { am: 1, pm: 0 }, { am: 0, pm: 0 }],
    [{ am: 0, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 0 }, { am: 1, pm: 1 }, { am: 0, pm: 1 }, { am: 1, pm: 1 }, { am: 0, pm: 0 }],
];

const attendanceLogs: AttendanceLog[] = []; // Xóa mock — dùng liveAttendanceLogs từ ZKTeco

const fundTransactions: FundTransaction[] = []; // Xóa mock — giao dịch thực nhập tay

// ===== HELPERS =====
const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v)) + ' đ';

// Tính tổng số lượng sản phẩm (theo SKU cha) trong đơn hàng
// SKU format: {prefix}-{code} e.g. "20-5DUNI-TRANG" → prefix 20 = 20 sản phẩm
// Combo 20 gói x1 = 20 SP × 20đ = 400đ
// CB- (combo mix) SKU: parse prefix tương tự hoặc tính từ combo components
function calcPacksFromItems(items: PackingOrderItem[]): number {
    let totalPacks = 0;
    items.forEach(item => {
        const sku = (item.sku || '').toUpperCase();
        // Đọc prefix số từ SKU (e.g. "20-5DUNI-TRANG" → 20)
        const prefixMatch = sku.match(/^(\d+)-/);
        const packCount = prefixMatch ? parseInt(prefixMatch[1], 10) : 1;
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

// ===== PAYROLL CALCULATION — Cơ chế: Ai đóng gói hưởng 100% =====
function calculatePayroll(
    activeFines: FineRecord[],
    packingData: { level1Units: number; level10Units: number },
    employeesList: Employee[],
    bonusesData: BonusRecord[],
    liveLogs: any[],
    monthNum: number,
    yearNum: number,
    orderLogs: PackingOrderLog[]
) {
    const STANDARD_WORK_DAYS = 26;
    const HOURS_PER_SHIFT = 4;
    const unitPrice = PACKING_UNIT_PRICE; // 20đ/SP
    const totalPackValue_100 = (packingData.level1Units + packingData.level10Units) * unitPrice;

    return employeesList.map((emp, idx) => {
        const empLogs = liveLogs.filter((l: any) => {
            if (!l.time || l.empId !== emp.id) return false;
            const d = new Date(l.time.replace(' ', 'T'));
            return d.getMonth() + 1 === monthNum && d.getFullYear() === yearNum;
        });
        let shifts = 0;
        let absentDays = 0;
        if (empLogs.length > 0) {
            const shiftSet = new Set(empLogs.map((l: any) => (l.time || '').substring(0, 10) + '-' + l.shift));
            shifts = shiftSet.size;
            absentDays = Math.max(0, (STANDARD_WORK_DAYS * 2 - shifts)) / 2;
        } else {
            shifts = STANDARD_WORK_DAYS * 2;
            absentDays = 0;
        }

        const leaveDeduction = emp.isHourly ? 0 : (absentDays * (emp.baseSalary / STANDARD_WORK_DAYS));
        const salaryBase = emp.isHourly
            ? (shifts * HOURS_PER_SHIFT * emp.baseSalary)
            : (emp.baseSalary - leaveDeduction);

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

        const myFines = activeFines.filter(f => f.empId === emp.id).reduce((sum, f) => sum + f.amount, 0);

        // Nhân viên bị phạt KHÔNG được nhận phần chia từ pool phạt
        const finedEmpIds = new Set(activeFines.map(f => f.empId));
        const hasOwnFine = finedEmpIds.has(emp.id);
        let fineShare = 0;
        if (!hasOwnFine) {
            const eligibleCount = employeesList.filter(e => !finedEmpIds.has(e.id)).length;
            if (eligibleCount > 0) {
                activeFines.forEach(f => {
                    fineShare += f.amount / eligibleCount;
                });
            }
        }

        const mBonus = bonusesData.filter(b => b.empId === emp.id).reduce((sum, b) => sum + b.amount, 0);
        const totalBonus = fineShare + mBonus;
        const finalSalary = salaryBase + packIncome + totalBonus - myFines;
        return {
            ...emp, shifts, absentDays, salaryBase, packIncome, totalPackValue_100,
            fineShare, mBonus, myFines, totalBonus, finalSalary, leaveDeduction,
            packOrderCount, packTotalUnits,
        };
    });
}

// ===== PILL COMPONENT =====
const ShiftPill = ({ label, status }: { label: string; status: 0 | 1 | 2 }) => {
    const config = {
        0: { bg: '#f5f5f5', border: '#e8e8e8', color: '#bfbfbf', icon: <MinusCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Nghỉ' },
        1: { bg: '#f6ffed', border: '#b7eb8f', color: '#52c41a', icon: <CheckCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Đúng giờ' },
        2: { bg: '#fff7e6', border: '#ffd591', color: '#fa8c16', icon: <ClockCircleOutlined style={{ fontSize: 10 }} />, tooltip: 'Đi muộn' },
    };
    const c = config[status];
    return (
        <Tooltip title={`${label}: ${c.tooltip}`}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                padding: '2px 6px', borderRadius: 5,
                background: c.bg, color: c.color, border: `1px solid ${c.border}`,
                cursor: 'default', letterSpacing: 0.2, whiteSpace: 'nowrap',
            }}>
                <span>{label}</span>
                {c.icon}
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

// ===============================================
// ===== MAIN COMPONENT =====
// ===============================================
export default function Attendance() {
    const currentUser = useCurrentUser();
    const [configModalOpen, setConfigModalOpen] = useState(false);
    const [activeConfigTab, setActiveConfigTab] = useState('rules');
    const [payslipModal, setPayslipModal] = useState<any>(null);
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

    const [employees, setEmployees] = useState<Employee[]>(initialEmployees);

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
    const [bonusForm] = Form.useForm();

    // === State cho phạt thủ công ===
    const [extraFines, setExtraFines] = useState<FineRecord[]>([]);
    const [fineAuditLog, setFineAuditLog] = useState<FineAuditLog[]>([]);

    // === State cho danh sách kỳ đã chốt ===
    const [lockedPeriods, setLockedPeriods] = useState<LockedPeriod[]>([]);

    const [isDbLoaded, setIsDbLoaded] = useState(false);
    const [systemUsernames, setSystemUsernames] = useState<string[]>([]);

    // 1. Tải dữ liệu từ DB lúc mở component
    useEffect(() => {
        const loadData = async () => {
            try {
                const api = (window as any).electronAPI;
                const rs = await api.appConfig.get('attendanceData');
                if (rs && rs.success && rs.data) {
                    const d = rs.data;
                    if (d.config) {
                        setConfig(d.config);
                        setTempConfig(d.config);
                    }
                    if (d.employees) {
                        // Merge username từ initialEmployees cho records cũ chưa có
                        const merged = d.employees.map((emp: any) => {
                            if (!emp.username) {
                                const initial = initialEmployees.find(ie => ie.id === emp.id);
                                return { ...emp, username: initial?.username || '' };
                            }
                            return emp;
                        });
                        setEmployees(merged);
                    }
                    if (d.bonusAuditLog) setBonusAuditLog(d.bonusAuditLog);
                    if (d.extraBonuses) setExtraBonuses(d.extraBonuses);
                    if (d.extraFundTx) setExtraFundTx(d.extraFundTx);
                    if (d.fundAuditLog) setFundAuditLog(d.fundAuditLog);
                    if (d.extraFines) setExtraFines(d.extraFines);
                    if (d.fineAuditLog) setFineAuditLog(d.fineAuditLog);
                    if (d.lockedPeriods) setLockedPeriods(d.lockedPeriods);
                }
                // Fetch danh sách username hệ thống
                try {
                    const usersRes = await api.users.getAll();
                    if (usersRes.success && usersRes.data) {
                        const names = usersRes.data
                            .map((u: any) => u.username)
                            .filter((u: string) => u && u.toLowerCase() !== 'admin');
                        setSystemUsernames(names);
                    }
                } catch (_) {}
            } catch (err) {
                console.error('Lỗi tải dữ liệu chấm công từ DB:', err);
            } finally {
                setIsDbLoaded(true);
            }
        };
        loadData();
    }, []);

    // Ref lưu snapshot data mới nhất để flush khi reload/đóng app
    const pendingSaveRef = useRef<object | null>(null);

    // 2. Lưu tự động khi có thay đổi state với Debounce
    useEffect(() => {
        if (!isDbLoaded) return; // Không lưu đè lúc chưa tải xong

        const snapshot = { config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineAuditLog, lockedPeriods };
        pendingSaveRef.current = snapshot;

        const saveData = async () => {
            try {
                const api = (window as any).electronAPI;
                await api.appConfig.set('attendanceData', snapshot);
                pendingSaveRef.current = null;
            } catch (err) {
                console.error('Lỗi lưu dữ liệu chấm công vào DB:', err);
            }
        };

        const timer = setTimeout(saveData, 500); // Đợi 500ms thao tác cuối rồi mới save
        return () => clearTimeout(timer);
    }, [config, employees, bonusAuditLog, extraBonuses, extraFundTx, fundAuditLog, extraFines, fineAuditLog, lockedPeriods, isDbLoaded]);

    // Flush save ngay lập tức khi reload hoặc đóng app
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (pendingSaveRef.current) {
                const api = (window as any).electronAPI;
                // Dùng sendSync để đảm bảo lưu xong trước khi đóng
                try { api.appConfig.set('attendanceData', pendingSaveRef.current); } catch {}
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    const [fineModalOpen, setFineModalOpen] = useState(false);
    const [fineForm] = Form.useForm();
    const [fundForm] = Form.useForm();
    const [empForm] = Form.useForm();
    const [empModalOpen, setEmpModalOpen] = useState(false);
    const [empListModalOpen, setEmpListModalOpen] = useState(false);
    const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

    // State cho lọc kỳ lương Tổng quát — khai báo sớm để loadPackingOrders dùng được
    const [overviewDateRange, setOverviewDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
        dayjs().startOf('month'),
        dayjs().endOf('month'),
    ]);

    const [packingOrderLogsData, setPackingOrderLogsData] = useState<PackingOrderLog[]>([]);
    const [packingDateRange, setPackingDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

    useEffect(() => {
        loadPackingOrders();
    }, []);

    const loadPackingRef = useRef(false);
    const loadPackingOrders = async (since?: string) => {
        if (loadPackingRef.current) { console.log('[PACKING] Skipped (already loading)'); return; }
        loadPackingRef.current = true;
        console.log('[PACKING DEBUG] === loadPackingOrders CALLED ===');
        try {
            const api = (window as any).electronAPI;
            console.log('[PACKING DEBUG] electronAPI exists?', !!api, 'posOrder?', !!api?.posOrder, 'exportOrders?', !!api?.exportOrders, 'ecommerceExports?', !!api?.ecommerceExports);
            const sinceVal = since || overviewDateRange[0].startOf('day').toISOString();
            
            // Timeout wrapper: nếu API không trả kết quả trong 10s → bỏ qua
            const withTimeout = (p: Promise<any>, label: string, ms = 10000) =>
                Promise.race([
                    p.then(r => { console.log(`[PACKING] ✅ ${label}:`, r?.data?.length || 0); return r; }),
                    new Promise((_, reject) => setTimeout(() => reject(`${label} TIMEOUT (${ms}ms)`), ms))
                ]).catch(e => { console.warn(`[PACKING] ⚠️ ${label} failed:`, e); return { success: false, data: [] }; });

            // Chỉ lấy TMDT — POS và Xuất hàng không tính vào nhật ký đóng gói
            const ecRes = await withTimeout(api.ecommerceExports.getAll({ since: sinceVal }), 'Ecom');
            console.log('[PACKING] Ecom done:', ecRes?.data?.length);

            const getPlatform = (_source: string, customer: string) => {
                const c = (customer || '').toLowerCase();
                if (c.includes('shopee')) return 'Shopee';
                if (c.includes('tiktok')) return 'TikTok';
                return 'Web';
            };

            const unified: PackingOrderLog[] = [];

            const processOrder = (order: any, source: string) => {
                let items: any[] = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);
                
                // 🔍 DEBUG: Log raw order data
                console.log(`[PACKING DEBUG] Source: ${source}, Order #${order.id}, items type: ${typeof order.items}, items count: ${items.length}`, 
                    items.length > 0 ? { firstItem: items[0], allKeys: items.length > 0 ? Object.keys(items[0]) : [] } : 'NO ITEMS');
                
                // Lấy TẤT CẢ sản phẩm (không filter theo SKU cụ thể nữa)
                const validItems = items.filter(it => {
                    const sku = (it.variantSku || it.sku || it.variant_sku || it.product_sku || it.SKU || it.Sku || '');
                    return sku && sku.trim() !== ''; // Chỉ bỏ qua item không có SKU
                });

                // 🔍 DEBUG: Log filtered results
                console.log(`[PACKING DEBUG] Order #${order.id}: ${items.length} items → ${validItems.length} valid`, 
                    { packer: order.pickedBy || order.createdBy || order.userName });

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
                    // Packer: dùng pickedBy (string), fallback userName (string) — KHÔNG dùng createdBy (integer ID)
                    packer: (typeof order.pickedBy === 'string' && order.pickedBy) ? order.pickedBy
                          : (typeof order.userName === 'string' && order.userName) ? order.userName
                          : 'Không ghi nhận',
                    items: mappedItems,
                    totalSKU,
                    status: order.status === 'completed' ? 'completed' : 'issue'
                });
            };

            // Chỉ tính TMDT completed
            if (ecRes.success && ecRes.data) ecRes.data.filter((o: any) => o.status === 'completed').forEach((o: any) => processOrder(o, 'tmdt'));

            console.log('[PACKING] Done. Ecom:', ecRes.success ? (ecRes.data?.length || 0) : 'FAIL', '| Unified:', unified.length);

            setPackingOrderLogsData(unified.sort((a, b) => dayjs(b.timestamp).unix() - dayjs(a.timestamp).unix()));
        } catch (error) {
            console.error('Lỗi tải dữ liệu đơn hàng:', error);
            message.error('Không thể tải dữ liệu đơn đóng gói!');
        } finally {
            loadPackingRef.current = false;
        }
    };

    // === State cho điểm danh online ===
    const [liveAttendanceLogs, setLiveAttendanceLogs] = useState<any[]>([]);

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
    const [selectedMonth, setSelectedMonth] = useState(dayjs().month() + 1);
    const [selectedYear, setSelectedYear] = useState(dayjs().year());
    const monthNames = ['', 'Tháng 01', 'Tháng 02', 'Tháng 03', 'Tháng 04', 'Tháng 05', 'Tháng 06', 'Tháng 07', 'Tháng 08', 'Tháng 09', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    const goMonth = (dir: -1 | 1) => {
        let m = selectedMonth + dir;
        let y = selectedYear;
        if (m < 1) { m = 12; y--; }
        if (m > 12) { m = 1; y++; }
        setSelectedMonth(m); setSelectedYear(y);
    };

    // Reload packing orders khi đổi kỳ
    useEffect(() => {
        loadPackingOrders(overviewDateRange[0].startOf('day').toISOString());
    }, [overviewDateRange]);

    // Gộp finesData gốc + extraFines
    const allFines = useMemo(() => [...finesData, ...extraFines], [extraFines]);

    // Helper: lọc theo overviewDateRange
    const inOverviewRange = (dateStr?: string) => {
        if (!dateStr) return true; // record cũ không có date → luôn hiện
        const d = dayjs(dateStr);
        return d.isAfter(overviewDateRange[0].startOf('day').subtract(1, 'ms'))
            && d.isBefore(overviewDateRange[1].endOf('day').add(1, 'ms'));
    };

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

    const payrollData = useMemo(() => calculatePayroll(
        overviewFines, overviewWareHousePacking, employees, overviewBonuses,
        liveAttendanceLogs, overviewDateRange[0].month() + 1, overviewDateRange[0].year(), overviewPackingLogs
    ), [overviewFines, overviewWareHousePacking, employees, overviewBonuses, liveAttendanceLogs, overviewDateRange, overviewPackingLogs]);

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

    // Employee attendance stats
    const employeeStats = useMemo(() => {
        return employees.map((emp, idx) => {
            let lateCount = 0, absentCount = 0, shiftCount = 0;
            attendanceMatrix[idx].forEach((d, dayIdx) => {
                if (d.am === 2) lateCount++;
                if (d.pm === 2) lateCount++;
                if (dayIdx < 6) {
                    if (d.am === 0) absentCount += 0.5;
                    if (d.pm === 0) absentCount += 0.5;
                }
                if (d.am > 0) shiftCount++;
                if (d.pm > 0) shiftCount++;
            });
            return { ...emp, lateCount, absentCount, shiftCount };
        });
    }, []);

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
        if (isCurrentPeriodLocked && currentUser !== 'admin') {
            message.error('Kỳ này đã bị khóa. Chỉ admin mới có thể thực hiện thao tác này!');
            return true;
        }
        return false;
    };

    // === Thêm/Sửa Thưởng Lẻ handler ===
    const handleAddBonus = useCallback(() => {
        if (checkLocked()) return;
        bonusForm.validateFields().then(values => {
            const now = new Date().toLocaleString('vi-VN');
            if (editingBonus) {
                const before = { ...editingBonus };
                const updated: BonusRecord = { ...editingBonus, empId: values.empId, detail: values.detail, amount: values.amount };
                setExtraBonuses(prev => prev.map(b => b.id === editingBonus.id ? updated : b));
                setBonusAuditLog(prev => [...prev, {
                    id: 'log-' + Date.now(),
                    bonusId: editingBonus.id,
                    action: 'edit' as const,
                    timestamp: now,
                    before,
                    after: updated,
                    note: 'Sửa thưởng: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(values.amount),
                }]);
                message.success('Đã cập nhật thưởng!');
            } else {
                const newId = 'bonus-' + Date.now();
                const newBonus: BonusRecord = { id: newId, empId: values.empId, type: 'Thưởng lẻ (Admin)', detail: values.detail, amount: values.amount, date: new Date().toISOString() };
                setExtraBonuses(prev => [...prev, newBonus]);
                setBonusAuditLog(prev => [...prev, {
                    id: 'log-' + Date.now(),
                    bonusId: newId,
                    action: 'create' as const,
                    timestamp: now,
                    after: newBonus,
                    note: 'Thêm thưởng: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(values.amount),
                }]);
                message.success('Đã thêm thưởng!');
            }
            setBonusModalOpen(false);
            setEditingBonus(null);
            bonusForm.resetFields();
        });
    }, [bonusForm, editingBonus, employees]);

    const handleDeleteBonus = useCallback((bonus: BonusRecord) => {
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
    }, [employees]);

    // === Thêm Phạt Thủ Công handler ===
    const handleAddFine = useCallback(() => {
        if (checkLocked()) return;
        fineForm.validateFields().then(values => {
            const fineType = Array.isArray(values.type) ? values.type[0] : values.type;
            const newFine: FineRecord = {
                empId: values.empId,
                type: fineType,
                detail: values.detail,
                amount: values.amount,
                date: new Date().toISOString(),
            };
            setExtraFines(prev => [...prev, newFine]);
            
            const now = new Date().toLocaleString('vi-VN');
            setFineAuditLog(prev => [...prev, {
                id: 'flog-' + Date.now(),
                action: 'create',
                timestamp: now,
                after: newFine,
                note: 'Thêm phạt: ' + (employees.find(e => e.id === values.empId)?.name || '') + ' — ' + fmt(values.amount) + ' — "' + values.detail + '"',
            }]);

            setFineModalOpen(false);
            fineForm.resetFields();
            message.success(`Đã thêm phạt ${fmt(values.amount)} cho ${employees.find(e => e.id === values.empId)?.name} (Đã lưu lịch sử)`);
        });
    }, [fineForm, employees]);

    // === Xóa Phạt Thủ Công handler ===
    const handleDeleteFine = useCallback((fineIndex: number) => {
        if (checkLocked()) return;
        const fine = extraFines[fineIndex];
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
            onOk: () => {
                setExtraFines(prev => prev.filter((_, i) => i !== fineIndex));
                
                const now = new Date().toLocaleString('vi-VN');
                setFineAuditLog(prev => [...prev, {
                    id: 'flog-' + Date.now(),
                    action: 'delete',
                    timestamp: now,
                    before: fine,
                    note: 'Xóa khoản phạt: ' + (employees.find(e => e.id === fine.empId)?.name || '') + ' — ' + fmt(fine.amount) + ' — "' + fine.detail + '"',
                }]);
                
                message.success('Đã xóa khoản phạt (Đã lưu lịch sử)!');
            },
        });
    }, [extraFines, employees]);

    // === Thêm/Sửa Giao dịch Quỹ handler ===
    const handleAddFundTx = useCallback(() => {
        if (checkLocked()) return;
        const activeType = editingFundTx ? editingFundTx.type : fundModalType;
        if (!activeType && !editingFundTx) return;
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
    }, [fundForm, fundModalType, editingFundTx]);

    // === Xóa Giao dịch Quỹ (có audit) ===
    const handleDeleteFundTx = useCallback((tx: FundTransaction) => {
        if (checkLocked()) return;
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
    }, []);

    // === Mở modal sửa ===
    const handleEditFundTx = useCallback((tx: FundTransaction) => {
        if (checkLocked()) return;
        setEditingFundTx(tx);
        fundForm.setFieldsValue({ note: tx.note, amount: tx.amount, person: tx.person });
        setFundModalType(tx.type); // mở modal đúng loại
    }, [fundForm]);




    const saveConfig = () => { setConfig({ ...tempConfig }); setConfigModalOpen(false); message.success('Đã lưu cấu hình!'); };

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
                    <p style={{ color: '#ff4d4f', fontSize: 13 }}>Sau khi chốt, chỉ admin mới có thể sửa đổi dữ liệu kỳ này.</p>
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
    const renderOverview = () => (
        <div className="att-table-card">
            <Table
                dataSource={payrollData.map(d => ({ ...d, key: d.id }))}
                pagination={false}
                size="middle"
                scroll={{ x: 900 }}
                onRow={(record) => ({
                    onClick: () => setPayslipModal(record),
                    style: { cursor: 'pointer' },
                })}
                columns={[
                    {
                        title: 'Nhân viên', dataIndex: 'name', key: 'name', width: 200,
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
                        title: 'Lương CB/CA', dataIndex: 'salaryBase', key: 'base', align: 'right' as const,
                        render: (v: number) => (
                            <span className="att-money-gray">{fmt(v)}</span>
                        ),
                    },
                    {
                        title: 'Đóng gói', dataIndex: 'packIncome', key: 'pack', align: 'right' as const,
                        render: (v: number, r: any) => <Tooltip title={`${r.packTotalUnits || 0} SP × ${PACKING_UNIT_PRICE}đ`}><span className="att-money-emerald">+ {fmt(v)}</span></Tooltip>,
                    },
                    {
                        title: 'Thưởng', dataIndex: 'totalBonus', key: 'bonus', align: 'right' as const,
                        render: (v: number) => <span className="att-money-emerald">+ {fmt(v)}</span>,
                    },
                    {
                        title: 'Phạt & Nghỉ', dataIndex: 'myFines', key: 'fine', align: 'right' as const,
                        render: (v: number) => <span className="att-money-red">{v > 0 ? `- ${fmt(v)}` : `${fmt(0)}`}</span>,
                    },
                    {
                        title: 'Thực Lãnh', dataIndex: 'finalSalary', key: 'final', align: 'right' as const,
                        render: (v: number) => <span className="att-money-final">{fmt(v)}</span>,
                    },
                ]}
            />
        </div>
    );

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

                {/* Hero Banner */}
                <div className="att-hero-banner">
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        <div className="att-hero-label">📦 LƯƠNG ĐÓNG GÓI {overviewDateRange[0].format('DD/MM')} — {overviewDateRange[1].format('DD/MM/YYYY')}</div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                            <div className="att-hero-value">{filteredTotalUnits.toLocaleString()} Đơn</div>
                            <div style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
                                <Tag color="blue" style={{ border: 'none', background: 'rgba(255,255,255,0.25)', color: 'white', fontWeight: 700 }}>{filteredTotalSP.toLocaleString()} SP × {unitPrice}đ</Tag>
                            </div>
                        </div>
                    </div>
                    <div className="att-hero-box">
                        <div className="att-hero-box-label">Tổng quỹ thưởng</div>
                        <div className="att-hero-box-value">{fmt(filteredPackValue)}</div>
                    </div>
                </div>

                {/* KPI Cards (Gộp) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <Card size="small" style={{ borderTop: '3px solid #1890ff' }}>
                        <Statistic
                            title={<Text type="secondary" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Tổng sản phẩm</Text>}
                            value={filteredTotalSP}
                            suffix="SP"
                            valueStyle={{ color: '#1890ff', fontWeight: 800, fontSize: 24 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>× {unitPrice.toLocaleString()} đ = {fmt(filteredTotalSP * unitPrice)}</Text>
                    </Card>
                    <Card size="small" style={{ borderTop: '3px solid #722ed1' }}>
                        <Statistic
                            title={<Text type="secondary" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Đơn giá</Text>}
                            value={unitPrice}
                            suffix="đ/SP"
                            valueStyle={{ color: '#722ed1', fontWeight: 800, fontSize: 24 }}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>Áp dụng cho toàn bộ sản phẩm</Text>
                    </Card>
                    <Card size="small" style={{ borderTop: '3px solid #10b981' }}>
                        <Statistic title={<Text type="secondary" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Thực tế đã đóng</Text>} value={totalOrders} suffix="đơn" valueStyle={{ color: '#10b981', fontWeight: 800, fontSize: 24 }} />
                        <Text type="secondary" style={{ fontSize: 11, visibility: 'hidden' }}>&nbsp;</Text>
                    </Card>
                    <Card size="small" style={{ borderTop: '3px solid #fa8c16' }}>
                        <Statistic title={<Text type="secondary" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Nhân sự đóng gói</Text>} value={uniquePackers} suffix="người" valueStyle={{ color: '#fa8c16', fontWeight: 800, fontSize: 24 }} />
                        <Text type="secondary" style={{ fontSize: 11, visibility: 'hidden' }}>&nbsp;</Text>
                    </Card>
                </div>

                {/* Distribution Table */}
                <Card
                    bodyStyle={{ padding: 0 }}
                    style={{ borderTop: '3px solid #00ab56' }}
                    title={<Space><TeamOutlined style={{ color: '#00ab56' }} /><Text strong>Bảng xếp hạng đóng gói</Text><Tag color="green" style={{ fontSize: 10, fontWeight: 700 }}>AI ĐÓNG NGƯỜI ĐÓ HƯỞNG</Tag></Space>}
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
                            { title: 'Nhân viên', dataIndex: 'name', key: 'name', render: (n: string, r: any) => (
                                <div>
                                    <Text strong style={{ color: r._rank <= 3 && r.packOrderCount > 0 ? '#000' : '#595959', fontSize: r._rank <= 3 && r.packOrderCount > 0 ? 15 : 14 }}>{n}</Text>
                                    <div><Tag color={r._rank <= 3 && r.packOrderCount > 0 ? "blue" : "default"} style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, border: 'none', background: r._rank <= 3 && r.packOrderCount > 0 ? '#e6f7ff' : '#f5f5f5' }}>@{r.username || '—'}</Tag></div>
                                </div>
                            ) },
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
                            { title: <Text strong style={{ color: '#00ab56', fontStyle: 'italic' }}>Thu nhập cá nhân</Text>, dataIndex: 'packIncome', key: 'income', align: 'right' as const, render: (v: number, r: any) => <Text strong style={{ color: v > 0 ? '#00ab56' : '#d9d9d9', fontStyle: 'italic', fontSize: r._rank <= 3 && r.packOrderCount > 0 ? 18 : 16 }}>{fmt(v || 0)}</Text> },
                        ]}
                        summary={() => {
                            const totalPackCount = payrollData.reduce((s, d) => s + (d.packOrderCount || 0), 0);
                            const totalIncome = payrollData.reduce((s, d) => s + (d.packIncome || 0), 0);
                            return (
                                <Table.Summary.Row style={{ background: '#f0fdf4' }}>
                                    <Table.Summary.Cell index={0} colSpan={3}><Text strong style={{ color: '#15803d', fontSize: 12, paddingLeft: 16 }}>TỔNG CỘNG</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={3} align="center"><Text strong style={{ color: '#1890ff', fontSize: 18 }}>{totalPackCount} đơn</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: '#00ab56', fontSize: 18 }}>{fmt(totalIncome)}</Text></Table.Summary.Cell>
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
        
        const bonusTabsItems = payrollData.map(emp => {
            const empBonusRows: any[] = [];
            empBonusRows.push({ key: `pool-${emp.id}`, name: emp.name, source: 'Pool Chia Phạt', sourceColor: 'orange', detail: 'Chia từ quỹ phạt của các thành viên vi phạm', amount: emp.fineShare, isManual: false });
            extraBonuses.filter(b => b.empId === emp.id).forEach((b) => {
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
                                    { title: 'Nguồn tiền', dataIndex: 'source', key: 'src', width: 160, render: (s: string, r: any) => <Tag color={r.sourceColor} style={{ fontWeight: 800, fontSize: 11, textTransform: 'uppercase', padding: '2px 8px' }}>{s}</Tag> },
                                    { title: 'Nội dung', dataIndex: 'detail', key: 'detail', render: (d: string) => <Text style={{ fontStyle: 'italic', color: '#4b5563' }}>{d}</Text> },
                                    { title: <Text style={{ color: '#1890ff', fontWeight: 700 }}>SỐ TIỀN NHẬN</Text>, dataIndex: 'amount', key: 'amount', width: 160, align: 'right' as const, render: (v: number) => <Text strong style={{ color: '#1890ff', fontSize: 15 }}>+ {fmt(v)}</Text> },
                                    {
                                        title: '', key: 'actions', width: 100, align: 'center' as const,
                                        render: (_: any, r: any) => r.isManual ? (
                                            <Space size={8}>
                                                <Tooltip title="Sửa">
                                                    <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => {
                                                        setEditingBonus(r.bonusRef);
                                                        bonusForm.setFieldsValue({ empId: r.bonusRef.empId, amount: r.bonusRef.amount, detail: r.bonusRef.detail });
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
                    <Button type="primary" icon={<PlusOutlined />} style={{ fontWeight: 700, borderRadius: 8, height: 38, background: 'linear-gradient(to right, #1890ff, #36cfc9)', border: 'none', boxShadow: '0 4px 10px rgba(24,144,255,0.3)' }} onClick={() => { setEditingBonus(null); bonusForm.resetFields(); setBonusModalOpen(true); }}>Thêm thưởng thủ công</Button>
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
                            defaultActiveKey={payrollData[0] ? String(payrollData[0].id) : "1"}
                            items={bonusTabsItems}
                            type="line"
                            tabBarStyle={{ margin: 0, border: 'none' }}
                            animated={{ inkBar: true, tabPane: true }}
                        />
                    </div>
                </Card>
                {bonusAuditLog.length > 0 && (
                    <Card
                        bodyStyle={{ padding: 0 }}
                        style={{ borderTop: '3px solid #faad14' }}
                        title={<Space><HistoryOutlined style={{ color: '#faad14' }} /><Text strong>Lịch sử chỉnh sửa thưởng</Text><Tag color="gold">{bonusAuditLog.length} thao tác</Tag></Space>}
                    >
                        <Table
                            dataSource={[...bonusAuditLog].reverse().map(l => ({ ...l, key: l.id }))}
                            pagination={bonusAuditLog.length > 5 ? { pageSize: 5, size: 'small' } : false}
                            size="small"
                            columns={[
                                { title: 'Thời gian', dataIndex: 'timestamp', key: 'ts', width: 150, render: (t: string) => <Text type="secondary" style={{ fontSize: 11 }}>{t}</Text> },
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
        const combinedFines = [
            ...finesData.map((f, i) => ({ ...f, key: `base-${i}`, empName: employees.find(e => e.id === f.empId)?.name, isManual: false, manualIndex: -1 })),
            ...extraFines.map((f, i) => ({ ...f, key: `manual-${i}`, empName: employees.find(e => e.id === f.empId)?.name, isManual: true, manualIndex: i })),
        ];
        const totalFineAmount = combinedFines.reduce((sum, f) => sum + f.amount, 0);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Title level={4} style={{ margin: 0, color: '#ff4d4f' }}>Khấu trừ & Phạt</Title>
                        <Tag color="error" style={{ fontWeight: 800, fontSize: 13, padding: '2px 12px' }}>{combinedFines.length} khoản</Tag>
                    </div>
                    <Button
                        type="primary"
                        danger
                        icon={<PlusOutlined />}
                        onClick={() => setFineModalOpen(true)}
                        style={{ fontWeight: 700 }}
                    >
                        Thêm phạt thủ công
                    </Button>
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
                        <Text strong style={{ color: '#cf1322', fontSize: 13 }}>Tổng khấu trừ tháng này</Text>
                    </div>
                    <Text strong style={{ color: '#cf1322', fontSize: 18 }}>- {fmt(totalFineAmount)}</Text>
                </div>

                <Card bodyStyle={{ padding: 0 }} style={{ borderTop: '3px solid #ff4d4f' }}>
                    <Table
                        dataSource={combinedFines}
                        pagination={false}
                        size="middle"
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
                                title: 'Chi tiết', dataIndex: 'detail', key: 'detail',
                                render: (d: string) => <Text strong style={{ color: '#595959' }}>{d}</Text>,
                            },
                            {
                                title: 'Nguồn', key: 'source', width: 100, align: 'center' as const,
                                render: (_: any, record: any) => (
                                    record.isManual
                                        ? <Tag color="orange" style={{ fontWeight: 700, fontSize: 10 }}>THỦ CÔNG</Tag>
                                        : <Tag style={{ fontWeight: 700, fontSize: 10, color: '#8c8c8c' }}>HỆ THỐNG</Tag>
                                ),
                            },
                            {
                                title: <Text style={{ color: '#ff4d4f' }}>Số tiền trừ</Text>,
                                dataIndex: 'amount', key: 'amount', width: 140, align: 'right' as const,
                                render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>- {fmt(v)}</Text>,
                            },
                            {
                                title: '', key: 'actions', width: 60, align: 'center' as const,
                                render: (_: any, record: any) => {
                                    if (!record.isManual) return null;
                                    return (
                                        <Tooltip title="Xóa phạt">
                                            <Button
                                                type="text"
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined style={{ fontSize: 14 }} />}
                                                onClick={() => handleDeleteFine(record.manualIndex)}
                                            />
                                        </Tooltip>
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

    // ============================================
    // TAB 5: ĐIỂM DANH & LỊCH SỬ
    // ============================================
    const matrixColumns = useMemo(() => [
        {
            title: 'Nhân viên', dataIndex: 'name', key: 'name', width: 130,
            render: (name: string) => <Text strong style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{name}</Text>,
        },
        ...weekDays.map((day, dayIdx) => ({
            title: (
                <div style={{ textAlign: 'center' as const }}>
                    <div style={{ fontWeight: 800, fontSize: 11, color: dayIdx === 6 ? '#bfbfbf' : (dayIdx === 4 ? '#00ab56' : '#595959') }}>{day}</div>
                    {dayIdx === 6 && <div style={{ fontSize: 8, color: '#bfbfbf', fontWeight: 600 }}>(Nghỉ)</div>}
                </div>
            ),
            key: `day-${dayIdx}`, align: 'center' as const,
            onHeaderCell: () => ({ style: { background: dayIdx === 6 ? '#fafafa' : undefined, borderLeft: dayIdx === 6 ? '2px solid #f0f0f0' : undefined } }),
            onCell: () => ({ style: { background: dayIdx === 6 ? '#fafafa' : undefined, borderLeft: dayIdx === 6 ? '2px solid #f0f0f0' : undefined } }),
            render: (_: any, __: any, rowIdx: number) => {
                const d = attendanceMatrix[rowIdx][dayIdx];
                if (dayIdx === 6 && d.am === 0 && d.pm === 0) return <SundayRestCell />;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <ShiftPill label="Sáng" status={d.am} />
                        <ShiftPill label="Chiều" status={d.pm} />
                    </div>
                );
            },
        })),
        {
            title: <div style={{ textAlign: 'center', fontSize: 11 }}>Tổng ca</div>, key: 'total', width: 60, align: 'center' as const,
            render: (_: any, __: any, rowIdx: number) => {
                const stat = employeeStats[rowIdx];
                return (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#262626' }}>{stat.shiftCount}</div>
                        <Text type="secondary" style={{ fontSize: 9, fontWeight: 700 }}>CA LÀM</Text>
                    </div>
                );
            },
        },
    ], [employeeStats]);

    const renderAttendance = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Filters */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="att-month-picker">
                    <Button className="att-month-btn" icon={<LeftOutlined />} onClick={() => goMonth(-1)}>{monthNames[selectedMonth === 1 ? 12 : selectedMonth - 1]}</Button>
                    <Button className="att-month-btn att-month-btn-active" icon={<CalendarOutlined />}>{monthNames[selectedMonth]}/{selectedYear}</Button>
                    <Button className="att-month-btn" onClick={() => goMonth(1)}>{monthNames[selectedMonth === 12 ? 1 : selectedMonth + 1]} <RightOutlined /></Button>
                </div>
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
                <Table
                    className="att-matrix-table"
                    dataSource={employees.map((emp, idx) => ({ key: emp.id, name: emp.name, idx }))}
                    columns={matrixColumns}
                    pagination={false}
                    size="small"
                    bordered
                    tableLayout="fixed"
                />
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

            {/* Lịch sử Log Điểm danh */}
            <Card
                title={<Space><ClockCircleOutlined style={{ color: '#00ab56' }} /><Text strong>Nhật ký Điểm danh</Text></Space>}
                bodyStyle={{ padding: 0 }}
                style={{ borderTop: '3px solid #00ab56' }}
            >
                <Table
                    dataSource={(liveAttendanceLogs.length > 0 ? liveAttendanceLogs : attendanceLogs).map((log, idx) => ({ ...log, key: idx }))}
                    pagination={{ pageSize: 8, size: 'small' }}
                    size="small"
                    columns={[
                        { title: 'Ngày', dataIndex: 'time', key: 'date', width: 90, render: (t: string) => { const p = t?.split(' ')?.[0]?.split('-'); return p ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>{p[2]}/{p[1]}</Text> : null; } },
                        { title: 'Nhân viên', dataIndex: 'empId', key: 'emp', width: 160, render: (id: number, r: any) => <Text strong>{employees.find(e => e.id === id)?.name || r.name || r.empNameFallback || `ID: ${id}`}</Text> },
                        { title: 'Ca', dataIndex: 'shift', key: 'shift', width: 80, render: (s: string) => <Tag color={s === 'Sáng' ? 'blue' : 'purple'} style={{ fontWeight: 700 }}>{s}</Tag> },
                        { title: 'Giờ chấm', dataIndex: 'time', key: 'time', width: 80, render: (t: string) => <Text strong>{t?.split(' ')?.[1]?.substring(0, 5)}</Text> },
                        { title: 'Trạng thái', dataIndex: 'status', key: 'status', width: 120, render: (s: string) => <Tag icon={s?.includes('Muộn') ? <ClockCircleOutlined /> : <CheckCircleOutlined />} color={s?.includes('Muộn') ? 'warning' : 'success'} style={{ fontWeight: 700, fontSize: 11 }}>{s}</Tag> },
                    ]}
                />
            </Card>
        </div>
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
                                    const isEditable = extraFundTx.some(t => t.id === record.id);
                                    if (!isEditable) return null;
                                    return (
                                        <Space size={4} style={{ whiteSpace: 'nowrap' }}>
                                            <Tooltip title="Sửa">
                                                <Button type="text" size="small" icon={<EditOutlined style={{ color: '#1890ff' }} />} onClick={() => handleEditFundTx(record)} />
                                            </Tooltip>
                                            <Tooltip title="Xóa">
                                                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => { Modal.confirm({ title: 'Xóa giao dịch?', okText: 'Xóa', okType: 'danger', cancelText: 'Hủy', onOk: () => handleDeleteFundTx(record) }); }} />
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
                                                                <Text strong style={{color: '#475569'}}>{log.oldData.note}</Text> — 
                                                                <Text strong style={{color: '#475569', marginLeft: 4}}>{fmt(log.oldData.amount || 0)}</Text>
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
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingEmp(null); empForm.resetFields(); setEmpModalOpen(true); }}>
                        Thêm Nhân Sự
                    </Button>
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
                            render: (_, record) => (
                                <Space>
                                    <Button size="small" type="text" icon={<EditOutlined style={{color: '#1890ff'}}/>} onClick={() => {
                                        setEditingEmp(record);
                                        empForm.setFieldsValue({
                                            ...record,
                                            username: record.username || ''
                                        });
                                        setEmpModalOpen(true);
                                    }} />
                                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => {
                                        setEmployees(prev => prev.filter(e => e.id !== record.id));
                                        message.success('Đã xóa nhân viên!');
                                    }} />
                                </Space>
                            )
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
                isHourly: values.type === 'Seasonal'
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
                    <DatePicker.RangePicker
                        value={overviewDateRange}
                        onChange={(dates) => {
                            if (dates && dates[0] && dates[1]) {
                                setOverviewDateRange([dates[0], dates[1]]);
                            }
                        }}
                        format="DD/MM/YYYY"
                        allowClear={false}
                        style={{ borderRadius: 8 }}
                        placeholder={['Từ ngày', 'Đến ngày']}
                    />
                    <Button className="att-btn-config" icon={<SettingOutlined />} onClick={openConfigModal}>Cấu hình</Button>
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
                onCancel={() => setPayslipModal(null)}
                footer={[
                    <Button key="print" onClick={() => window.print()} icon={<FileTextOutlined />}>In Phiếu</Button>,
                    <Button key="close" type="primary" onClick={() => setPayslipModal(null)}>Đóng</Button>,
                ]}
                width={480}
            >
                {payslipModal && (() => {
                    const p = payslipModal;
                    const empFines = overviewFines.filter(f => f.empId === p.id);
                    const empBonuses = overviewBonuses.filter(b => b.empId === p.id);
                    const row = (label: string, value: string, color?: string, sub?: string) => (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0' }}>
                            <div>
                                <Text style={{ fontSize: 13, color: '#595959' }}>{label}</Text>
                                {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{sub}</div>}
                            </div>
                            <Text strong style={{ fontSize: 13, color: color || '#1f2937', whiteSpace: 'nowrap', marginLeft: 16 }}>{value}</Text>
                        </div>
                    );
                    const sectionTitle = (label: string) => (
                        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#9ca3af', padding: '10px 0 4px' }}>{label}</div>
                    );
                    return (
                        <div style={{ fontSize: 13 }}>
                            {/* Header */}
                            <div style={{ textAlign: 'center', padding: '8px 0 16px', borderBottom: '1px dashed #e5e7eb' }}>
                                <div style={{ fontSize: 20, fontWeight: 900, color: '#1f2937' }}>{p.name}</div>
                                <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center', gap: 8 }}>
                                    <Tag color={p.type === 'Official' ? 'blue' : 'orange'}>{p.type === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag>
                                    <Tag color="default">{overviewDateRange[0].format('DD/MM')} — {overviewDateRange[1].format('DD/MM/YYYY')}</Tag>
                                </div>
                            </div>

                            {/* 1. Lương cơ bản */}
                            {sectionTitle('① Lương cơ bản')}
                            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '8px 12px' }}>
                                {p.isHourly ? (
                                    row('Lương theo giờ', `${fmt(p.salaryBase)}`, '#1f2937',
                                        `${p.shifts} ca × 4 giờ × ${fmt(p.baseSalary)}/giờ`)
                                ) : (
                                    row('Lương cơ bản', `${fmt(p.baseSalary)}`, '#1f2937',
                                        `${p.absentDays > 0 ? `Đủ công ${26 - p.absentDays}/${26} ngày` : 'Đủ công 26/26 ngày'}`)
                                )}
                                {!p.isHourly && p.leaveDeduction > 0 &&
                                    row(`Trừ nghỉ không phép`, `- ${fmt(p.leaveDeduction)}`, '#d97706',
                                        `${p.absentDays} ngày × ${fmt(p.baseSalary / 26)}/ngày`)
                                }
                                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                                    <Text style={{ fontSize: 12, fontWeight: 700 }}>Thực nhận lương CB</Text>
                                    <Text strong style={{ color: '#1f2937' }}>{fmt(p.salaryBase)}</Text>
                                </div>
                            </div>

                            {/* 2. Đóng gói */}
                            {sectionTitle('② Thu nhập đóng gói')}
                            <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 12px', border: '1px solid #bbf7d0' }}>
                                {row('Đóng gói sản phẩm', `+ ${fmt(p.packIncome)}`, '#059669',
                                    `${p.packTotalUnits || 0} SP × ${PACKING_UNIT_PRICE}đ (${p.packOrderCount || 0} đơn)`)}
                            </div>

                            {/* 3. Thưởng */}
                            {(p.fineShare > 0 || p.mBonus > 0 || empBonuses.length > 0) && (<>
                                {sectionTitle('③ Thưởng')}
                                <div style={{ background: '#eff6ff', borderRadius: 8, padding: '8px 12px', border: '1px solid #bfdbfe' }}>
                                    {p.fineShare > 0 && row('Pool chia phạt', `+ ${fmt(p.fineShare)}`, '#1d4ed8', 'Chia từ quỹ phạt thành viên vi phạm')}
                                    {empBonuses.map((b, i) => row(b.detail || 'Thưởng lẻ', `+ ${fmt(b.amount)}`, '#1d4ed8', `Admin — ${b.type}`))}
                                    {p.mBonus > 0 && empBonuses.length === 0 && row('Thưởng lẻ (Admin)', `+ ${fmt(p.mBonus)}`, '#1d4ed8')}
                                </div>
                            </>)}

                            {/* 4. Phạt */}
                            {p.myFines > 0 && (<>
                                {sectionTitle('④ Khấu trừ')}
                                <div style={{ background: '#fff1f0', borderRadius: 8, padding: '8px 12px', border: '1px solid #fecaca' }}>
                                    {empFines.length > 0
                                        ? empFines.map((f, i) => row(f.type, `- ${fmt(f.amount)}`, '#dc2626', f.detail))
                                        : row('Phạt & Khấu trừ', `- ${fmt(p.myFines)}`, '#dc2626')
                                    }
                                </div>
                            </>)}

                            {/* Tổng */}
                            <div style={{ marginTop: 16, padding: '14px 16px', background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', borderRadius: 10, border: '1px solid #6ee7b7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#065f46' }}>Thực lĩnh</div>
                                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                        {fmt(p.salaryBase)} + {fmt(p.packIncome)} + {fmt(p.totalBonus)} − {fmt(p.myFines)}
                                    </div>
                                </div>
                                <div style={{ fontSize: 26, fontWeight: 900, color: '#059669' }}>{fmt(p.finalSalary)}</div>
                            </div>
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
                            { label: '🟠 TB (16–30 phút)',  off: 'officialFineLevel2' as const, sea: 'seasonalFineLevel2' as const },
                            { label: '🔴 Nặng (>30 phút)',  off: 'officialFineLevel3' as const, sea: 'seasonalFineLevel3' as const },
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
                                        columns={[
                                            { title: 'Tên', dataIndex: 'name', render: (n) => <Text strong style={{ fontSize: 13 }}>{n}</Text> },
                                            { title: 'Username', dataIndex: 'username', width: 120, render: (u) => <Tag color="blue" style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 11 }}>{u || '—'}</Tag> },
                                            { title: 'HĐ', dataIndex: 'type', width: 95, render: (t) => <Tag color={t === 'Official' ? 'blue' : 'green'} style={{ fontSize: 11 }}>{t === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag> },
                                            { title: 'Đơn giá', dataIndex: 'baseSalary', align: 'right', width: 120, render: (v, r: Employee) => <Text style={{ fontSize: 12 }}>{fmt(v)}{r.isHourly ? '/h' : '/th'}</Text> },
                                            {
                                                title: '', align: 'center', width: 70,
                                                render: (_: any, record: Employee) => (
                                                    <Space size={4}>
                                                        <Button size="small" type="text" icon={<EditOutlined style={{ color: '#1890ff' }} />} onClick={() => { setEditingEmp(record); empForm.setFieldsValue({ ...record, username: record.username || '' }); setEmpModalOpen(true); }} />
                                                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => { setEmployees(prev => prev.filter(e => e.id !== record.id)); message.success('Đã xóa!'); }} />
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
                title={<Space><GiftOutlined style={{ color: '#1890ff' }} /><span>{editingBonus ? 'Sửa Thưởng Lẻ' : 'Thêm Thưởng Lẻ (Thủ công)'}</span></Space>}
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
                    <Form.Item name="amount" label="Số tiền thưởng (VNĐ)" rules={[{ required: true, message: 'Nhập số tiền' }]}>
                        <InputNumber
                            style={{ width: '100%' }}
                            size="large"
                            min={1000}
                            step={10000}
                            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={v => Number(v!.replace(/,/g, '')) as any}
                            placeholder="VD: 200,000"
                        />
                    </Form.Item>
                    <Form.Item name="detail" label="Lý do thưởng" rules={[{ required: true, message: 'Nhập lý do' }]}>
                        <Input.TextArea rows={2} placeholder="VD: Hoàn thành KPI xuất sắc tháng 03" />
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
                            <div style={{ fontWeight: 800, fontSize: 16, color: '#ff4d4f' }}>Thêm Phạt Thủ Công</div>
                            <div style={{ fontSize: 12, color: '#8c8c8c', fontWeight: 400 }}>Ghi nhận khoản phạt ngoài hệ thống tự động</div>
                        </div>
                    </div>
                }
                open={fineModalOpen}
                onCancel={() => { setFineModalOpen(false); fineForm.resetFields(); }}
                onOk={handleAddFine}
                okText="Xác nhận phạt"
                cancelText="Hủy"
                okButtonProps={{ icon: <PlusOutlined />, danger: true, style: { fontWeight: 700 } }}
                width={520}
            >
                <div style={{
                    padding: '10px 14px', borderRadius: 8, marginBottom: 16, marginTop: 8,
                    background: '#fff1f0', border: '1px solid #ffccc7',
                    color: '#cf1322', fontWeight: 600, fontSize: 12, textAlign: 'center',
                }}>
                    ⚠️ Khoản phạt này sẽ được khấu trừ trực tiếp vào lương nhân viên tháng hiện tại
                </div>
                <Form form={fineForm} layout="vertical">
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
                        <Select placeholder="Chọn loại lỗi" size="large" mode="tags" maxCount={1}>
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
                destroyOnClose
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
                </Form>
            </Modal>
        </div>
    );
}
