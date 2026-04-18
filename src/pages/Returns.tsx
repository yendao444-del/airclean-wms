import { useState, useEffect } from 'react';
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
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, UploadOutlined, FormOutlined, FileExcelOutlined, MoreOutlined, SettingOutlined, BarcodeOutlined, ScanOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
import { useAuth } from '../contexts/AuthContext';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

const { Title, Text } = Typography;

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

    // ✨ State cho collapse/expand logs
    const [collapsedLogs, setCollapsedLogs] = useState<Record<number, boolean>>({});

    useEffect(() => {
        loadReturns();
        loadEmployees();
        loadStatusList();
        const interval = setInterval(() => loadReturns(true), 30000);
        return () => clearInterval(interval);
    }, []);

    const loadEmployees = async () => {
        try {
            const api = (window as any).electronAPI;
            const res = await api.users.getAll();
            if (res.success && res.data) {
                setEmployees(res.data.filter((u: any) => u.username !== 'admin'));
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

    const processReturnFine = async (packerName: string, complaintCode: string) => {
        if (!packerName) return;
        try {
            const electronApi = (window as any).electronAPI;
            const attRes = await electronApi.appConfig.get('attendanceData');
            if (attRes.success && attRes.data) {
                const attData = typeof attRes.data === 'string' ? JSON.parse(attRes.data) : attRes.data;
                const config = attData.config || {};
                const attEmployees = attData.employees || [];

                const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                const packerNorm = norm(packerName);
                const packerEmp = attEmployees.find((e: any) =>
                    e.username === packerName ||
                    e.name === packerName ||
                    (e.username && norm(e.username) === packerNorm) ||
                    (e.username && packerNorm.includes(norm(e.username)))
                );
                if (!packerEmp) {
                    console.warn(`[Returns] Không tìm thấy NV "${packerName}" trong danh sách chấm công.`);
                    message.warning(`⚠️ Không tìm thấy nhân viên "${packerName}" trong danh sách chấm công. Phạt chưa được ghi nhận!`);
                    return;
                }

                const isSeasonal = packerEmp.type === 'Seasonal';
                const amount = isSeasonal ? (config.wrongOrderFineSeasonal || 0) : (config.wrongOrderFineOfficial || 0);

                if (amount > 0) {
                    const newFine = {
                        empId: packerEmp.id,
                        type: 'Khác',
                        detail: `Đóng gói sai đơn, phát sinh KH hoàn hàng/khiếu nại (Mã phiếu: ${complaintCode})`,
                        amount: amount,
                        date: new Date().toISOString(),
                        source: 'returns'
                    };

                    attData.extraFines = [...(attData.extraFines || []), newFine];
                    await electronApi.appConfig.set('attendanceData', attData);
                    window.dispatchEvent(new CustomEvent('attendance:fineAdded', { detail: newFine }));
                    message.warning(`⚠️ Đã tự động ghi nhận mức phạt ${amount.toLocaleString('vi-VN')}đ cho NV ${packerEmp.displayName || packerEmp.name} (Lỗi trả hàng)!`);
                }
            }
        } catch (error) {
            console.error('Lỗi tính phạt tự động:', error);
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
                    await processReturnFine(values.packer, values.complaintCode);
                }
            } else if (values.status === 'completed' && values.packer && faultParty === 'customer') {
                console.log(`[Returns] Bỏ qua ghi phạt - Lỗi do khách hàng (phiếu: ${values.complaintCode})`);
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
                    let parsedDate = dayjs(complaintDate);
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

    const columns: ColumnsType<Return> = [
        {
            title: 'Thông tin đơn hàng',
            key: 'info',
            width: 320,
            render: (_, record) => {
                return (
                    <div style={{ lineHeight: 1.7, fontSize: 12 }}>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>Mã KN:</Text>
                                <div><Tag color="orange" style={{ fontSize: 11 }}>{record.complaintCode}</Tag></div>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {logs.length === 0 && !showInput && (
                            <Text type="secondary" italic style={{ fontSize: 12 }}>
                                Chưa có ghi chú
                            </Text>
                        )}

                        {displayLogs.map((log, index) => (
                            <div
                                key={index}
                                style={{
                                    padding: '4px 8px',
                                    background: '#f5f5f5',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    lineHeight: 1.5,
                                }}
                            >
                                <Tag color="blue" style={{ fontSize: 10, marginRight: 4 }}>
                                    {log.timestamp}
                                </Tag>
                                {log.createdBy && (
                                    <Tag color="geekblue" style={{ fontSize: 10, marginRight: 4 }}>
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
                                type="dashed"
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
            title: 'Nhân viên đóng gói',
            dataIndex: 'packer',
            key: 'packer',
            width: 170,
            render: (packer, record) => {
                // Disable packer change in history tab
                const isInHistory = !isAdmin;

                return (
                    <Select
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
                    >
                        {employees.map((emp) => (
                            <Select.Option key={emp.username} value={emp.username} label={`👤 ${emp.displayName || emp.username}`}>
                                <span>👤 {emp.displayName || emp.username}</span>
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
                        value={faultParty === 'customer' ? 'customer' : 'warehouse'}
                        size="small"
                        style={{ width: '100%' }}
                        disabled={isCompleted}
                        onChange={async (value) => {
                            // Optimistic update: cập nhật UI ngay lập tức
                            const updated = returns.map(r =>
                                r.id === record.id ? { ...r, faultParty: value as 'warehouse' | 'customer' } : r
                            );
                            setReturns(updated);
                            try {
                                const result = await window.electronAPI.returns.update(record.id, { faultParty: value });
                                if (!result.success) throw new Error(result.error || 'Lỗi DB');
                                message.success('Đã cập nhật!');
                            } catch (err: any) {
                                // Hoàn tác nếu lỗi
                                await loadReturns();
                                message.error(`Lỗi cập nhật: ${err.message}`);
                            }
                        }}
                    >
                        <Select.Option value="warehouse">Lỗi do kho</Select.Option>
                        <Select.Option value="customer">Lỗi do khách hàng</Select.Option>
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
                                            await processReturnFine(record.packer, record.complaintCode);
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
            title: '',
            key: 'actions',
            width: 90,
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

                return (
                    <Dropdown menu={{ items }} trigger={['click']}>
                        <Button icon={<MoreOutlined />} size="small">
                            Xem thêm
                        </Button>
                    </Dropdown>
                );
            },
        },
    ];

    // ✨ Filter returns by status
    const activeReturns = returns.filter(r => r.status !== 'completed');
    const historyReturns = returns.filter(r => r.status === 'completed');

    // Determine which data to show based on active tab
    const displayedReturns = activeTab === 'active' ? activeReturns : historyReturns;

    return (
        <Spin spinning={importLoading} tip="⏳ Đang xử lý..." size="large">
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <Title level={2} style={{ color: '#262626', margin: 0 }}>
                        🔄 Trả hàng
                        {selectedRowKeys.length > 0 && (
                            <span style={{ fontSize: 14, fontWeight: 400, color: '#ff4d4f', marginLeft: 12 }}>
                                ({selectedRowKeys.length} phiếu đã chọn)
                            </span>
                        )}
                    </Title>
                    <Space>
                        {selectedRowKeys.length > 0 && (
                            <Button
                                danger
                                icon={<DeleteOutlined />}
                                onClick={handleBulkDelete}
                                size="large"
                            >
                                Xóa đã chọn ({selectedRowKeys.length})
                            </Button>
                        )}
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={() => loadReturns()}
                            loading={loading}
                        >
                            Tải lại
                        </Button>
                        <Button type="primary" danger icon={<PlusOutlined />} size="large" onClick={handleAdd}>
                            Tạo phiếu trả
                        </Button>
                    </Space>
                </div>

                <Card>
                    <Tabs
                        activeKey={activeTab}
                        onChange={(key) => {
                            setActiveTab(key as 'active' | 'history');
                            setSelectedRowKeys([]); // Clear selection when switching tabs
                        }}
                        items={[
                            {
                                key: 'active',
                                label: (
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                                        📦 Đang xử lý ({activeReturns.length})
                                    </span>
                                ),
                                children: (
                                    <Table
                                        columns={columns}
                                        dataSource={activeReturns}
                                        rowKey="id"
                                        loading={loading}
                                        scroll={{ x: 1400 }}
                                        rowSelection={{
                                            selectedRowKeys,
                                            onChange: (selectedKeys) => {
                                                setSelectedRowKeys(selectedKeys as number[]);
                                            },
                                            columnWidth: 50,
                                            getCheckboxProps: (record) => ({
                                                name: record.complaintCode,
                                            }),
                                        }}
                                        rowClassName={(record) => {
                                            return record.status ? `status-row-${record.status}` : '';
                                        }}
                                        pagination={{
                                            pageSize: 25,
                                            showSizeChanger: true,
                                            showTotal: (total) => `Tổng ${total} phiếu`,
                                        }}
                                    />
                                ),
                            },
                            {
                                key: 'history',
                                label: (
                                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                                        📜 Lịch sử ({historyReturns.length})
                                    </span>
                                ),
                                children: (
                                    <Table
                                        columns={columns}
                                        dataSource={historyReturns}
                                        rowKey="id"
                                        loading={loading}
                                        scroll={{ x: 1400 }}
                                        rowSelection={
                                            currentUser?.toLowerCase() === 'admin' ? {
                                                selectedRowKeys,
                                                onChange: (selectedKeys) => {
                                                    setSelectedRowKeys(selectedKeys as number[]);
                                                },
                                                columnWidth: 50,
                                                getCheckboxProps: (record) => ({
                                                    name: record.complaintCode,
                                                }),
                                            } : undefined
                                        }
                                        rowClassName={(record) => {
                                            return record.status ? `status-row-${record.status}` : '';
                                        }}
                                        pagination={{
                                            pageSize: 25,
                                            showSizeChanger: true,
                                            showTotal: (total) => `Tổng ${total} phiếu (Đã hoàn thành)`,
                                        }}
                                    />
                                ),
                            },
                        ]}
                    />
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
