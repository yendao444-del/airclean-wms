import { useState, useEffect, useRef } from 'react';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    Select,
    Switch,
    message,
    Space,
    Typography,
    DatePicker,
    Tag,
    Upload,
    Dropdown,
    Tabs,
    Spin,
    Tooltip,
    Avatar,
    Alert,
} from 'antd';
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    UploadOutlined,
    FormOutlined,
    FileExcelOutlined,
    MoreOutlined,
    SettingOutlined,
    BarcodeOutlined,
    ScanOutlined,
    SearchOutlined,
    SyncOutlined,
    ClockCircleOutlined,
    CustomerServiceOutlined,
    CheckCircleOutlined,
    FilterOutlined,
    UserAddOutlined,
    SwapOutlined,
    CommentOutlined,
    DownloadOutlined,
    CloseOutlined,
    InboxOutlined,
    HistoryOutlined,
    EyeOutlined,
    CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import * as XLSX from 'xlsx';
import './Returns.css';

dayjs.extend(customParseFormat);

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const RETURN_SLA_HOURS = 5 * 24;
const RETURN_POLICY_NOTICE_START = dayjs('2026-08-23T00:00:00');
const RETURN_POLICY_NOTICE_END = RETURN_POLICY_NOTICE_START.add(7, 'day');

const parseReturnDate = (value: any) => {
    if (!value) return dayjs('');
    if (dayjs.isDayjs(value)) return value;
    if (typeof value === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        return dayjs(new Date(excelEpoch.getTime() + value * 86400000));
    }

    const raw = String(value).trim();
    const formats = [
        'YYYY-MM-DD',
        'YYYY-MM-DD HH:mm:ss',
        'DD/MM/YYYY',
        'D/M/YYYY',
        'DD/MM/YYYY HH:mm',
        'D/M/YYYY HH:mm',
        'DD/MM/YYYY HH:mm:ss',
        'D/M/YYYY HH:mm:ss',
    ];

    for (const format of formats) {
        const parsed = dayjs(raw, format, true);
        if (parsed.isValid()) return parsed;
    }

    return dayjs(raw);
};

