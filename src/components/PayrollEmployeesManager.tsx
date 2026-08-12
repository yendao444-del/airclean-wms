import { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Button,
    Card,
    Col,
    Divider,
    Form,
    Input,
    InputNumber,
    Modal,
    Row,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
    message,
} from 'antd';
import { BankOutlined, DeleteOutlined, EditOutlined, KeyOutlined, LockOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, UnlockOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface PayrollEmployee {
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

interface SystemUser {
    id: number;
    username: string;
    fullName: string;
    role: string;
    isActive?: boolean;
    employmentStatus?: string;
    resignationDate?: string | null;
    email?: string;
    createdAt?: string;
    lastActiveAt?: string | null;
}

interface PayrollEmployeesManagerProps {
    users: SystemUser[];
    usersLoading?: boolean;
    currentUserRole?: string;
    onEditUser: (user: any) => void;
    onDeleteUser: (user: any) => void | Promise<void>;
    onResetPassword: (user: any) => void;
    onToggleActive: (user: any) => void | Promise<void>;
}

const VIET_QR_BANKS = [
    ['VCB', 'Vietcombank (VCB)'], ['BIDV', 'BIDV'], ['VTB', 'Vietinbank (CTG)'],
    ['AGR', 'Agribank'], ['TCB', 'Techcombank (TCB)'], ['MB', 'MB Bank'],
    ['VPB', 'VPBank'], ['ACB', 'ACB'], ['STB', 'Sacombank'], ['SHB', 'SHB'],
    ['TPB', 'TPBank'], ['VIB', 'VIB'], ['HDB', 'HDBank'], ['OCB', 'OCB'],
    ['MSB', 'MSB'], ['EIB', 'Eximbank'], ['LPB', 'LienVietPostBank'],
    ['SEAB', 'SeABank'], ['NAB', 'Nam A Bank'], ['BAB', 'Bac A Bank'],
].map(([value, label]) => ({ value, label }));

const normalizeUsername = (value: unknown) => String(value || '').trim().toLowerCase();
const formatMoney = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))} đ`;

const isOnline = (lastActiveAt?: string | null) => Boolean(
    lastActiveAt && Date.now() - new Date(lastActiveAt).getTime() < 3 * 60 * 1000,
);

const ROLE_META: Record<string, { label: string; color: string }> = {
    admin: { label: 'Quản trị viên', color: 'red' },
    manager: { label: 'Quản lý', color: 'blue' },
    staff: { label: 'Nhân viên', color: 'green' },
    viewer: { label: 'Chỉ xem', color: 'default' },
};

export default function PayrollEmployeesManager({
    users,
    usersLoading = false,
    currentUserRole,
    onEditUser,
    onDeleteUser,
    onResetPassword,
    onToggleActive,
}: PayrollEmployeesManagerProps) {
    const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<PayrollEmployee | null>(null);
    const [form] = Form.useForm();
    const employeeType = Form.useWatch('type', form);

    const loadData = async () => {
        setLoading(true);
        try {
            const attendanceResult = await window.electronAPI.appConfig.get('attendanceData');
            if (!attendanceResult?.success) throw new Error(attendanceResult?.error || 'Không tải được hồ sơ lương.');
            const nextEmployees = Array.isArray(attendanceResult.data?.employees)
                ? attendanceResult.data.employees
                : [];
            setEmployees(nextEmployees);
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không tải được hồ sơ nhân viên.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const userByUsername = useMemo(() => new Map(
        users.map(user => [normalizeUsername(user.username), user]),
    ), [users]);

    const availableUsers = useMemo(() => {
        const used = new Set(employees.map(employee => normalizeUsername(employee.username)));
        return users.filter(user =>
            normalizeUsername(user.username) !== 'admin'
            && user.isActive !== false
            && user.employmentStatus !== 'resigned'
            && !used.has(normalizeUsername(user.username))
        );
    }, [employees, users]);

    const openAdd = (user?: SystemUser) => {
        setEditingEmployee(null);
        form.resetFields();
        form.setFieldsValue({
            type: 'Official',
            baseSalary: 0,
            username: user?.username ? normalizeUsername(user.username) : undefined,
            name: user?.fullName || undefined,
        });
        setModalOpen(true);
    };

    const openEdit = (employee: PayrollEmployee) => {
        setEditingEmployee(employee);
        form.resetFields();
        form.setFieldsValue({ ...employee });
        setModalOpen(true);
    };

    const saveEmployee = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const username = normalizeUsername(values.username);
            const account = userByUsername.get(username);
            if (!account) throw new Error('Username phải thuộc một tài khoản đang có trong Quản trị.');
            const saveEmployeeProfile = (window.electronAPI as any).attendance?.saveEmployeeProfile;
            if (!saveEmployeeProfile) throw new Error('Ứng dụng cần khởi động lại để nạp chức năng lưu hồ sơ an toàn.');
            const saveResult = await saveEmployeeProfile({
                mode: editingEmployee ? 'edit' : 'create',
                employee: {
                    id: editingEmployee?.id,
                    username,
                    name: String(values.name || account.fullName || '').trim(),
                    type: values.type,
                    baseSalary: Number(values.baseSalary || 0),
                    bankId: values.bankId || undefined,
                    bankAccount: String(values.bankAccount || '').replace(/\s+/g, '') || undefined,
                    bankAccountName: String(values.bankAccountName || '').trim().toUpperCase() || undefined,
                },
            });
            if (!saveResult?.success) throw new Error(saveResult?.error || 'Không lưu được hồ sơ lương.');
            setEmployees(saveResult.data || []);
            setModalOpen(false);
            message.success(editingEmployee ? 'Đã cập nhật hồ sơ lương, giữ nguyên mã nhân viên.' : 'Đã thêm hồ sơ lương an toàn.');
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể lưu hồ sơ nhân viên.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
                <div>
                    <Title level={4} style={{ margin: 0 }}><BankOutlined /> Tài khoản và hồ sơ nhân viên</Title>
                    <Text type="secondary">Một dòng duy nhất cho tài khoản, phân quyền, hợp đồng và thông tin tính lương.</Text>
                </div>
                <Space>
                    <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>Tải lại</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openAdd()} disabled={availableUsers.length === 0}>
                        Thêm hồ sơ lương
                    </Button>
                </Space>
            </div>

            <Alert
                type="success"
                showIcon
                icon={<SafetyCertificateOutlined />}
                style={{ marginBottom: 16 }}
                message="Bảo toàn dữ liệu lương"
                description="Các cột tài khoản và lương được ghép để dễ quản lý, nhưng mã bảng công cũ vẫn được giữ nguyên phía sau. Nhân viên nghỉ việc phải đổi trạng thái, không xóa cứng."
            />

            <Table
                loading={loading || usersLoading}
                dataSource={users}
                rowKey="id"
                size="middle"
                tableLayout="fixed"
                pagination={{ pageSize: 10, showTotal: total => `Tổng ${total} người dùng` }}
                columns={[
                    {
                        title: 'Nhân viên', width: '29%',
                        render: (_, user) => <div style={{ minWidth: 0, lineHeight: 1.45 }}>
                            <Space size={7}>
                                <span style={{ width: 9, height: 9, flex: '0 0 auto', borderRadius: '50%', background: isOnline(user.lastActiveAt) ? '#52c41a' : '#d9d9d9' }} />
                                <Text strong>{user.fullName}</Text>
                            </Space>
                            <div style={{ marginTop: 3 }}>
                                <Tag color="blue" style={{ marginInlineEnd: 6 }}>{user.username}</Tag>
                                <Text type="secondary" style={{ fontSize: 11 }}>ID tài khoản: {user.id}</Text>
                            </div>
                            <Text type="secondary" ellipsis={{ tooltip: user.email }} style={{ display: 'block', maxWidth: '100%', marginTop: 2, fontSize: 12 }}>
                                {user.email || 'Chưa có email'}
                            </Text>
                        </div>,
                    },
                    {
                        title: 'Tài khoản', width: '17%',
                        render: (_, user) => <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                            <Tag color={ROLE_META[user.role]?.color}>{ROLE_META[user.role]?.label || user.role}</Tag>
                            {user.employmentStatus === 'resigned'
                                ? <Tag>ĐÃ NGHỈ</Tag>
                                : <Space size={6}>
                                    <Switch size="small" checked={user.isActive} onChange={() => onToggleActive(user)} checkedChildren={<UnlockOutlined />} unCheckedChildren={<LockOutlined />} />
                                    <Text type="secondary" style={{ fontSize: 12 }}>{user.isActive ? 'Hoạt động' : 'Đã khóa'}</Text>
                                </Space>}
                        </div>,
                    },
                    {
                        title: 'Hồ sơ lương', width: '31%',
                        render: (_, user) => {
                            const employee = employees.find(item => normalizeUsername(item.username) === normalizeUsername(user.username));
                            if (!employee) return user.role === 'admin'
                                ? <Text type="secondary">Không áp dụng</Text>
                                : <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => openAdd(user)}>Thiết lập hồ sơ lương</Button>;
                            return <div style={{ lineHeight: 1.55 }}>
                                <Space size={8} wrap>
                                    <Tag color={employee.type === 'Official' ? 'blue' : 'green'}>{employee.type === 'Official' ? 'Chính thức' : 'Thời vụ'}</Tag>
                                    <Text strong>{formatMoney(employee.baseSalary)}{employee.isHourly ? '/giờ' : '/tháng'}</Text>
                                </Space>
                                <div style={{ marginTop: 5 }}>
                                    <Text type="secondary" style={{ fontSize: 12 }}>
                                        {employee.bankId && employee.bankAccount ? `${employee.bankId} · ${employee.bankAccount}` : 'Chưa có tài khoản ngân hàng'}
                                    </Text>
                                </div>
                            </div>;
                        },
                    },
                    {
                        title: 'Thao tác', width: '23%',
                        render: (_, user) => {
                            const employee = employees.find(item => normalizeUsername(item.username) === normalizeUsername(user.username));
                            const onlyAdmin = user.role === 'admin' && users.filter(item => item.role === 'admin').length === 1;
                            return <Space size={[2, 4]} wrap>
                                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEditUser(user)}>Sửa TK</Button>
                                {user.role !== 'admin' && (
                                    <Button type="link" size="small" icon={<BankOutlined />} onClick={() => employee ? openEdit(employee) : openAdd(user)}>
                                        {employee ? 'Sửa lương' : 'Tạo lương'}
                                    </Button>
                                )}
                                {currentUserRole === 'admin' && <Button type="text" size="small" icon={<KeyOutlined />} title="Đặt lại mật khẩu" onClick={() => onResetPassword(user)} style={{ color: '#52c41a' }} />}
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Xóa tài khoản" disabled={onlyAdmin} onClick={() => onDeleteUser(user)} />
                            </Space>;
                        },
                    },
                ]}
            />

            <Modal
                title={editingEmployee ? 'Sửa hồ sơ lương' : 'Thêm hồ sơ lương'}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={saveEmployee}
                confirmLoading={saving}
                okText="Lưu an toàn"
                cancelText="Hủy"
                destroyOnHidden
                width={650}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Row gutter={16}>
                        <Col span={14}>
                            <Form.Item name="name" label="Họ và tên" rules={[{ required: true, message: 'Nhập họ và tên.' }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={10}>
                            <Form.Item name="username" label="Username liên kết" rules={[{ required: true, message: 'Chọn username.' }]}>
                                <Select
                                    disabled={Boolean(editingEmployee)}
                                    showSearch
                                    optionFilterProp="label"
                                    options={(editingEmployee ? users : availableUsers).map(user => ({
                                        value: normalizeUsername(user.username),
                                        label: `${user.username} — ${user.fullName}`,
                                    }))}
                                    onChange={value => {
                                        if (!editingEmployee) {
                                            const selected = userByUsername.get(normalizeUsername(value));
                                            if (selected) form.setFieldValue('name', selected.fullName);
                                        }
                                    }}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="type" label="Loại hợp đồng" rules={[{ required: true }]}>
                                <Select options={[{ value: 'Official', label: 'Chính thức (tháng)' }, { value: 'Seasonal', label: 'Thời vụ (theo giờ)' }]} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="baseSalary" label={employeeType === 'Seasonal' ? 'Đơn giá/giờ' : 'Lương/tháng'} rules={[{ required: true }]}>
                                <InputNumber min={0} step={1000} style={{ width: '100%' }} formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')} parser={value => Number(String(value || '').replace(/\./g, '')) as never} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Divider>Ngân hàng nhận lương</Divider>
                    <Row gutter={16}>
                        <Col span={8}><Form.Item name="bankId" label="Ngân hàng"><Select allowClear showSearch optionFilterProp="label" options={VIET_QR_BANKS} /></Form.Item></Col>
                        <Col span={8}><Form.Item name="bankAccount" label="Số tài khoản"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="bankAccountName" label="Tên chủ tài khoản"><Input /></Form.Item></Col>
                    </Row>
                </Form>
            </Modal>
        </Card>
    );
}
