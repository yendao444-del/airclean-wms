import { useState, useEffect } from 'react';
import {
    Card,
    Button,
    Table,
    Modal,
    Form,
    Input,
    Select,
    message,
    Space,
    Typography,
    DatePicker,
    Tag,
    Upload,
    Dropdown,
    Tabs,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, UploadOutlined, FormOutlined, FileExcelOutlined, MoreOutlined, SettingOutlined, BarcodeOutlined, ScanOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { useCurrentUser } from '../lib/hooks/useCurrentUser';
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
    createdAt?: Date;
}

interface ProcessLog {
    timestamp: string; // DD/MM HH:mm
    note: string;
}

export default function ReturnsPage() {
    const currentUser = useCurrentUser();
    const [returns, setReturns] = useState<Return[]>([]);
    const [loading, setLoading] = useState(false);
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

    // Packer list management
    const [packerList, setPackerList] = useState<string[]>([]);
    const [newPackerName, setNewPackerName] = useState('');

    // Status list management
    const [statusList, setStatusList] = useState<Array<{ value: string; label: string; color: string }>>([]);
    const [newStatusLabel, setNewStatusLabel] = useState('');

    // ✨ State cho chọn nhiều để xóa
    const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

    // ✨ State cho tab Lịch sử
    const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

    // ✨ State cho collapse/expand logs
    const [collapsedLogs, setCollapsedLogs] = useState<Record<number, boolean>>({});


    useEffect(() => {
        loadReturns();
        loadPackerList();
        loadStatusList();
    }, []);

    const loadPackerList = () => {
        try {
            const stored = localStorage.getItem('packerList');
            if (stored) {
                setPackerList(JSON.parse(stored));
            } else {
                // Default packers
                const defaultPackers = ['Ngô Minh Toàn', 'Nguyễn Văn A', 'Trần Thị B'];
                setPackerList(defaultPackers);
                localStorage.setItem('packerList', JSON.stringify(defaultPackers));
            }
        } catch (error) {
            console.error('Error loading packer list:', error);
            setPackerList([]);
        }
    };

    const savePackerList = (list: string[]) => {
        try {
            localStorage.setItem('packerList', JSON.stringify(list));
            setPackerList(list);
        } catch (error) {
            console.error('Error saving packer list:', error);
        }
    };

    const loadStatusList = () => {
        try {
            const stored = localStorage.getItem('statusList');
            if (stored) {
                setStatusList(JSON.parse(stored));
            } else {
                // Default statuses
                const defaultStatuses = [
                    { value: 'pending', label: 'Đang xử lý', color: 'gold' },
                    { value: 'completed', label: 'Hoàn thành', color: 'green' },
                ];
                setStatusList(defaultStatuses);
                localStorage.setItem('statusList', JSON.stringify(defaultStatuses));
            }
        } catch (error) {
            console.error('Error loading status list:', error);
            setStatusList([]);
        }
    };

    const saveStatusList = (list: Array<{ value: string; label: string; color: string }>) => {
        try {
            localStorage.setItem('statusList', JSON.stringify(list));
            setStatusList(list);
        } catch (error) {
            console.error('Error saving status list:', error);
        }
    };

    const loadReturns = async () => {
        setLoading(true);
        try {
            const stored = localStorage.getItem('returns');
            if (stored) {
                setReturns(JSON.parse(stored));
            }
        } catch (error) {
            message.error('Lỗi khi tải dữ liệu');
        } finally {
            setLoading(false);
        }
    };

    const saveReturns = (newReturns: Return[]) => {
        localStorage.setItem('returns', JSON.stringify(newReturns));
        setReturns(newReturns);
    };

    const handleAdd = () => {
        setEditingReturn(null);
        setProcessLogs([]);
        setTempNote('');
        form.resetFields();
        setMethodModalVisible(true);
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
        };

        setProcessLogs([...processLogs, newLog]);
        setTempNote('');
        message.success('Đã thêm ghi chú!');
    };

    const handleRemoveLog = (index: number) => {
        setProcessLogs(processLogs.filter((_, i) => i !== index));
    };

    const handleDelete = (id: number) => {
        Modal.confirm({
            title: 'Xóa phiếu trả?',
            content: 'Bạn có chắc muốn xóa phiếu này?',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: () => {
                const updatedReturns = returns.filter(r => r.id !== id);
                saveReturns(updatedReturns);
                message.success('Đã xóa phiếu trả!');
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
                    const updatedReturns = returns.filter(r => !selectedRowKeys.includes(r.id));
                    saveReturns(updatedReturns);

                    message.success(`Đã xóa ${selectedRowKeys.length} phiếu trả!`);
                    setSelectedRowKeys([]);
                } catch (error) {
                    message.error('Lỗi khi xóa phiếu trả hàng loạt!');
                }
            },
        });
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();

            let updatedReturns: Return[];

            if (editingReturn) {
                // EDIT MODE
                const updatedReturn: Return = {
                    ...editingReturn,
                    complaintCode: values.complaintCode,
                    orderNumber: values.orderNumber,
                    productName: values.productName,
                    complaintDate: values.complaintDate.format('YYYY-MM-DD'),
                    status: values.status,
                    reason: values.reason,
                    packer: values.packer || undefined,
                    processNotes: processLogs.length > 0 ? JSON.stringify(processLogs) : undefined,
                };

                updatedReturns = returns.map(r =>
                    r.id === editingReturn.id ? updatedReturn : r
                );
            } else {
                // CREATE MODE
                const newId = returns.length > 0
                    ? Math.max(...returns.map(r => r.id)) + 1
                    : 1;

                const newReturn: Return = {
                    id: newId,
                    complaintCode: values.complaintCode,
                    orderNumber: values.orderNumber,
                    productName: values.productName,
                    complaintDate: values.complaintDate.format('YYYY-MM-DD'),
                    status: values.status,
                    reason: values.reason,
                    packer: values.packer || undefined,
                    processNotes: processLogs.length > 0 ? JSON.stringify(processLogs) : undefined,
                    createdAt: new Date(),
                };

                updatedReturns = [newReturn, ...returns];
            }


            saveReturns(updatedReturns);

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

                const changeDescriptions = [];
                if (changes.status) {
                    changeDescriptions.push(`trạng thái từ "${changes.status.old}" → "${changes.status.new}"`);
                }
                if (changes.packer) {
                    changeDescriptions.push(`nhân viên đóng gói: ${changes.packer.old} → ${changes.packer.new}`);
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
                    description: `Tạo phiếu trả hàng mới "${newReturn.complaintCode}" (Đơn: ${newReturn.orderNumber}, Sản phẩm: ${newReturn.productName})`,
                    userName: currentUser,
                    severity: 'INFO'
                });
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
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log('📊 Raw Excel data:', jsonData);

                const newReturns: Return[] = [];
                let startId = returns.length > 0 ? Math.max(...returns.map(r => r.id)) + 1 : 1;

                jsonData.forEach((row: any) => {
                    const complaintCode = row['Mã số khiếu nại'] || row['Ma so khieu nai'] || row['Return Order ID'] || `AUTO-${Date.now()}`;
                    const orderNumber = row['Mã đơn hàng'] || row['Ma don hang'] || row['Order ID'] || '';
                    const productName = row['Tên sản phẩm'] || row['Ten san pham'] || row['Product Name'] || '';
                    const complaintDate = row['Thời gian khiếu nại'] || row['Thoi gian khieu nai'] || row['Time Requested'] || '';
                    const status = row['Trạng thái Trả hàng/Hoàn tiền'] || row['Trang thai Tra hang/Hoan tien'] || row['Return Status'] || 'pending';
                    const reason = row['Lí do Trả hàng/Hoàn tiền'] || row['Li do Tra hang/Hoan tien'] || row['Buyer Note'] || row['Return Reason'] || '';

                    if (!productName) {
                        console.warn('⚠️ Skip row: missing product name', row);
                        return;
                    }

                    const newReturn: Return = {
                        id: startId++,
                        complaintCode,
                        orderNumber,
                        productName,
                        complaintDate: complaintDate ? dayjs(complaintDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
                        status: status.includes('Hoàn thành') || status.includes('Hoan thanh') || status.includes('Refund rejected') || status.includes('Complete') ? 'completed' : 'pending',
                        reason,
                        createdAt: new Date(),
                    };

                    newReturns.push(newReturn);
                });

                if (newReturns.length === 0) {
                    message.warning('Không tìm thấy dữ liệu hợp lệ trong file Excel!');
                    return;
                }

                const updatedReturns = [...newReturns, ...returns];
                saveReturns(updatedReturns);

                message.success(`✅ Đã import ${newReturns.length} phiếu trả hàng từ Excel!`);
            } catch (error) {
                console.error('Import error:', error);
                message.error('Lỗi khi đọc file Excel!');
            }
        };

        reader.readAsBinaryString(file);
        return false;
    };

    const columns: ColumnsType<Return> = [
        {
            title: 'Thông tin đơn hàng',
            key: 'info',
            width: 350,
            render: (_, record) => {
                return (
                    <div style={{ lineHeight: 1.8 }}>
                        {/* Row 1: Mã khiếu nại + Thời gian */}
                        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>Mã số khiếu nại:</Text>
                                <div><Tag color="orange">{record.complaintCode}</Tag></div>
                            </div>
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>Thời gian khiếu nại:</Text>
                                <div><Text strong>{dayjs(record.complaintDate).format('DD/MM/YYYY')}</Text></div>
                            </div>
                        </div>

                        {/* Row 2: Mã đơn hàng + Lý do */}
                        <div style={{ display: 'flex', gap: 16 }}>
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>Mã đơn hàng:</Text>
                                <div><Text>{record.orderNumber}</Text></div>
                            </div>
                            <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>Lí do:</Text>
                                <div><Text>{record.reason}</Text></div>
                            </div>
                        </div>
                    </div>
                );
            },
        },
        {
            title: 'Tên sản phẩm',
            dataIndex: 'productName',
            key: 'productName',
            width: 200,
        },
        {
            title: 'Ghi chú xử lý',
            key: 'processNotes',
            width: 350,
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

                const handleQuickAdd = () => {
                    if (!quickNote.trim()) {
                        message.warning('Vui lòng nhập nội dung ghi chú!');
                        return;
                    }

                    const now = dayjs();
                    const timestamp = now.format('DD/MM HH[h]mm');

                    const newLog: ProcessLog = {
                        timestamp,
                        note: quickNote.trim(),
                    };

                    const updatedLogs = [...logs, newLog];
                    const updatedReturn: Return = {
                        ...record,
                        processNotes: JSON.stringify(updatedLogs),
                    };

                    const updatedReturns = returns.map(r =>
                        r.id === record.id ? updatedReturn : r
                    );
                    saveReturns(updatedReturns);

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
            width: 200,
            render: (packer, record) => {
                // Disable packer change in history tab
                const isInHistory = activeTab === 'history' && record.status === 'completed';

                return (
                    <Select
                        value={packer || undefined}
                        placeholder="Chọn nhân viên..."
                        disabled={isInHistory}
                        onChange={(value) => {
                            const updated = returns.map(r =>
                                r.id === record.id ? { ...r, packer: value } : r
                            );
                            setReturns(updated);
                            localStorage.setItem('returns', JSON.stringify(updated));
                            message.success('Đã cập nhật nhân viên đóng gói!');
                        }}
                        style={{ width: '100%' }}
                        size="small"
                        allowClear
                        showSearch
                        optionLabelProp="label"
                        dropdownRender={(menu) => (
                            <>
                                {menu}
                                <div style={{ padding: '8px 12px', borderTop: '1px solid #f0f0f0', marginTop: 4 }}>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <Input
                                            placeholder="Thêm nhanh..."
                                            value={newPackerName}
                                            onChange={(e) => setNewPackerName(e.target.value)}
                                            onPressEnter={(e) => {
                                                e.stopPropagation();
                                                if (newPackerName.trim() && !packerList.includes(newPackerName.trim())) {
                                                    const updated = [...packerList, newPackerName.trim()];
                                                    savePackerList(updated);
                                                    setNewPackerName('');
                                                    message.success('Đã thêm nhân viên mới!');
                                                } else if (packerList.includes(newPackerName.trim())) {
                                                    message.warning('Nhân viên này đã tồn tại!');
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
                                                if (newPackerName.trim() && !packerList.includes(newPackerName.trim())) {
                                                    const updated = [...packerList, newPackerName.trim()];
                                                    savePackerList(updated);
                                                    setNewPackerName('');
                                                    message.success('Đã thêm nhân viên mới!');
                                                } else if (packerList.includes(newPackerName.trim())) {
                                                    message.warning('Nhân viên này đã tồn tại!');
                                                }
                                            }}
                                            size="small"
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    >
                        {packerList.map(name => (
                            <Select.Option key={name} value={name} label={`👤 ${name}`}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>👤 {name}</span>
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            Modal.confirm({
                                                title: 'Xóa nhân viên?',
                                                content: `Bạn có chắc muốn xóa "${name}" khỏi danh sách?`,
                                                okText: 'Xóa',
                                                okType: 'danger',
                                                cancelText: 'Hủy',
                                                onOk: () => {
                                                    const updated = packerList.filter(p => p !== name);
                                                    savePackerList(updated);
                                                    message.success('Đã xóa nhân viên!');
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
            title: 'Trạng thái',
            dataIndex: 'status',
            key: 'status',
            width: 200,
            render: (status, record) => {
                const getStatusTag = (statusValue: string) => {
                    const statusConfig = statusList.find(s => s.value === statusValue);
                    if (statusConfig) {
                        return <Tag color={statusConfig.color}>{statusConfig.label}</Tag>;
                    }
                    return <Tag>{statusValue}</Tag>;
                };

                // Disable status change in history tab
                const isInHistory = activeTab === 'history' && status === 'completed';

                return (
                    <Select
                        value={status}
                        disabled={isInHistory}
                        onChange={(newStatus) => {
                            // Validation: Nếu chuyển sang "completed" mà chưa có packer
                            if (newStatus === 'completed' && !record.packer) {
                                message.warning('⚠️ Vui lòng điền "Nhân viên đóng gói" trước khi chuyển sang Hoàn thành!');
                                return;
                            }

                            const updatedReturns = returns.map(r =>
                                r.id === record.id ? { ...r, status: newStatus } : r
                            );
                            saveReturns(updatedReturns);
                            message.success('Đã cập nhật trạng thái!');
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
            title: 'Xem thêm',
            key: 'actions',
            width: 100,
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
                if (!isHistoryCompleted || currentUser?.toLowerCase() === 'admin') {
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
                        onClick={loadReturns}
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

                        <Form.Item label="Nhân viên đóng gói" name="packer">
                            <Select size="large" placeholder="Chọn nhân viên..." showSearch allowClear>
                                {packerList.map(name => (
                                    <Select.Option key={name} value={name}>
                                        👤 {name}
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

                    {/* Packer Management */}
                    <div>
                        <Title level={5}>👤 Quản lý Nhân viên đóng gói</Title>
                        <div style={{ padding: '16px', background: '#fafafa', borderRadius: 8 }}>
                            {/* Add new packer */}
                            <div style={{ marginBottom: 16 }}>
                                <Text strong style={{ fontSize: 13, color: '#595959' }}>➕ Thêm nhân viên mới</Text>
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <Input
                                        placeholder="Tên nhân viên mới..."
                                        value={newPackerName}
                                        onChange={(e) => setNewPackerName(e.target.value)}
                                        onPressEnter={() => {
                                            if (newPackerName.trim() && !packerList.includes(newPackerName.trim())) {
                                                const updated = [...packerList, newPackerName.trim()];
                                                savePackerList(updated);
                                                setNewPackerName('');
                                                message.success('Đã thêm nhân viên mới!');
                                            } else if (packerList.includes(newPackerName.trim())) {
                                                message.warning('Nhân viên này đã tồn tại!');
                                            }
                                        }}
                                    />
                                    <Button
                                        type="primary"
                                        icon={<PlusOutlined />}
                                        onClick={() => {
                                            if (newPackerName.trim() && !packerList.includes(newPackerName.trim())) {
                                                const updated = [...packerList, newPackerName.trim()];
                                                savePackerList(updated);
                                                setNewPackerName('');
                                                message.success('Đã thêm nhân viên mới!');
                                            } else if (packerList.includes(newPackerName.trim())) {
                                                message.warning('Nhân viên này đã tồn tại!');
                                            }
                                        }}
                                    >
                                        Thêm
                                    </Button>
                                </div>
                            </div>

                            {/* List existing packers */}
                            <div>
                                <Text strong style={{ fontSize: 13, color: '#595959' }}>📋 Danh sách hiện tại ({packerList.length})</Text>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    {packerList.map(name => (
                                        <Tag
                                            key={name}
                                            closable
                                            onClose={(e) => {
                                                e.preventDefault();
                                                Modal.confirm({
                                                    title: 'Xóa nhân viên?',
                                                    content: `Bạn có chắc muốn xóa "${name}" khỏi danh sách?`,
                                                    okText: 'Xóa',
                                                    cancelText: 'Hủy',
                                                    okButtonProps: { danger: true },
                                                    onOk: () => {
                                                        const updated = packerList.filter(n => n !== name);
                                                        savePackerList(updated);
                                                        message.success(`Đã xóa "${name}"!`);
                                                    },
                                                });
                                            }}
                                            color="blue"
                                            style={{ fontSize: 13 }}
                                        >
                                            👤 {name}
                                        </Tag>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