const normalizeReturnAssignee = (value: string) =>
    String(value || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const compactReturnAssignee = (value: string) =>
    normalizeReturnAssignee(value).replace(/[^a-z0-9]/g, '');

const isReturnAssigneeMatch = (packerName: string, employee: any) => {
    const packerNorm = normalizeReturnAssignee(packerName);
    const packerCompact = compactReturnAssignee(packerName);
    const candidates = [employee?.username, employee?.name, employee?.displayName].filter(Boolean).map(String);

    return candidates.some(candidate => {
        const candidateNorm = normalizeReturnAssignee(candidate);
        const candidateCompact = compactReturnAssignee(candidate);
        return candidate === packerName ||
            candidateNorm === packerNorm ||
            candidateCompact === packerCompact ||
            (!!candidateNorm && packerNorm.includes(candidateNorm)) ||
            (!!packerNorm && candidateNorm.includes(packerNorm)) ||
            (!!candidateCompact && packerCompact.includes(candidateCompact)) ||
            (!!packerCompact && candidateCompact.includes(packerCompact));
    });
};

interface Return {
    id: number;
    complaintCode: string; // Mã số khiếu nại
    orderNumber: string; // Mã đơn hàng
    productName: string; // Tên sản phẩm
    complaintDate: string; // Thời gian khiếu nại
    status: string; // Trạng thái Trả hàng/Hoàn tiền
    reason: string; // Lí do Trả hàng/Hoàn tiền
    packer?: string; // Nhân viên đóng gói
    processNotes?: string; // JSON array of timeline logs
    faultParty?: 'warehouse' | 'customer'; // Lỗi do kho hay do khách hàng
    createdAt?: Date;
}

interface ProcessLog {
    timestamp: string; // DD/MM HH:mm
    note: string;
    createdBy?: string;
}

export default function ReturnsPage() {
    const currentUser = useCurrentUser();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [returns, setReturns] = useState<Return[]>([]);
    const [loading, setLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [methodModalVisible, setMethodModalVisible] = useState(false);
    const [inputMethod, setInputMethod] = useState<'manual' | 'excel'>('manual');
    const [editingReturn, setEditingReturn] = useState<Return | null>(null);
    const [form] = Form.useForm();

    // Process notes timeline
    const [processLogs, setProcessLogs] = useState<ProcessLog[]>([]);
    const [tempNote, setTempNote] = useState('');

    // State for process notes column (to avoid Hooks violation)
    const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
    const [showInputRows, setShowInputRows] = useState<Record<number, boolean>>({});
    const [quickNotes, setQuickNotes] = useState<Record<number, string>>({});

    // Settings modal
    const [settingsVisible, setSettingsVisible] = useState(false);

    // Employee list management
    const [employees, setEmployees] = useState<any[]>([]);

    // Status list management
    const [statusList, setStatusList] = useState<Array<{ value: string; label: string; color: string; isFinal?: boolean }>>([]);
    const [newStatusIsFinal, setNewStatusIsFinal] = useState(false);
    const [newStatusLabel, setNewStatusLabel] = useState('');

    // ✨ State cho chọn nhiều để xóa
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

    // ✨ State cho tab Lịch sử
    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

    // ✨ State tìm kiếm
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [faultFilter, setFaultFilter] = useState<string>('all');
    const [packerFilter, setPackerFilter] = useState<string>('all');
    const [slaFilter, setSlaFilter] = useState<'all' | 'overdue'>('all');
    const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

    // ✨ State cho collapse/expand logs
    const [collapsedLogs, setCollapsedLogs] = useState<Record<number, boolean>>({});
    const syncReturnFinesRef = useRef(false);

    useEffect(() => {
        loadReturns();
        loadEmployees();
        loadStatusList();
        const interval = setInterval(() => { if (document.visibilityState === 'visible') void loadReturns(true); }, 300000);
        return () => clearInterval(interval);
    }, []);

    const loadEmployees = async () => {
        try {
            const api = (window as any).electronAPI;
            const res = await api.users.getAll();
            if (res.success && res.data) {
                setEmployees(res.data.filter((u: any) =>
                    u.username !== 'admin' &&
                    u.isActive !== false &&
                    u.operationalAssignee !== false
                ));
            }
        } catch (error) {
            console.error('Error fetching employees:', error);
            setEmployees([]);
        }
    };

    const loadStatusList = async () => {
        try {
            const result = await window.electronAPI.appConfig.get('statusList');
            if (result.success && result.data) {
                setStatusList(result.data);
            } else {
                // Default statuses
                const defaultStatuses = [
                    { value: 'pending', label: 'Đang xử lý', color: 'gold', isFinal: false },
                    { value: 'completed', label: 'Hoàn thành', color: 'green', isFinal: true },
                ];
                setStatusList(defaultStatuses);
                await window.electronAPI.appConfig.set('statusList', defaultStatuses);
            }
        } catch (error) {
            console.error('Error loading status list:', error);
            setStatusList([]);
        }
    };

    const saveStatusList = async (list: Array<{ value: string; label: string; color: string; isFinal?: boolean }>) => {
        try {
            await window.electronAPI.appConfig.set('statusList', list);
            setStatusList(list);
        } catch (error) {
            console.error('Error saving status list:', error);
        }
    };

    const isFinalStatus = (statusValue: string) =>
        statusList.find(s => s.value === statusValue)?.isFinal === true;

    const loadReturns = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const result = await window.electronAPI.returns.getAll();
            if (result.success && result.data) {
                setReturns(result.data);
                void syncMissingReturnFines(result.data, silent);
            }
        } catch (error) {
            if (!silent) message.error('Lỗi khi tải dữ liệu');
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleAdd = () => {
        // Mở thẳng popup Import Excel
        setInputMethod('excel');
    };

    const handleMethodSelect = (method: 'manual' | 'excel') => {
        setInputMethod(method);
        setMethodModalVisible(false);
        if (method === 'manual') {
            setModalVisible(true);
        }
    };

    const handleEdit = (returnRecord: Return) => {
        setEditingReturn(returnRecord);

        // Load processLogs
        try {
            const logs = returnRecord.processNotes ? JSON.parse(returnRecord.processNotes) : [];
            setProcessLogs(logs);
        } catch {
            setProcessLogs([]);
        }

        form.setFieldsValue({
            ...returnRecord,
            complaintDate: dayjs(returnRecord.complaintDate),
            faultParty: returnRecord.faultParty || 'warehouse',
        });
        setModalVisible(true);
    };

    const handleAddLog = () => {
        if (!tempNote.trim()) {
            message.warning('Vui lòng nhập nội dung ghi chú!');
            return;
        }

        const now = dayjs();
        const timestamp = now.format('DD/MM HH[h]mm');

        const newLog: ProcessLog = {
            timestamp,
            note: tempNote.trim(),
            createdBy: currentUser || undefined,
        };

        setProcessLogs([...processLogs, newLog]);
        setTempNote('');
        message.success('Đã thêm ghi chú!');
    };

    const handleRemoveLog = (index: number) => {
        setProcessLogs(processLogs.filter((_, i) => i !== index));
    };

    const handleDelete = (id: number) => {
        const returnRecord = returns.find(r => r.id === id);
        Modal.confirm({
            title: 'Xóa phiếu trả?',
            content: 'Bạn có chắc muốn xóa phiếu này?',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    // Xóa khoản phạt nếu phiếu đã hoàn thành và lỗi do kho
                    if (returnRecord?.status === 'completed' &&
                        returnRecord?.faultParty !== 'customer' &&
                        returnRecord?.complaintCode) {
                        await processReturnFineRemoval(returnRecord.complaintCode);
                    }
                    await window.electronAPI.returns.delete(id);
                    console.log(`✅ Đã xóa phiếu trả #${id} từ database`);
                    await loadReturns();
                    message.success('Đã xóa phiếu trả!');
                } catch (error) {
                    console.error('❌ Lỗi xóa phiếu trả:', error);
                    message.error('Lỗi khi xóa phiếu trả!');
                }
            },
        });
    };

    // ✨ Xóa nhiều phiếu trả cùng lúc
    const handleBulkDelete = () => {
        if (selectedRowKeys.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 phiếu để xóa!');
            return;
        }

        const selectedReturns = returns.filter(r => selectedRowKeys.includes(r.id));

        Modal.confirm({
            title: `Xác nhận xóa ${selectedRowKeys.length} phiếu trả?`,
            content: (
                <div>
                    <p>Bạn có chắc muốn xóa các phiếu trả sau:</p>
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
                        {selectedReturns.map(r => (
                            <div key={r.id} style={{ padding: '4px 0' }}>
                                • {r.complaintCode} - {r.productName}
                            </div>
                        ))}
                    </div>
                </div>
            ),
            okText: 'Xóa tất cả',
            okType: 'danger',
            cancelText: 'Hủy',
            width: 600,
            onOk: async () => {
                try {
                    for (const id of selectedRowKeys) {
                        const returnRecord = returns.find(r => r.id === id);
                        // Xóa khoản phạt nếu phiếu đã hoàn thành và lỗi do kho
                        if (returnRecord?.status === 'completed' &&
                            returnRecord?.faultParty !== 'customer' &&
                            returnRecord?.complaintCode) {
                            await processReturnFineRemoval(returnRecord.complaintCode);
                        }
                        await window.electronAPI.returns.delete(id);
                        console.log(`✅ Đã xóa phiếu trả #${id}`);
                    }
                    await loadReturns();
                    message.success(`Đã xóa ${selectedRowKeys.length} phiếu trả!`);
                    setSelectedRowKeys([]);
                } catch (error) {
                    console.error('❌ Lỗi xóa hàng loạt:', error);
                    message.error('Lỗi khi xóa phiếu trả hàng loạt!');
                }
            },
        });
    };

    const processReturnFineRemoval = async (complaintCode: string) => {
        try {
            const electronApi = (window as any).electronAPI;
            const attRes = await electronApi.appConfig.get('attendanceData');
            if (attRes.success && attRes.data) {
                const attData = typeof attRes.data === 'string' ? JSON.parse(attRes.data) : attRes.data;
                const before = (attData.extraFines || []).length;
                attData.extraFines = (attData.extraFines || []).filter((f: any) =>
                    !(f.source === 'returns' && f.detail && f.detail.includes(complaintCode))
                );
                if (attData.extraFines.length < before) {
                    await electronApi.appConfig.set('attendanceData', attData);
                    window.dispatchEvent(new CustomEvent('attendance:fineRemoved', { detail: { complaintCode } }));
                    message.info(`Đã xóa khoản phạt liên quan đến phiếu ${complaintCode}.`);
                }
            }
        } catch (error) {
            console.error('Lỗi xóa phạt tự động:', error);
        }
    };

    const processReturnFine = async (packerName: string, complaintCode: string, fineDate?: any, silent = false) => {
        if (!packerName || !complaintCode) return false;
        try {
            const electronApi = (window as any).electronAPI;
            const attRes = await electronApi.appConfig.get('attendanceData');
            if (attRes.success && attRes.data) {
                const attData = typeof attRes.data === 'string' ? JSON.parse(attRes.data) : attRes.data;
                const config = attData.config || {};
                const attEmployees = attData.employees || [];

                const packerEmp = attEmployees.find((e: any) => isReturnAssigneeMatch(packerName, e));
                if (!packerEmp) {
                    console.warn(`[Returns] Không tìm thấy NV "${packerName}" trong danh sách chấm công.`);
                    if (silent) return false;
                    message.warning(`⚠️ Không tìm thấy nhân viên "${packerName}" trong danh sách chấm công. Phạt chưa được ghi nhận!`);
                    return false;
                }

                const isSeasonal = packerEmp.type === 'Seasonal';
                const amount = isSeasonal ? (config.wrongOrderFineSeasonal || 0) : (config.wrongOrderFineOfficial || 0);

                if (amount > 0) {
                    const existingFines = attData.extraFines || [];
                    const hasExistingFine = existingFines.some((f: any) =>
                        f.source === 'returns' && f.detail && f.detail.includes(complaintCode)
                    );
                    if (hasExistingFine) return false;

                    const parsedFineDate = parseReturnDate(fineDate);
                    const fineDateValue = parsedFineDate.isValid()
                        ? parsedFineDate.toISOString()
                        : new Date().toISOString();
                    const newFine = {
                        empId: packerEmp.id,
                        type: 'Khác',
                        detail: `Đóng gói sai đơn, phát sinh KH hoàn hàng/khiếu nại (Mã phiếu: ${complaintCode})`,
                        amount: amount,
                        date: fineDateValue,
                        source: 'returns'
                    };

                    attData.extraFines = [...existingFines, newFine];
                    await electronApi.appConfig.set('attendanceData', attData);
                    window.dispatchEvent(new CustomEvent('attendance:fineAdded', { detail: newFine }));
                    if (silent) return true;
                    message.warning(`⚠️ Đã tự động ghi nhận mức phạt ${amount.toLocaleString('vi-VN')}đ cho NV ${packerEmp.displayName || packerEmp.name} (Lỗi trả hàng)!`);
                    return true;
                }
            }
        } catch (error) {
            console.error('Lỗi tính phạt tự động:', error);
        }
        return false;
    };

    const syncMissingReturnFines = async (rows: Return[], silent = false) => {
        if (syncReturnFinesRef.current) return;
        syncReturnFinesRef.current = true;

        try {
            const candidates = rows.filter(row =>
                row.status === 'completed' &&
                row.faultParty !== 'customer' &&
                !!row.packer &&
                !!row.complaintCode
            );
            if (candidates.length === 0) return;

            const electronApi = (window as any).electronAPI;
            const attRes = await electronApi.appConfig.get('attendanceData');
            if (!attRes.success || !attRes.data) return;

            const attData = typeof attRes.data === 'string' ? JSON.parse(attRes.data) : attRes.data;
            const config = attData.config || {};
            const attEmployees = attData.employees || [];
            const existingFines = attData.extraFines || [];
            const existingReturnCodes = new Set(
                existingFines
                    .filter((f: any) => f.source === 'returns' && f.detail)
                    .map((f: any) => {
                        const match = String(f.detail).match(/Mã phiếu:\s*([^)]+)/);
                        return match?.[1]?.trim() || '';
                    })
                    .filter(Boolean)
            );

            const findPackerEmp = (packerName: string) => {
                return attEmployees.find((e: any) => isReturnAssigneeMatch(packerName, e));
            };

            const newFines: any[] = [];
            for (const row of candidates) {
                if (existingReturnCodes.has(row.complaintCode)) continue;

                const packerEmp = findPackerEmp(row.packer!);
                if (!packerEmp) {
                    console.warn(`[Returns] Không tìm thấy NV "${row.packer}" trong danh sách chấm công.`);
                    continue;
                }

                const amount = packerEmp.type === 'Seasonal'
                    ? (config.wrongOrderFineSeasonal || 0)
                    : (config.wrongOrderFineOfficial || 0);
                if (amount <= 0) continue;

                const fine = {
                    empId: packerEmp.id,
                    type: 'Khác',
                    detail: `Đóng gói sai đơn, phát sinh KH hoàn hàng/khiếu nại (Mã phiếu: ${row.complaintCode})`,
                    amount,
                    date: parseReturnDate(row.complaintDate).isValid()
                        ? parseReturnDate(row.complaintDate).toISOString()
                        : new Date().toISOString(),
                    source: 'returns'
                };
                newFines.push(fine);
                existingReturnCodes.add(row.complaintCode);
            }

            if (newFines.length === 0) return;

            attData.extraFines = [...existingFines, ...newFines];
            await electronApi.appConfig.set('attendanceData', attData);
            newFines.forEach(fine => {
                window.dispatchEvent(new CustomEvent('attendance:fineAdded', { detail: fine }));
            });

            if (!silent) {
                message.info(`Đã đồng bộ ${newFines.length} khoản phạt trả hàng vào Bảng công.`);
            }
        } catch (error) {
            console.error('Lỗi đồng bộ phạt trả hàng:', error);
        } finally {
            syncReturnFinesRef.current = false;
        }
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();

            // Xác định faultParty (mặc định 'warehouse' nếu chưa chọn)
            const faultParty: 'warehouse' | 'customer' = values.faultParty || 'warehouse';

            // Map frontend fields → DB fields
            const dbData = {
                customerName: values.productName,
                returnCode: values.complaintCode,
                orderNumber: values.orderNumber,
                returnReason: values.reason,
                returnDate: values.complaintDate.format('YYYY-MM-DD'),
                items: JSON.stringify([]),
                totalAmount: 0,
                notes: processLogs.length > 0 ? JSON.stringify(processLogs) : null,
                status: values.status,
                packer: values.packer || null,
                faultParty,
            };

            let updatedReturns: Return[];

            if (editingReturn) {
                // EDIT MODE - gọi API update
                await window.electronAPI.returns.update(editingReturn.id, dbData);
                console.log(`✅ Đã cập nhật phiếu trả #${editingReturn.id}`);
                updatedReturns = returns; // placeholder for activity log
            } else {
                // CREATE MODE - gọi API create
                const result = await window.electronAPI.returns.create(dbData);
                console.log(`✅ Đã tạo phiếu trả mới`);
                const newReturn: Return = {
                    id: result.data?.id || 0,
                    complaintCode: values.complaintCode,
                    orderNumber: values.orderNumber,
                    productName: values.productName,
                    complaintDate: values.complaintDate.format('YYYY-MM-DD'),
                    status: values.status,
                    reason: values.reason,
                    packer: values.packer || undefined,
                    faultParty,
                    processNotes: processLogs.length > 0 ? JSON.stringify(processLogs) : undefined,
                    createdAt: new Date(),
                };
                updatedReturns = [newReturn, ...returns];
            }

            await loadReturns();

            // Log activity
            if (editingReturn) {
                const changes: any = {};
                if (editingReturn.status !== values.status) {
                    const oldStatus = statusList.find(s => s.value === editingReturn.status);
                    const newStatus = statusList.find(s => s.value === values.status);
                    changes.status = {
                        old: oldStatus?.label || editingReturn.status,
                        new: newStatus?.label || values.status
                    };
                }
                if (editingReturn.packer !== values.packer) {
                    changes.packer = { old: editingReturn.packer || 'Chưa chỉ định', new: values.packer || 'Chưa chỉ định' };
                }
                if (editingReturn.faultParty !== faultParty) {
                    changes.faultParty = {
                        old: editingReturn.faultParty === 'customer' ? 'Lỗi do khách hàng' : 'Lỗi do kho',
                        new: faultParty === 'customer' ? 'Lỗi do khách hàng' : 'Lỗi do kho',
                    };
                }

                const changeDescriptions = [];
                if (changes.status) {
                    changeDescriptions.push(`trạng thái từ "${changes.status.old}" → "${changes.status.new}"`);
                }
                if (changes.packer) {
                    changeDescriptions.push(`nhân viên đóng gói: ${changes.packer.old} → ${changes.packer.new}`);
                }
                if (changes.faultParty) {
                    changeDescriptions.push(`lỗi do: ${changes.faultParty.old} → ${changes.faultParty.new}`);
                }

                await window.electronAPI.activityLog.create({
                    module: 'returns',
                    action: 'UPDATE',
                    recordId: editingReturn.id,
                    recordName: `RT${editingReturn.complaintCode}`,
                    changes: Object.keys(changes).length > 0 ? JSON.stringify(changes) : undefined,
                    description: `Cập nhật phiếu trả "${editingReturn.complaintCode}"` + (changeDescriptions.length > 0 ? `: ${changeDescriptions.join(', ')}` : ''),
                    userName: currentUser,
                    severity: 'INFO'
                });
            } else {
                // Create
                const newReturn = updatedReturns[0];
                await window.electronAPI.activityLog.create({
                    module: 'returns',
                    action: 'CREATE',
                    recordId: newReturn.id,
                    recordName: `RT${newReturn.complaintCode}`,
                    description: `Tạo phiếu trả hàng mới "${newReturn.complaintCode}" (Đơn: ${newReturn.orderNumber}, SP: ${newReturn.productName}, Lỗi do: ${faultParty === 'customer' ? 'khách hàng' : 'kho'})`,
                    userName: currentUser,
                    severity: 'INFO'
                });
            }

            // ✅ Chỉ ghi phạt nếu "Lỗi do kho" + hoàn thành + có packer
            if (values.status === 'completed' && values.packer && faultParty === 'warehouse') {
                const isStatusChanged = !editingReturn || editingReturn.status !== 'completed';
                if (isStatusChanged) {
                    await processReturnFine(values.packer, values.complaintCode, values.complaintDate);
                }
            } else if (faultParty === 'customer') {
                // Đổi sang "lỗi do khách" → xóa phạt cũ nếu đã từng tạo
                const wasWarehouse = editingReturn && editingReturn.faultParty !== 'customer';
                if (wasWarehouse && editingReturn.status === 'completed') {
                    await processReturnFineRemoval(values.complaintCode);
                }
            }

            message.success(editingReturn ? '✅ Đã cập nhật phiếu trả!' : '✅ Đã tạo phiếu trả mới!');
            setModalVisible(false);
            form.resetFields();
            setEditingReturn(null);
            setProcessLogs([]);
            setTempNote('');
        } catch (error) {
            console.error('Submit error:', error);
            message.error('Lỗi khi lưu phiếu trả');
        }
    };

    const handleImportExcel = (file: File) => {
        // 🔧 Bật loading NGAY khi chọn file
        setImportLoading(true);
        const hideLoading = message.loading('⏳ Đang import dữ liệu...', 0);

        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = e.target?.result;
                const isCSV = file.name.toLowerCase().endsWith('.csv');
                const workbook = XLSX.read(data, { type: isCSV ? 'string' : 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log('📊 Raw Excel data:', jsonData);
                console.log(`📊 Tổng số dòng trong Excel: ${jsonData.length}`);

                // 🔍 DEBUG: Log tất cả tên cột của row đầu tiên
                if (jsonData.length > 0) {
                    const firstRow = jsonData[0] as any;
                    const columnNames = Object.keys(firstRow);
                    console.log('📋 TẤT CẢ TÊN CỘT trong Excel:', columnNames);
                    console.log('📋 Row đầu tiên:', JSON.stringify(firstRow, null, 2));
                }

                const newReturns: Return[] = [];
                let startId = returns.length > 0 ? Math.max(...returns.map(r => r.id)) + 1 : 1;
                let skippedCount = 0;

                jsonData.forEach((row: any, index: number) => {
                    const complaintCode = row['Mã số khiếu nại'] || row['Ma so khieu nai'] || row['Return Order ID'] || row['Return/Refund ID'] || `AUTO-${Date.now()}-${index}`;
                    const orderNumber = row['Mã đơn hàng'] || row['Ma don hang'] || row['Order ID'] || row['Related Order ID'] || '';
                    const productName = row['Tên sản phẩm'] || row['Ten san pham'] || row['Product Name'] || row['Item Name'] || '';
                    const complaintDate = row['Thời gian khiếu nại'] || row['Thoi gian khieu nai'] || row['Time Requested'] || row['Request Time'] || row['Created Time'] || '';
                    const status = row['Trạng thái Trả hàng/Hoàn tiền'] || row['Trang thai Tra hang/Hoan tien'] || row['Return Status'] || row['Status'] || row['Resolution Status'] || 'pending';
                    const reason = row['Lí do Trả hàng/Hoàn tiền'] || row['Li do Tra hang/Hoan tien'] || row['Buyer Note'] || row['Return Reason'] || row['Reason'] || row['Return Type'] || '';
                    const faultPartyRaw = String(row['Lỗi do'] || row['Loi do'] || row['Fault Party'] || row['Fault Reason'] || '').toLowerCase();
                    const faultParty: 'warehouse' | 'customer' =
                        faultPartyRaw.includes('khách') || faultPartyRaw.includes('kh') || faultPartyRaw.includes('customer')
                            ? 'customer' : 'warehouse';

                    // 🔍 DEBUG: Log chi tiết cho 3 row đầu
                    if (index < 3) {
                        console.log(`🔍 Row ${index}: complaintCode="${complaintCode}", orderNumber="${orderNumber}", productName="${productName}", date="${complaintDate}", status="${status}"`);
                    }

                    if (!productName) {
                        skippedCount++;
                        if (skippedCount <= 5) {
                            console.warn(`⚠️ Skip row ${index}: missing product name. Keys:`, Object.keys(row));
                        }
                        return;
                    }

                    // 🔧 Safe date parsing
                    let parsedDate = parseReturnDate(complaintDate);
                    if (!parsedDate.isValid()) {
                        parsedDate = dayjs(); // Fallback to today
                    }

                    const newReturn: Return = {
                        id: startId++,
                        complaintCode,
                        orderNumber,
                        productName,
                        complaintDate: parsedDate.format('YYYY-MM-DD'),
                        status: status.includes('Hoàn thành') || status.includes('Hoan thanh') || status.includes('Refund rejected') || status.includes('Complete') || status.includes('Completed') ? 'completed' : 'pending',
                        reason,
                        faultParty,
                        createdAt: new Date(),
                    };

                    newReturns.push(newReturn);
                });

                console.log(`📊 Kết quả parse: ${newReturns.length} hợp lệ, ${skippedCount} bị skip (thiếu tên SP)`);

                if (newReturns.length === 0) {
                    message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    return;
                }

                // 🔧 FIX: Lọc trùng theo complaintCode (so với data đã có trong DB)
                const existingCodes = new Set(returns.map(r => r.complaintCode));
                const uniqueReturns = newReturns.filter(r => !existingCodes.has(r.complaintCode));
                const duplicateCount = newReturns.length - uniqueReturns.length;

                if (duplicateCount > 0) {
                    console.log(`⚠️ Bỏ qua ${duplicateCount} phiếu trùng mã khiếu nại`);
                }

                if (uniqueReturns.length === 0) {
                    message.warning(`Tất cả ${newReturns.length} phiếu đều đã tồn tại (trùng mã khiếu nại)!`);
                    return;
                }

                // 🔧 FIX: Lưu vào DATABASE qua bulkCreate API
                // Map frontend fields → database fields (Prisma schema)
                // Frontend: complaintCode, productName, complaintDate, reason
                // Database: returnCode, customerName, returnDate, returnReason, items
                try {
                    // Tra cứu packer từ EcommerceExport theo orderNumber
                    const orderNumbers = uniqueReturns.map(r => r.orderNumber).filter(Boolean);
                    let packerMap: Record<string, string> = {};
                    try {
                        if (orderNumbers.length > 0) {
                            const packerRes = await window.electronAPI.ecommerceExports.getPackersByOrderNumbers(orderNumbers);
                            if (packerRes.success) packerMap = packerRes.data;
                        }
                    } catch {
                        // Không tìm được packer → để trống, không block import
                    }

                    const dbRecords = uniqueReturns.map(r => ({
                        customerName: r.productName,
                        returnCode: r.complaintCode,
                        orderNumber: r.orderNumber,
                        returnReason: r.reason,
                        returnDate: r.complaintDate,
                        items: JSON.stringify([]),
                        totalAmount: 0,
                        notes: r.processNotes || null,
                        status: r.status || 'pending',
                        packer: packerMap[r.orderNumber] || null,
                        faultParty: r.faultParty || 'warehouse',
                    }));
                    const result = await window.electronAPI.returns.bulkCreate(dbRecords);
                    if (!result.success) throw new Error(result.error || 'Lỗi DB');
                    console.log(`✅ Đã lưu ${uniqueReturns.length} phiếu trả vào database`);

                    // Reload data từ DB
                    await loadReturns();

                    // 🔧 FIX: Đóng popup import
                    setInputMethod('manual');

                    const dupMsg = duplicateCount > 0 ? ` (bỏ qua ${duplicateCount} phiếu trùng)` : '';
                    message.success(`✅ Đã import ${uniqueReturns.length} phiếu trả hàng từ Excel!${dupMsg}`);
                } catch (dbError) {
                    console.error('❌ Lỗi lưu vào database:', dbError);
                    message.error(`Lỗi lưu ${newReturns.length} phiếu trả vào database!`);
                }
            } catch (error) {
                console.error('Import error:', error);
                message.error('Lỗi khi đọc file Excel!');
            } finally {
                hideLoading();
                setImportLoading(false);
            }
        };

        if (file.name.toLowerCase().endsWith('.csv')) {
            reader.readAsText(file, "utf-8");
        } else {
            reader.readAsBinaryString(file);
        }
        return false;
    };

    const getReturnSla = (record: Return) => {
        if (isFinalStatus(record.status) || record.status === 'completed') {
            return { label: 'Đã hoàn tất', tone: 'done', overdue: false };
        }

        const complaintAt = parseReturnDate(record.complaintDate);
        if (!complaintAt.isValid()) return { label: 'Chưa có hạn', tone: 'neutral', overdue: false };

        const remainingHours = RETURN_SLA_HOURS - dayjs().diff(complaintAt, 'hour');
        if (remainingHours < 0) {
            const overdueDays = Math.max(1, Math.ceil(Math.abs(remainingHours) / 24));
            return { label: `Quá hạn ${overdueDays} ngày`, tone: 'danger', overdue: true };
        }
        if (remainingHours <= 8) return { label: `Còn ${Math.max(1, remainingHours)}h`, tone: 'warning', overdue: false };
        if (remainingHours <= 24) return { label: 'Còn 1 ngày', tone: 'warning', overdue: false };
        return { label: `Còn ${Math.ceil(remainingHours / 24)} ngày`, tone: 'success', overdue: false };
    };

    const handleBulkPackerChange = async (packer: string) => {
        if (!selectedRowKeys.length) return;
        try {
            await Promise.all(selectedRowKeys.map(id => window.electronAPI.returns.update(id, { packer })));
            setReturns(prev => prev.map(item => selectedRowKeys.includes(item.id) ? { ...item, packer } : item));
            message.success(`Đã gán nhân viên cho ${selectedRowKeys.length} phiếu`);
        } catch {
            message.error('Không thể gán nhân viên cho các phiếu đã chọn');
            await loadReturns(true);
        }
    };

    const handleBulkStatusChange = async (status: string) => {
        if (!selectedRowKeys.length) return;
        const selected = returns.filter(item => selectedRowKeys.includes(item.id));
        if (status === 'completed' && selected.some(item => !item.packer)) {
            message.warning('Một số phiếu chưa có nhân viên đóng gói');
            return;
        }
        try {
            await Promise.all(selectedRowKeys.map(id => window.electronAPI.returns.update(id, { status })));
            await loadReturns(true);
            setSelectedRowKeys([]);
            message.success('Đã cập nhật trạng thái hàng loạt');
        } catch {
            message.error('Không thể cập nhật trạng thái hàng loạt');
        }
    };

    const handleExportDisplayed = () => {
        const rows = displayedReturns.map(item => ({
            'Mã KN': item.complaintCode,
            'Đơn hàng': item.orderNumber,
            'Ngày': dayjs(item.complaintDate).format('DD/MM/YYYY'),
            'Sản phẩm': item.productName,
            'Lý do': item.reason,
            'Nhân viên đóng gói': item.packer || '',
            'Lỗi do': item.faultParty === 'customer' ? 'Khách hàng' : 'Kho',
            'Trạng thái': statusList.find(status => status.value === item.status)?.label || item.status,
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Tra hang');
        XLSX.writeFile(workbook, `tra-hang-${dayjs().format('YYYY-MM-DD')}.xlsx`);
    };

    const clearReturnFilters = () => {
        setSearchText('');
        setStatusFilter('all');
        setFaultFilter('all');
        setPackerFilter('all');
        setSlaFilter('all');
        setDateRange(null);
    };

    const parseProcessLogs = (record: Return): ProcessLog[] => {
        try {
            return record.processNotes ? JSON.parse(record.processNotes) : [];
        } catch {
            return [];
        }
    };

    const handleQuickNoteAdd = async (record: Return) => {
        const quickNote = quickNotes[record.id] || '';
        if (!quickNote.trim()) {
            message.warning('Vui lòng nhập nội dung ghi chú');
            return;
        }
        const updatedLogs = [
            ...parseProcessLogs(record),
            {
                timestamp: dayjs().format('DD/MM HH[h]mm'),
                note: quickNote.trim(),
                createdBy: currentUser || undefined,
            },
        ];
        try {
            await window.electronAPI.returns.update(record.id, { notes: JSON.stringify(updatedLogs) });
            setQuickNotes(prev => ({ ...prev, [record.id]: '' }));
            setShowInputRows(prev => ({ ...prev, [record.id]: false }));
            await loadReturns(true);
            message.success('Đã thêm ghi chú');
        } catch {
            message.error('Không thể lưu ghi chú');
        }
    };

    const returnAvatarColors = ['#00a85a', '#f59e0b', '#7c5ce7', '#1677ff', '#ef6a6a', '#0891b2'];

    const getInitials = (name?: string) => {
        const value = String(name || '?').trim();
        const parts = value.split(/\s+/).filter(Boolean);
        return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : value.slice(0, 2)).toUpperCase();
    };

    const getAvatarColor = (name?: string) => {
        const hash = String(name || '').split('').reduce((total, character) => total + character.charCodeAt(0), 0);
        return returnAvatarColors[hash % returnAvatarColors.length];
    };

    const getStatusTone = (statusValue: string) => {
        const config = statusList.find(item => item.value === statusValue);
        const source = `${statusValue} ${config?.label || ''} ${config?.color || ''}`.toLowerCase();
        if (config?.isFinal || /complete|completed|hoàn|green/.test(source)) return 'success';
        if (/cskh|chờ|wait|purple|geekblue/.test(source)) return 'waiting';
        if (/reject|cancel|hủy|red/.test(source)) return 'danger';
        if (/new|mới|default|gray|grey/.test(source)) return 'neutral';
        return 'processing';
    };

    const columns: ColumnsType<Return> = [
        {
            title: 'Mã KN / Đơn hàng / Sản phẩm',
            key: 'info',
            width: 360,
            render: (_, record) => {
                return (
                    <div className="returns-order-cell" style={{ lineHeight: 1.7, fontSize: 12 }}>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>Mã KN:</Text>
                                <div><Tag className="returns-complaint-code" bordered={false}>{record.complaintCode}</Tag></div>
                            </div>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>Ngày:</Text>
                                <div><Text strong style={{ fontSize: 12 }}>{dayjs(record.complaintDate).format('DD/MM/YYYY')}</Text></div>
                            </div>
                        </div>
                        <div style={{ marginBottom: 2 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>Đơn: </Text>
                            <Text style={{ fontSize: 12 }}>{record.orderNumber}</Text>
                        </div>
                        <div style={{ marginBottom: 2 }}>
                            <Text type="secondary" style={{ fontSize: 11 }}>SP: </Text>
                            <Text style={{ fontSize: 12 }}>{record.productName}</Text>
                        </div>
                        <div>
                            <Text type="secondary" style={{ fontSize: 11 }}>Lí do: </Text>
                            <Text style={{ fontSize: 12 }}>{record.reason}</Text>
                        </div>
                    </div>
                );
            },
        },
        {
            title: 'Ghi chú xử lý',
            key: 'processNotes',
            width: 280,
            render: (_, record) => {
                // Parse process notes
                let logs: ProcessLog[] = [];
                try {
                    logs = record.processNotes ? JSON.parse(record.processNotes) : [];
                } catch {
                    logs = [];
                }

                const isExpanded = expandedRows[record.id] || false;
                const showInput = showInputRows[record.id] || false;
                const quickNote = quickNotes[record.id] || '';

                const handleQuickAdd = async () => {
                    if (!quickNote.trim()) {
                        message.warning('Vui lòng nhập nội dung ghi chú!');
                        return;
                    }

                    const now = dayjs();
                    const timestamp = now.format('DD/MM HH[h]mm');

                    const newLog: ProcessLog = {
                        timestamp,
                        note: quickNote.trim(),
                        createdBy: currentUser || undefined,
                    };

                    const updatedLogs = [...logs, newLog];
                    const notesJson = JSON.stringify(updatedLogs);

                    // 🔧 FIX: Gọi API update để lưu notes vào DB
                    try {
                        await window.electronAPI.returns.update(record.id, {
                            notes: notesJson,
                        });
                        console.log(`✅ Đã lưu ghi chú cho phiếu #${record.id}`);
                        await loadReturns();
                    } catch (err) {
                        console.error('❌ Lỗi lưu ghi chú:', err);
                        message.error('Lỗi lưu ghi chú!');
                        return;
                    }

                    // Clear input
                    setQuickNotes(prev => ({ ...prev, [record.id]: '' }));
                    setShowInputRows(prev => ({ ...prev, [record.id]: false }));
                    message.success('Đã thêm ghi chú!');
                };

                const displayLogs = isExpanded ? logs : logs.slice(-2);

                return (
                    <div className="returns-note-cell">
                        {logs.length === 0 && !showInput && (
                            <Text type="secondary" italic style={{ fontSize: 12 }}>
                                Chưa có ghi chú
                            </Text>
                        )}

                        {displayLogs.map((log, index) => (
                            <div key={index} className="returns-note-entry">
                                <Tag className="returns-note-time" bordered={false}>
                                    {log.timestamp}
                                </Tag>
                                {log.createdBy && (
                                    <Tag className="returns-note-user" bordered={false}>
                                        @{log.createdBy}
                                    </Tag>
                                )}
                                <Text style={{ fontSize: 12 }}>{log.note}</Text>
                            </div>
                        ))}

                        {/* Expand/Collapse button */}
                        {logs.length > 2 && (
                            <Button
                                type="link"
                                size="small"
                                style={{ padding: 0, height: 'auto', fontSize: 11 }}
                                onClick={() => setExpandedRows(prev => ({ ...prev, [record.id]: !isExpanded }))}
                            >
                                {isExpanded ? '▲ Thu gọn' : `▼ +${logs.length - 2} ghi chú khác`}
                            </Button>
                        )}

                        {/* Quick Add Input */}
                        {showInput ? (
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                <Input
                                    size="small"
                                    placeholder="Nhập ghi chú nhanh..."
                                    value={quickNote}
                                    onChange={(e) => setQuickNotes(prev => ({ ...prev, [record.id]: e.target.value }))}
                                    onPressEnter={handleQuickAdd}
                                    style={{ fontSize: 12 }}
                                />
                                <Button
                                    type="primary"
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={handleQuickAdd}
                                />
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setShowInputRows(prev => ({ ...prev, [record.id]: false }));
                                        setQuickNotes(prev => ({ ...prev, [record.id]: '' }));
                                    }}
                                >
                                    ✕
                                </Button>
                            </div>
                        ) : (
                            <Button
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={() => setShowInputRows(prev => ({ ...prev, [record.id]: true }))}
                                style={{ marginTop: 4 }}
                            >
                                Thêm ghi chú
                            </Button>
                        )}
                    </div>
                );
            },
        },
        {
            title: 'NV đóng gói',
            dataIndex: 'packer',
            key: 'packer',
            width: 170,
            render: (packer, record) => {
                // Disable packer change in history tab
                const isInHistory = !isAdmin;

                return (
                    <Select
                        className="returns-packer-select"
                        value={packer || undefined}
                        placeholder="Chọn nhân viên..."
                        disabled={isInHistory}
                        onChange={async (value) => {
                            // Update in database
                            await window.electronAPI.returns.update(record.id, { packer: value });
                            const updated = returns.map(r =>
                                r.id === record.id ? { ...r, packer: value } : r
                            );
                            setReturns(updated);
                            message.success('Đã cập nhật nhân viên đóng gói!');
                        }}
                        style={{ width: '100%' }}
                        size="small"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        labelRender={({ value }) => {
                            if (!value) return <span>Chọn nhân viên</span>;
                            const username = String(value);
                            const employee = employees.find(emp => emp.username === username);
                            const displayName = employee?.displayName || employee?.name || username;
                            return (
                                <span className="returns-person-value">
                                    <Avatar size={20} style={{ backgroundColor: getAvatarColor(username) }}>{getInitials(username)}</Avatar>
                                    <span>{displayName}</span>
                                </span>
                            );
                        }}
                    >
                        {employees.map((emp) => (
                            <Select.Option key={emp.username} value={emp.username} label={emp.displayName || emp.username}>
                                <Space size={8}><Avatar size={20} style={{ backgroundColor: getAvatarColor(emp.username) }}>{getInitials(emp.username)}</Avatar>{emp.displayName || emp.username}</Space>
                            </Select.Option>
                        ))}
                    </Select>
                );
            },
        },
        {
            title: 'Lỗi do',
            key: 'faultParty',
            dataIndex: 'faultParty',
            width: 140,
            render: (faultParty: string | undefined, record: Return) => {
                const isCompleted = !isAdmin && (record.status === 'completed' || isFinalStatus(record.status));
                return (
                    <Select
                        className="returns-fault-select"
                        value={faultParty === 'customer' ? 'customer' : 'warehouse'}
                        size="small"
                        style={{ width: '100%' }}
                        disabled={isCompleted}
                        labelRender={({ value, label }) => <span className={`returns-fault-chip returns-fault-chip--${value}`}>{label}</span>}
                        onChange={async (value) => {
                            // Optimistic update: cập nhật UI ngay lập tức
                            const updated = returns.map(r =>
                                r.id === record.id ? { ...r, faultParty: value as 'warehouse' | 'customer' } : r
                            );
                            setReturns(updated);
                            try {
                                const result = await window.electronAPI.returns.update(record.id, { faultParty: value });
                                if (!result.success) throw new Error(result.error || 'Lỗi DB');
                                // Xử lý phạt khi đơn đã hoàn thành
                                if (record.status === 'completed') {
                                    if (value === 'customer' && record.faultParty !== 'customer') {
                                        // Đổi sang "lỗi do khách" → xóa phạt cũ
                                        await processReturnFineRemoval(record.complaintCode);
                                    } else if (value === 'warehouse' && record.faultParty === 'customer' && record.packer) {
                                        // Đổi sang "lỗi do kho" → tạo phạt mới
                                        await processReturnFine(record.packer, record.complaintCode, record.complaintDate);
                                    }
                                }
                                message.success('Đã cập nhật!');
                            } catch (err: any) {
                                // Hoàn tác nếu lỗi
                                await loadReturns();
                                message.error(`Lỗi cập nhật: ${err.message}`);
                            }
                        }}
                    >
                        <Select.Option value="warehouse" label="Lỗi do kho">Lỗi do kho</Select.Option>
                        <Select.Option value="customer" label="Lỗi do khách hàng">Lỗi do khách hàng</Select.Option>
                    </Select>
                );
            },
        },
        {
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 170,
            render: (status, record) => {
                const getStatusTag = (statusValue: string) => {
                    const statusConfig = statusList.find(s => s.value === statusValue);
                    if (statusConfig) {
                        return <Tag color={statusConfig.color}>{statusConfig.label}</Tag>;
                    }
                    return <Tag>{statusValue}</Tag>;
                };

                // Disable status change in history tab
                const isInHistory = activeTab === 'history' && isFinalStatus(status);

                return (
                    <Select
                        className="returns-status-select"
                        value={status}
                        disabled={isInHistory}
                        onChange={async (newStatus) => {
                            // Validation: chưa có packer không cho chuyển Hoàn thành
                            if (newStatus === 'completed' && !record.packer) {
                                message.warning('⚠️ Vui lòng chọn "Nhân viên đóng gói" trước khi chuyển sang Hoàn thành!');
                                return;
                            }

                            const doUpdate = async () => {
                                try {
                                    await window.electronAPI.returns.update(record.id, { status: newStatus });

                                    // ✅ Chỉ ghi phạt nếu "Lỗi do kho"
                                    if (newStatus === 'completed' && record.packer) {
                                        if (record.faultParty === 'customer') {
                                            console.log(`[Returns] Bỏ qua ghi phạt - Lỗi do khách hàng (phiếu: ${record.complaintCode})`);
                                        } else {
                                            // 'warehouse' hoặc undefined (mặc định = lỗi kho)
                                            await processReturnFine(record.packer, record.complaintCode, record.complaintDate);
                                        }
                                    } else if (record.status === 'completed' && newStatus !== 'completed' && record.complaintCode) {
                                        await processReturnFineRemoval(record.complaintCode);
                                    }

                                    await loadReturns();
                                    message.success('Đã cập nhật trạng thái!');
                                } catch (err) {
                                    message.error('Lỗi cập nhật trạng thái!');
                                }
                            };

                            // Xác nhận trước khi chuyển sang Hoàn thành
                            if (newStatus === 'completed') {
                                Modal.confirm({
                                    title: '✅ Xác nhận hoàn thành?',
                                    content: (
                                        <div>
                                            <p>Phiếu <strong>{record.complaintCode}</strong> sẽ được chuyển sang <strong>Hoàn thành</strong> và lưu vào Lịch sử.</p>
                                            <p style={{ color: '#ff4d4f', marginBottom: 0 }}>Hành động này không thể hoàn tác!</p>
                                        </div>
                                    ),
                                    okText: 'Xác nhận',
                                    okType: 'primary',
                                    cancelText: 'Hủy',
                                    onOk: doUpdate,
                                });
                            } else {
                                await doUpdate();
                            }
                        }}
                        style={{ width: '100%' }}
                        size="small"
                        optionLabelProp="label"
                        labelRender={({ value, label }) => (
                            <span className={`returns-status-chip returns-status-chip--${getStatusTone(String(value))}`}>{label}</span>
                        )}
                        dropdownRender={(menu) => (
                            <>
                                {menu}
                                <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f0', marginTop: 4 }}>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <Input
                                            placeholder="Thêm trạng thái..."
                                            value={newStatusLabel}
                                            onChange={(e) => setNewStatusLabel(e.target.value)}
                                            onPressEnter={(e) => {
                                                e.stopPropagation();
                                                if (newStatusLabel.trim()) {
                                                    const newStatusValue = newStatusLabel.trim().toLowerCase().replace(/\s+/g, '_');
                                                    if (statusList.some(s => s.value === newStatusValue)) {
                                                        message.warning('Trạng thái này đã tồn tại!');
                                                        return;
                                                    }
                                                    const newStatus = {
                                                        value: newStatusValue,
                                                        label: newStatusLabel.trim(),
                                                        color: 'blue',
                                                    };
                                                    const updated = [...statusList, newStatus];
                                                    saveStatusList(updated);
                                                    setNewStatusLabel('');
                                                    message.success('Đã thêm trạng thái mới!');
                                                }
                                            }}
                                            size="small"
                                            style={{ flex: 1 }}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <Button
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (newStatusLabel.trim()) {
                                                    const newStatusValue = newStatusLabel.trim().toLowerCase().replace(/\s+/g, '_');
                                                    if (statusList.some(s => s.value === newStatusValue)) {
                                                        message.warning('Trạng thái này đã tồn tại!');
                                                        return;
                                                    }
                                                    const newStatus = {
                                                        value: newStatusValue,
                                                        label: newStatusLabel.trim(),
                                                        color: 'blue',
                                                    };
                                                    const updated = [...statusList, newStatus];
                                                    saveStatusList(updated);
                                                    setNewStatusLabel('');
                                                    message.success('Đã thêm trạng thái mới!');
                                                }
                                            }}
                                            size="small"
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    >
                        {statusList.map(s => (
                            <Select.Option key={s.value} value={s.value} label={s.label}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{getStatusTag(s.value)}</span>
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            Modal.confirm({
                                                title: 'Xóa trạng thái?',
                                                content: `Bạn có chắc muốn xóa trạng thái "${s.label}" khỏi danh sách?`,
                                                okText: 'Xóa',
                                                okType: 'danger',
                                                cancelText: 'Hủy',
                                                onOk: () => {
                                                    const updated = statusList.filter(status => status.value !== s.value);
                                                    saveStatusList(updated);
                                                    message.success('Đã xóa trạng thái!');
                                                },
                                            });
                                        }}
                                        style={{ padding: '0 4px' }}
                                    />
                                </div>
                            </Select.Option>
                        ))}
                    </Select>
                );
            },
        },
        {
            title: 'Hạn xử lý',
            key: 'sla',
            width: 120,
            render: (_, record) => {
                const sla = getReturnSla(record);
                return <span className={`returns-sla returns-sla--${sla.tone}`}>{sla.label}</span>;
            },
        },
        {
            title: '',
            key: 'actions',
            width: 58,
            fixed: 'right',
            render: (_, record) => {
                // Check if in history tab and completed
                const isHistoryCompleted = record.status === 'completed' && activeTab === 'history';

                const items: MenuProps['items'] = [
                    {
                        key: 'edit',
                        label: 'Sửa',
                        icon: <EditOutlined />,
                        onClick: () => handleEdit(record),
                    },
                ];

                // Only show delete if:
                // 1. Not in history OR
                // 2. In history but user is Admin
                if (!isHistoryCompleted || isAdmin) {
                    items.push({
                        key: 'delete',
                        label: 'Xóa',
                        icon: <DeleteOutlined />,
                        danger: true,
                        onClick: () => handleDelete(record.id),
                    });
                }

                return <Dropdown menu={{ items }} trigger={['click']}><Button aria-label="Xem thêm" icon={<MoreOutlined />} size="small" /></Dropdown>;
            },
        },
    ];

    // ✨ Filter returns by status
    const activeReturns = returns.filter(r => r.status !== 'completed');
    const historyReturns = returns.filter(r => r.status === 'completed');

    // ✨ Search filter
    const matchSearch = (r: Return) => {
        const q = searchText.trim().toLowerCase();
        const matchesText = !q || (
            (r.complaintCode || '').toLowerCase().includes(q) ||
            (r.orderNumber || '').toLowerCase().includes(q) ||
            (r.productName || '').toLowerCase().includes(q) ||
            (r.reason || '').toLowerCase().includes(q) ||
            (r.packer || '').toLowerCase().includes(q)
        );
        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
        const matchesFault = faultFilter === 'all' || (r.faultParty || 'warehouse') === faultFilter;
        const matchesPacker = packerFilter === 'all' || r.packer === packerFilter;
        const matchesSla = slaFilter === 'all' || getReturnSla(r).overdue;
        const complaintDate = parseReturnDate(r.complaintDate);
        const matchesDate = !dateRange || (
            complaintDate.isValid() &&
            !complaintDate.isBefore(dateRange[0].startOf('day')) &&
            !complaintDate.isAfter(dateRange[1].endOf('day'))
        );
        return matchesText && matchesStatus && matchesFault && matchesPacker && matchesSla && matchesDate;
    };
    const filteredActive = activeReturns.filter(matchSearch);
    const filteredHistory = historyReturns.filter(matchSearch);

    // Determine which data to show based on active tab
    const displayedReturns = activeTab === 'active' ? filteredActive : filteredHistory;
    const overdueCount = activeReturns.filter(item => getReturnSla(item).overdue).length;
    const waitingStatus = statusList.find(status => /wait|cho|chờ|support|cskh/i.test(`${status.value} ${status.label}`));
    const waitingCount = waitingStatus ? activeReturns.filter(item => item.status === waitingStatus.value).length : 0;
    const completedToday = historyReturns.filter(item => parseReturnDate(item.complaintDate).isSame(dayjs(), 'day')).length;
    const hasActiveFilters = Boolean(searchText.trim()) || statusFilter !== 'all' || faultFilter !== 'all' || packerFilter !== 'all' || slaFilter !== 'all' || Boolean(dateRange);

    const renderReturnsTable = (data: Return[], allowSelection = true) => (
        <Table
            className="returns-table"
            columns={columns}
            dataSource={data}
            rowKey="id"
            loading={loading}
            size="middle"
            sticky
            scroll={{ x: 1510 }}
            rowSelection={allowSelection ? {
                selectedRowKeys,
                onChange: selectedKeys => setSelectedRowKeys(selectedKeys as number[]),
                columnWidth: 48,
                getCheckboxProps: record => ({ name: record.complaintCode }),
            } : undefined}
            rowClassName={(record, index) => [
                'returns-table-row',
                activeTab === 'active' && index % 2 === 0 ? 'returns-table-row--tinted' : '',
                getReturnSla(record).overdue ? 'returns-table-row--overdue' : '',
                `returns-table-row--${getStatusTone(record.status)}`,
            ].filter(Boolean).join(' ')}
            pagination={{
                defaultPageSize: 20,
                pageSizeOptions: [10, 20, 50],
                showSizeChanger: true,
                showTotal: total => `Hiển thị ${Math.min(total, 20)} / ${total} phiếu`,
            }}
        />
    );

    return (
        <Spin spinning={importLoading} tip="Đang xử lý..." size="large">
            <div className="returns-page">
                {!dayjs().isBefore(RETURN_POLICY_NOTICE_START) && dayjs().isBefore(RETURN_POLICY_NOTICE_END) && (
                    <Alert
                        className="returns-policy-alert"
                        type="warning"
                        showIcon
                        message="Quy định xử lý trả hàng mới áp dụng từ 24/08/2026"
                        description="Hạn xử lý theo dõi trên bảng là 5 ngày. Phiếu phát sinh từ 24/08 nếu quá 7 ngày chưa Hoàn thành sẽ phạt tài khoản nguyendinhtoan từ 30.000đ/đơn và tăng thêm 10.000đ mỗi ngày. Các phiếu cũ đã quá hạn được gia hạn xử lý hết ngày 26/08; từ 27/08 nếu chưa Hoàn thành sẽ áp dụng mức phạt tương tự."
                    />
                )}
                <div className="returns-page-heading">
                    <div className="returns-page-title">
                        <span className="returns-title-icon"><SyncOutlined /></span>
                        <div>
                            <Title level={2}>Trả hàng</Title>
                            <Text type="secondary">Theo dõi, phân công và xử lý khiếu nại trả hàng</Text>
                        </div>
                    </div>
                    <div className="returns-heading-actions">
                        <Tooltip title="Làm mới dữ liệu">
                            <Button icon={<ReloadOutlined />} onClick={() => loadReturns()} loading={loading}>Tải lại</Button>
                        </Tooltip>
                        <Button icon={<FileExcelOutlined />} onClick={handleExportDisplayed}>Xuất Excel</Button>
                        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={handleAdd}>Tạo phiếu trả</Button>
                    </div>
                </div>

                <div className="returns-stat-grid">
                    <button type="button" className="returns-stat-card returns-stat-card--green" onClick={() => { setActiveTab('active'); setSlaFilter('all'); }}>
                        <span className="returns-stat-icon"><SyncOutlined /></span>
                        <span><small>Đang xử lý</small><strong>{activeReturns.length}</strong></span>
                    </button>
                    <button type="button" className="returns-stat-card returns-stat-card--red" onClick={() => { setActiveTab('active'); setSlaFilter('overdue'); }}>
                        <span className="returns-stat-icon"><ClockCircleOutlined /></span>
                        <span><small>Quá hạn</small><strong>{overdueCount}</strong></span>
                    </button>
                    <button type="button" className="returns-stat-card returns-stat-card--blue" onClick={() => { setActiveTab('active'); if (waitingStatus) setStatusFilter(waitingStatus.value); }}>
                        <span className="returns-stat-icon"><CustomerServiceOutlined /></span>
                        <span><small>Chờ CSKH</small><strong>{waitingCount}</strong></span>
                    </button>
                    <button type="button" className="returns-stat-card returns-stat-card--green" onClick={() => { setActiveTab('history'); setDateRange([dayjs().startOf('day'), dayjs().endOf('day')]); }}>
                        <span className="returns-stat-icon"><CheckCircleOutlined /></span>
                        <span><small>Hoàn tất hôm nay</small><strong>{completedToday}</strong></span>
                    </button>
                </div>

                <Card className="returns-workspace" bordered={false}>
                    <div className="returns-filter-bar">
                        <Input
                            className="returns-search"
                            placeholder="Tìm mã KN, mã đơn, sản phẩm, lý do, nhân viên..."
                            allowClear
                            prefix={<SearchOutlined />}
                            value={searchText}
                            onChange={event => setSearchText(event.target.value)}
                        />
                        <RangePicker
                            className="returns-date-filter"
                            value={dateRange}
                            format="DD/MM/YYYY"
                            placeholder={['Từ ngày', 'Đến ngày']}
                            prefix={<CalendarOutlined />}
                            onChange={value => setDateRange(value ? [value[0]!, value[1]!] : null)}
                        />
                        <Select className="returns-filter" value={statusFilter} onChange={setStatusFilter} options={[
                            { value: 'all', label: 'Tất cả trạng thái' },
                            ...statusList.map(status => ({ value: status.value, label: status.label })),
                        ]} />
                        <Select className="returns-filter" value={faultFilter} onChange={setFaultFilter} options={[
                            { value: 'all', label: 'Tất cả lỗi do' },
                            { value: 'warehouse', label: 'Lỗi do kho' },
                            { value: 'customer', label: 'Lỗi do khách hàng' },
                        ]} />
                        <Select className="returns-filter" value={packerFilter} onChange={setPackerFilter} options={[
                            { value: 'all', label: 'Tất cả nhân viên' },
                            ...employees.map(employee => ({ value: employee.username, label: employee.displayName || employee.username })),
                        ]} />
                        <Button type="primary" icon={<FilterOutlined />}>Lọc</Button>
                        {hasActiveFilters && <Button type="text" onClick={clearReturnFilters}>Xóa lọc</Button>}
                    </div>

                    <Tabs
                        className="returns-tabs"
                        activeKey={activeTab}
                        onChange={key => { setActiveTab(key as 'active' | 'history'); setSelectedRowKeys([]); }}
                        items={[
                            { key: 'active', label: <span><InboxOutlined /> Đang xử lý ({filteredActive.length})</span>, children: renderReturnsTable(filteredActive) },
                            { key: 'history', label: <span><HistoryOutlined /> Lịch sử ({filteredHistory.length})</span>, children: renderReturnsTable(filteredHistory, currentUser?.toLowerCase() === 'admin') },
                        ]}
                    />

                    {selectedRowKeys.length > 0 && (
                        <div className="returns-bulk-bar">
                            <strong>Đã chọn {selectedRowKeys.length} phiếu</strong>
                            <Dropdown menu={{ items: employees.map(employee => ({ key: employee.username, label: employee.displayName || employee.username, onClick: () => handleBulkPackerChange(employee.username) })) }}>
                                <Button icon={<UserAddOutlined />}>Gán nhân viên</Button>
                            </Dropdown>
                            <Dropdown menu={{ items: statusList.map(status => ({ key: status.value, label: status.label, onClick: () => handleBulkStatusChange(status.value) })) }}>
                                <Button icon={<SwapOutlined />}>Đổi trạng thái</Button>
                            </Dropdown>
                            <Button icon={<CommentOutlined />} onClick={() => setShowInputRows(prev => ({ ...prev, ...Object.fromEntries(selectedRowKeys.map(id => [id, true])) }))}>Thêm ghi chú</Button>
                            <Button icon={<DownloadOutlined />} onClick={handleExportDisplayed}>Xuất danh sách</Button>
                            <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>Xóa</Button>
                            <Button type="text" className="returns-bulk-close" icon={<CloseOutlined />} onClick={() => setSelectedRowKeys([])} aria-label="Bỏ chọn" />
                        </div>
                    )}
                </Card>

                {/* Method Selection Modal */}
                <Modal
                    title="📝 Chọn phương thức nhập liệu"
                    open={methodModalVisible}
                    onCancel={() => setMethodModalVisible(false)}
                    footer={null}
                    width={500}
                >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '20px 0' }}>
                        <Card
                            hoverable
                            onClick={() => handleMethodSelect('manual')}
                            style={{ textAlign: 'center', cursor: 'pointer' }}
                        >
                            <FormOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
                            <Title level={4}>Nhập thủ công</Title>
                            <Text type="secondary">Nhập từng phiếu một</Text>
                        </Card>

                        <Card
                            hoverable
                            onClick={() => handleMethodSelect('excel')}
                            style={{ textAlign: 'center', cursor: 'pointer' }}
                        >
                            <FileExcelOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                            <Title level={4}>Import Excel</Title>
                            <Text type="secondary">Upload file hàng loạt</Text>
                        </Card>
                    </div>
                </Modal>

                {/* Manual Input Modal */}
                <Modal
                    title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 40 }}>
                            <span>{editingReturn ? '✏️ Sửa phiếu trả' : '➕ Tạo phiếu trả mới'}</span>
                            <Button
                                icon={<SettingOutlined />}
                                onClick={() => setSettingsVisible(true)}
                                size="small"
                            >
                                Cài đặt
                            </Button>
                        </div>
                    }
                    open={modalVisible}
                    onCancel={() => {
                        setModalVisible(false);
                        setEditingReturn(null);
                    }}
                    footer={null}
                    width={700}
                >
                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleSubmit}
                    >
                        {/* ✨ UPDATED LAYOUT - COMPACT FORM */}
                        {/* Row 1: Mã khiếu nại + Thời gian khiếu nại */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item
                                label="Mã số khiếu nại"
                                name="complaintCode"
                                rules={[{ required: true, message: 'Vui lòng nhập mã khiếu nại!' }]}
                            >
                                <Input placeholder="Nhập mã số khiếu nại" size="large" />
                            </Form.Item>

                            <Form.Item
                                label="Thời gian khiếu nại"
                                name="complaintDate"
                                rules={[{ required: true, message: 'Vui lòng chọn ngày!' }]}
                            >
                                <DatePicker style={{ width: '100%' }} size="large" format="DD/MM/YYYY" />
                            </Form.Item>
                        </div>

                        {/* Row 2: Mã đơn hàng + Lí do */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item
                                label="Mã đơn hàng"
                                name="orderNumber"
                                rules={[{ required: true, message: 'Vui lòng nhập mã đơn!' }]}
                            >
                                <Input placeholder="Mã đơn hàng" size="large" />
                            </Form.Item>

                            <Form.Item
                                label="Lí do Trả hàng/Hoàn tiền"
                                name="reason"
                                rules={[{ required: true, message: 'Vui lòng nhập lý do!' }]}
                            >
                                <Select size="large" placeholder="Chọn lý do">
                                    <Select.Option value="Lỗi sản phẩm">Lỗi sản phẩm</Select.Option>
                                    <Select.Option value="Không đúng mô tả">Không đúng mô tả</Select.Option>
                                    <Select.Option value="Giao nhầm">Giao nhầm</Select.Option>
                                    <Select.Option value="Khách đổi ý">Khách đổi ý</Select.Option>
                                    <Select.Option value="Khác">Khác</Select.Option>
                                </Select>
                            </Form.Item>
                        </div>

                        {/* Lỗi do */}
                        <Form.Item
                            label={
                                <span>
                                    ⚖️ Lỗi do{' '}
                                    <Tag color="orange" style={{ fontSize: 11, marginLeft: 4 }}>Ảnh hưởng tính phạt</Tag>
                                </span>
                            }
                            name="faultParty"
                            initialValue="warehouse"
                            rules={[{ required: true, message: 'Vui lòng chọn!' }]}
                        >
                            <Select size="large">
                                <Select.Option value="warehouse">
                                    <Tag color="red">🏭 Lỗi do kho</Tag>
                                    &nbsp;— Sẽ tự động ghi phạt nhân viên đóng gói
                                </Select.Option>
                                <Select.Option value="customer">
                                    <Tag color="blue">👤 Lỗi do khách hàng</Tag>
                                    &nbsp;— Không ghi phạt
                                </Select.Option>
                            </Select>
                        </Form.Item>

                        <Form.Item
                            label="Tên sản phẩm"
                            name="productName"
                            rules={[{ required: true, message: 'Vui lòng nhập tên sản phẩm!' }]}
                        >
                            <Input placeholder="Tên sản phẩm" size="large" />
                        </Form.Item>

                        {/* Row 3: Trạng thái + Nhân viên */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item
                                label="Trạng thái"
                                name="status"
                                initialValue="pending"
                            >
                                <Select size="large" placeholder="Chọn trạng thái...">
                                    {statusList.map(status => (
                                        <Select.Option key={status.value} value={status.value}>
                                            <Tag color={status.color}>{status.label}</Tag>
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item label="Nhân viên đóng gói" name="packer" initialValue={currentUser} rules={[{ required: true, message: 'Vui lòng chọn nhân viên đóng gói!' }]}>
                                <Select size="large" placeholder="Chọn nhân viên..." showSearch allowClear>
                                    {employees.map(emp => (
                                        <Select.Option key={emp.username} value={emp.username}>
                                            👤 {emp.displayName || emp.username}
                                        </Select.Option>
                                    ))}
                                </Select>
                            </Form.Item>
                        </div>

                        {/* Process Notes Timeline */}
                        <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
                            <Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
                                📝 GHI CHÚ XỬ LÝ
                            </Title>

                            {/* Timeline List */}
                            {processLogs.length > 0 && (
                                <div style={{ marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
                                    {processLogs.map((log, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                display: 'flex',
                                                gap: 12,
                                                padding: '8px 12px',
                                                background: 'white',
                                                borderRadius: 6,
                                                marginBottom: 8,
                                                border: '1px solid #d9d9d9',
                                            }}
                                        >
                                            <Tag color="blue" style={{ alignSelf: 'flex-start' }}>
                                                {log.timestamp}
                                            </Tag>
                                            {log.createdBy && (
                                                <Tag color="geekblue" style={{ alignSelf: 'flex-start', fontSize: 12 }}>
                                                    @{log.createdBy}
                                                </Tag>
                                            )}
                                            <div style={{ flex: 1, fontSize: 14 }}>{log.note}</div>
                                            <Button
                                                type="text"
                                                danger
                                                size="small"
                                                icon={<DeleteOutlined />}
                                                onClick={() => handleRemoveLog(index)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add Log Input */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Input.TextArea
                                    rows={2}
                                    placeholder="Nhập nội dung ghi chú xử lý..."
                                    value={tempNote}
                                    onChange={(e) => setTempNote(e.target.value)}
                                    onPressEnter={(e) => {
                                        if (e.shiftKey) return;
                                        e.preventDefault();
                                        handleAddLog();
                                    }}
                                />
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={handleAddLog}
                                    style={{ height: 'auto' }}
                                >
                                    Thêm
                                </Button>
                            </div>

                            <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                                💡 Timestamp sẽ tự động thêm khi bạn click "Thêm". Press Enter để thêm nhanh.
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                            <Button onClick={() => setModalVisible(false)} size="large">
                                Hủy
                            </Button>
                            <Button type="primary" danger htmlType="submit" size="large">
                                {editingReturn ? 'Cập nhật' : 'Tạo phiếu trả'}
                            </Button>
                        </div>
                    </Form>
                </Modal>

                {/* Excel Import Modal */}
                <Modal
                    title="📊 Import Excel - Trả hàng"
                    open={inputMethod === 'excel' && !modalVisible}
                    onCancel={() => setInputMethod('manual')}
                    footer={null}
                    width={700}
                >
                    <div style={{ marginBottom: 24 }}>
                        <Title level={5}>📋 Các cột cần có trong file Excel:</Title>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13, color: '#595959' }}>
                            <div>• <strong>Mã số khiếu nại</strong> / Return Order ID</div>
                            <div>• <strong>Tên sản phẩm</strong> / Product Name <Tag color="red">Bắt buộc</Tag></div>
                            <div>• <strong>Mã đơn hàng</strong> / Order ID</div>
                            <div>• <strong>Thời gian khiếu nại</strong> / Time Requested</div>
                            <div>• <strong>Trạng thái Trả hàng/Hoàn tiền</strong> / Return Status</div>
                            <div>• <strong>Lí do Trả hàng/Hoàn tiền</strong> / Return Reason</div>
                        </div>
                    </div>

                    <Upload.Dragger
                        accept=".xlsx,.xls"
                        beforeUpload={handleImportExcel}
                        maxCount={1}
                        showUploadList={false}
                    >
                        <p className="ant-upload-drag-icon">
                            <UploadOutlined style={{ fontSize: 48, color: '#52c41a' }} />
                        </p>
                        <p className="ant-upload-text">Click hoặc kéo file Excel vào đây</p>
                        <p className="ant-upload-hint">
                            Hỗ trợ file .xlsx và .xls
                        </p>
                    </Upload.Dragger>


                    <div style={{ marginTop: 16, padding: 12, background: '#fff7e6', borderRadius: 8, border: '1px dashed #ffa940' }}>
                        <p style={{ margin: 0, fontSize: 13, color: '#ad6800' }}>
                            💡 <strong>Lưu ý:</strong> File sẽ tự động tạo phiếu trả cho mỗi dòng dữ liệu hợp lệ.
                            Các phiếu mới sẽ được thêm vào đầu danh sách.
                        </p>
                    </div>
                </Modal>

                {/* Settings Modal */}
                <Modal
                    title="⚙️ Cài đặt danh sách"
                    open={settingsVisible}
                    onCancel={() => setSettingsVisible(false)}
                    footer={[
                        <Button key="close" type="primary" onClick={() => setSettingsVisible(false)}>
                            Đóng
                        </Button>
                    ]}
                    width={600}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        {/* Status Management */}
                        <div>
                            <Title level={5}>📊 Quản lý Trạng thái</Title>
                            <div style={{ padding: '16px', background: '#fafafa', borderRadius: 8 }}>
                                {/* Add new status */}
                                <div style={{ marginBottom: 16 }}>
                                    <Text strong style={{ fontSize: 13, color: '#595959' }}>➕ Thêm trạng thái mới</Text>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                        <Input
                                            placeholder="Tên trạng thái mới..."
                                            value={newStatusLabel}
                                            onChange={(e) => setNewStatusLabel(e.target.value)}
                                            onPressEnter={() => {
                                                if (newStatusLabel.trim()) {
                                                    const newValue = newStatusLabel.trim().toLowerCase().replace(/\\s+/g, '-');
                                                    const exists = statusList.some(s => s.value === newValue);
                                                    if (!exists) {
                                                        const colors = ['blue', 'purple', 'red', 'volcano', 'gold', 'lime', 'geekblue', 'cyan', 'green', 'orange', 'magenta'];
                                                        const randomColor = colors[Math.floor(Math.random() * colors.length)];
                                                        const updated = [...statusList, {
                                                            value: newValue,
                                                            label: newStatusLabel.trim(),
                                                            color: randomColor
                                                        }];
                                                        saveStatusList(updated);
                                                        setNewStatusLabel('');
                                                        message.success('Đã thêm trạng thái mới!');
                                                    } else {
                                                        message.warning('Trạng thái này đã tồn tại!');
                                                    }
                                                }
                                            }}
                                        />
                                        <Button
                                            type="primary"
                                            icon={<PlusOutlined />}
                                            onClick={() => {
                                                if (newStatusLabel.trim()) {
                                                    const newValue = newStatusLabel.trim().toLowerCase().replace(/\\s+/g, '-');
                                                    const exists = statusList.some(s => s.value === newValue);
                                                    if (!exists) {
                                                        const colors = ['blue', 'purple', 'red', 'volcano', 'gold', 'lime', 'geekblue', 'cyan', 'green', 'orange', 'magenta'];
                                                        const randomColor = colors[Math.floor(Math.random() * colors.length)];
                                                        const updated = [...statusList, {
                                                            value: newValue,
                                                            label: newStatusLabel.trim(),
                                                            color: randomColor
                                                        }];
                                                        saveStatusList(updated);
                                                        setNewStatusLabel('');
                                                        message.success('Đã thêm trạng thái mới!');
                                                    } else {
                                                        message.warning('Trạng thái này đã tồn tại!');
                                                    }
                                                }
                                            }}
                                        >
                                            Thêm
                                        </Button>
                                    </div>
                                </div>

                                {/* List existing statuses */}
                                <div>
                                    <Text strong style={{ fontSize: 13, color: '#595959' }}>📋 Danh sách hiện tại ({statusList.length})</Text>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                        {statusList.map(status => (
                                            <Tag
                                                key={status.value}
                                                closable
                                                onClose={(e) => {
                                                    e.preventDefault();
                                                    Modal.confirm({
                                                        title: 'Xóa trạng thái?',
                                                        content: `Bạn có chắc muốn xóa "${status.label}" khỏi danh sách?`,
                                                        okText: 'Xóa',
                                                        cancelText: 'Hủy',
                                                        okButtonProps: { danger: true },
                                                        onOk: () => {
                                                            const updated = statusList.filter(s => s.value !== status.value);
                                                            saveStatusList(updated);
                                                            message.success(`Đã xóa "${status.label}"!`);
                                                        },
                                                    });
                                                }}
                                                color={status.color}
                                                style={{ fontSize: 13 }}
                                            >
                                                {status.label}
                                            </Tag>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>


                    </div>
                </Modal>
            </div>
        </Spin>
    );
}
