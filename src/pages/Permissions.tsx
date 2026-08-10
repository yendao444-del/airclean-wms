import { useState, useEffect, useRef } from 'react';
import dayjs from 'dayjs';
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
    Tag,
    Switch,
    Alert,
    DatePicker,
} from 'antd';
import { UserAddOutlined, EditOutlined, DeleteOutlined, LockOutlined, UnlockOutlined, KeyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

interface User {
    id: number;
    username: string;
    fullName: string;
    email?: string;
    role: 'admin' | 'manager' | 'staff' | 'viewer';
    isActive: boolean;
    employmentStatus?: 'active' | 'inactive' | 'resigned';
    resignationDate?: string | null;
    resignationReason?: string;
    operationalAssignee?: boolean;
    createdAt: string;
    lastActiveAt?: string | null;
}

// User được coi là online nếu lastActiveAt trong vòng 3 phút
function isOnline(lastActiveAt?: string | null): boolean {
    if (!lastActiveAt) return false;
    return (Date.now() - new Date(lastActiveAt).getTime()) < 3 * 60 * 1000;
}

const ROLES = {
    admin: {
        label: 'Quản trị viên',
        color: 'red',
        permissions: ['all'],
    },
    manager: {
        label: 'Quản lý',
        color: 'blue',
        permissions: ['products', 'purchases', 'returns', 'refunds', 'reports'],
    },
    staff: {
        label: 'Nhân viên',
        color: 'green',
        permissions: ['products', 'purchases', 'returns'],
    },
    viewer: {
        label: 'Chỉ xem',
        color: 'default',
        permissions: ['view'],
    },
};

export default function PermissionsPage() {
    const { user: currentUser } = useAuth(); // Get current logged-in user
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [form] = Form.useForm();
    const employmentStatus = Form.useWatch('employmentStatus', form);

    // Password change states
    const [passwordModalVisible, setPasswordModalVisible] = useState(false);
    const [changingPasswordUser, setChangingPasswordUser] = useState<User | null>(null);
    const [passwordForm] = Form.useForm();

    const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        loadUsers();

        // Heartbeat: cập nhật lastActiveAt mỗi 2 phút
        const heartbeatInterval = setInterval(() => {
            window.electronAPI.users.heartbeat?.();
        }, 2 * 60 * 1000);

        // Refresh danh sách mỗi 30 giây để cập nhật trạng thái online của mọi người
        refreshTimerRef.current = setInterval(() => {
            window.electronAPI.users.getAll().then(r => {
                if (r.success && r.data) setUsers(r.data);
            });
        }, 30 * 1000);

        return () => {
            clearInterval(heartbeatInterval);
            if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
        };
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const result = await window.electronAPI.users.getAll();
            if (result.success && result.data) {
                setUsers(result.data);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        } finally {
            setLoading(false);
        }
    };

    const saveUsers = (_updatedUsers: User[]) => {
        // Data is now saved via individual API calls
        loadUsers();
    };

    const handleAdd = () => {
        setEditingUser(null);
        form.resetFields();
        form.setFieldsValue({
            role: 'staff',
            operationalAssignee: true,
            employmentStatus: 'active',
        });
        setModalVisible(true);
    };

    const handleEdit = (user: User) => {
        setEditingUser(user);
        form.setFieldsValue({
            username: user.username,
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
            employmentStatus: user.employmentStatus || (user.isActive ? 'active' : 'inactive'),
            resignationDate: user.resignationDate ? dayjs(user.resignationDate) : dayjs(),
            resignationReason: user.resignationReason || '',
            operationalAssignee: user.operationalAssignee !== false,
        });
        setModalVisible(true);
    };

    const handleDelete = (user: User) => {
        if (user.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
            message.error('Không thể xóa admin duy nhất!');
            return;
        }

        Modal.confirm({
            title: 'Xác nhận xóa?',
            content: `Bạn có chắc muốn xóa người dùng "${user.fullName}"?`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                await window.electronAPI.users.delete(user.id);
                await loadUsers();
                message.success('Đã xóa người dùng!');
            },
        });
    };

    const handleToggleActive = async (user: User) => {
        if (user.role === 'admin' && users.filter(u => u.role === 'admin' && u.isActive).length === 1) {
            message.error('Không thể vô hiệu hóa admin duy nhất!');
            return;
        }

        await window.electronAPI.users.update(user.id, { isActive: !user.isActive });
        await loadUsers();
        message.success(user.isActive ? 'Đã vô hiệu hóa!' : 'Đã kích hoạt!');
    };

    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();
            const payload = {
                ...values,
                email: values.email?.trim() || null,
                resignationDate: values.resignationDate?.format?.('YYYY-MM-DD'),
                resignationReason: values.resignationReason?.trim() || '',
            };
            if (editingUser && !payload.password) {
                delete payload.password;
            }

            if (editingUser && payload.employmentStatus === 'resigned') {
                Modal.confirm({
                    title: 'Xác nhận nhân viên nghỉ việc',
                    content: `Từ ${payload.resignationDate}, ${editingUser.fullName} sẽ bị khóa đăng nhập, không thể chấm công và công việc chưa hoàn thành từ ngày này sẽ bị hủy hoặc gỡ khỏi phân công.`,
                    okText: 'Xác nhận nghỉ việc',
                    okType: 'danger',
                    cancelText: 'Hủy',
                    onOk: async () => {
                        const result = await window.electronAPI.users.update(editingUser.id, payload);
                        if (!result?.success) throw new Error(result?.error || 'Không thể cập nhật người dùng.');
                        await loadUsers();
                        setModalVisible(false);
                        form.resetFields();
                        message.success('Đã ghi nhận nhân viên nghỉ việc.');
                    },
                });
                return;
            }

            if (editingUser) {
                // Update
                const result = await window.electronAPI.users.update(editingUser.id, payload);
                if (!result?.success) throw new Error(result?.error || 'Không thể cập nhật người dùng.');
                await loadUsers();
                message.success('Đã cập nhật người dùng!');
            } else {
                // Create
                const newUser = {
                    username: payload.username,
                    fullName: payload.fullName,
                    email: payload.email,
                    role: payload.role,
                    isActive: payload.employmentStatus !== 'inactive',
                    operationalAssignee: payload.operationalAssignee,
                    password: payload.password,
                };
                const result = await window.electronAPI.users.create(newUser);
                if (!result?.success) throw new Error(result?.error || 'Không thể tạo người dùng.');
                await loadUsers();
                message.success('Đã thêm người dùng mới!');
            }

            setModalVisible(false);
            form.resetFields();
        } catch (error) {
            console.error('Submit error:', error);
            message.error(error instanceof Error ? error.message : 'Không thể lưu người dùng.');
        }
    };

    const handleChangePassword = (user: User) => {
        setChangingPasswordUser(user);
        passwordForm.resetFields();
        setPasswordModalVisible(true);
    };

    const handlePasswordSubmit = async () => {
        try {
            const values = await passwordForm.validateFields();

            const result = await window.electronAPI.users.resetPassword({
                userId: changingPasswordUser!.id,
                newPassword: values.newPassword,
            });
            if (!result.success) throw new Error(result.error || 'Không thể đặt lại mật khẩu.');
            await loadUsers();

            message.success('Đã đặt mật khẩu tạm. Người dùng sẽ phải đổi mật khẩu khi đăng nhập.');
            setPasswordModalVisible(false);
            passwordForm.resetFields();
        } catch (error) {
            console.error('Password submit error:', error);
            message.error(error instanceof Error ? error.message : 'Không thể đặt lại mật khẩu.');
        }
    };

    const handleForcePasswordChange = () => {
        if (!changingPasswordUser) return;
        Modal.confirm({
            title: 'Bắt đổi mật khẩu',
            content: `Giữ nguyên mật khẩu hiện tại của ${changingPasswordUser.username}. Ở lần đăng nhập tiếp theo, họ phải tự đổi mật khẩu trước khi dùng hệ thống.`,
            okText: 'Bắt đổi ở lần đăng nhập tới',
            cancelText: 'Hủy',
            onOk: async () => {
                const forcePasswordChange = window.electronAPI.users.forcePasswordChange;
                if (!forcePasswordChange) {
                    message.error('Ứng dụng cần khởi động lại để nạp chức năng bắt đổi mật khẩu.');
                    throw new Error('Missing users:forcePasswordChange IPC bridge');
                }
                const result = await forcePasswordChange(changingPasswordUser.id);
                if (!result.success) {
                    message.error(result.error || 'Không thể bắt đổi mật khẩu.');
                    throw new Error(result.error || 'Không thể bắt đổi mật khẩu.');
                }
                await loadUsers();
                setPasswordModalVisible(false);
                message.success(`Đã yêu cầu ${changingPasswordUser.username} đổi mật khẩu ở lần đăng nhập tiếp theo.`);
            },
        });
    };

    const columns: ColumnsType<User> = [
        {
            title: 'ID',
            dataIndex: 'id',
            key: 'id',
            width: 60,
            align: 'center',
        },
        {
            title: 'Tên đăng nhập',
            dataIndex: 'username',
            key: 'username',
            width: 160,
            render: (text, record) => (
                <Space size={6}>
                    <span style={{
                        display: 'inline-block',
                        width: 10, height: 10,
                        borderRadius: '50%',
                        background: isOnline(record.lastActiveAt) ? '#52c41a' : '#d9d9d9',
                        flexShrink: 0,
                        boxShadow: isOnline(record.lastActiveAt) ? '0 0 0 3px rgba(82,196,26,0.2)' : 'none',
                    }} title={isOnline(record.lastActiveAt)
                        ? 'Đang online'
                        : record.lastActiveAt
                            ? `Lần cuối: ${new Date(record.lastActiveAt).toLocaleString('vi-VN')}`
                            : 'Chưa đăng nhập'
                    } />
                    <Tag color="blue">{text}</Tag>
                </Space>
            ),
        },
        {
            title: 'Họ và tên',
            dataIndex: 'fullName',
            key: 'fullName',
            width: 200,
        },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            width: 200,
            render: (email) => email || <span style={{ color: '#bfbfbf' }}>—</span>,
        },
        {
            title: 'Vai trò',
            dataIndex: 'role',
            key: 'role',
            width: 150,
            filters: [
                { text: 'Quản trị viên', value: 'admin' },
                { text: 'Quản lý', value: 'manager' },
                { text: 'Nhân viên', value: 'staff' },
                { text: 'Chỉ xem', value: 'viewer' },
            ],
            onFilter: (value, record) => record.role === value,
            render: (role: keyof typeof ROLES) => (
                <Tag color={ROLES[role].color}>{ROLES[role].label}</Tag>
            ),
        },
        {
            title: 'Trạng thái',
            dataIndex: 'isActive',
            key: 'isActive',
            width: 120,
            filters: [
                { text: 'Hoạt động', value: true },
                { text: 'Vô hiệu hóa', value: false },
            ],
            onFilter: (value, record) => record.isActive === value,
            render: (isActive, record) => (
                record.employmentStatus === 'resigned' ? (
                    <Tag color="default" title={record.resignationDate ? `Nghỉ từ ${dayjs(record.resignationDate).format('DD/MM/YYYY')}` : ''}>
                        ĐÃ NGHỈ
                    </Tag>
                ) : <Switch
                    checked={isActive}
                    onChange={() => handleToggleActive(record)}
                    checkedChildren={<UnlockOutlined />}
                    unCheckedChildren={<LockOutlined />}
                />
            ),
        },
        {
            title: 'Ngày tạo',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 150,
            render: (date) => new Date(date).toLocaleDateString('vi-VN'),
        },
        {
            title: 'Thao tác',
            key: 'actions',
            width: 220,
            fixed: 'right',
            render: (_, record) => (
                <Space>
                    {/* Only admin can change passwords */}
                    {currentUser?.role === 'admin' && (
                        <Button
                            type="link"
                            icon={<KeyOutlined />}
                            onClick={() => handleChangePassword(record)}
                            style={{ color: '#52c41a' }}
                            title="Không thể xem mật khẩu hiện tại; mở để đặt lại mật khẩu tạm"
                        >
                            Đặt lại
                        </Button>
                    )}
                    <Button
                        type="link"
                        icon={<EditOutlined />}
                        onClick={() => handleEdit(record)}
                        style={{ color: '#1890ff' }}
                    >
                        Sửa
                    </Button>
                    <Button
                        type="link"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDelete(record)}
                        danger
                        disabled={record.role === 'admin' && users.filter(u => u.role === 'admin').length === 1}
                    >
                        Xóa
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ color: '#262626', margin: 0 }}>
                    👥 Quản lý người dùng & Phân quyền
                </Title>
                <Space>
                    <Button type="primary" icon={<UserAddOutlined />} size="large" onClick={handleAdd}>
                        Thêm người dùng
                    </Button>
                </Space>
            </div>

            <Card>
                <Table
                    columns={columns}
                    dataSource={users}
                    rowKey="id"
                    loading={loading}
                    pagination={{
                        pageSize: 10,
                        showTotal: (total) => `Tổng ${total} người dùng`,
                    }}
                />
            </Card>

            {/* User Form Modal */}
            <Modal
                title={editingUser ? '✏️ Sửa người dùng' : '➕ Thêm người dùng mới'}
                open={modalVisible}
                onCancel={() => setModalVisible(false)}
                footer={null}
                width={600}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        label="Tên đăng nhập"
                        name="username"
                        rules={[
                            { required: true, message: 'Vui lòng nhập tên đăng nhập!' },
                            { min: 3, message: 'Tên đăng nhập phải có ít nhất 3 ký tự!' },
                        ]}
                    >
                        <Input placeholder="Nhập tên đăng nhập" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="Họ và tên"
                        name="fullName"
                        rules={[{ required: true, message: 'Vui lòng nhập họ và tên!' }]}
                    >
                        <Input placeholder="VD: Nguyễn Văn A" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="Gmail"
                        name="email"
                        rules={[
                            { type: 'email', message: 'Gmail không đúng định dạng!' },
                        ]}
                    >
                        <Input placeholder="VD: nhanvien@gmail.com" size="large" />
                    </Form.Item>

                    <Form.Item
                        label={editingUser ? 'Mật khẩu tạm mới (để trống nếu không đổi)' : 'Mật khẩu tạm'}
                        name="password"
                        rules={[
                            { required: !editingUser, message: 'Vui lòng nhập mật khẩu!' },
                            { min: 8, message: 'Mật khẩu phải có ít nhất 8 ký tự!' },
                            { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: 'Mật khẩu phải gồm chữ và số!' },
                        ]}
                    >
                        <Input.Password placeholder={editingUser ? 'Không nhập nếu giữ mật khẩu cũ' : 'Nhập mật khẩu'} size="large" />
                    </Form.Item>


                    <Form.Item
                        label="Vai trò"
                        name="role"
                        rules={[{ required: true, message: 'Vui lòng chọn vai trò!' }]}
                    >
                        <Select size="large">
                            {Object.entries(ROLES).map(([key, value]) => (
                                <Select.Option key={key} value={key}>
                                    <Tag color={value.color}>{value.label}</Tag>
                                    <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>
                                        ({value.permissions.join(', ')})
                                    </span>
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label="Trạng thái nhân sự"
                        name="employmentStatus"
                        rules={[{ required: true, message: 'Vui lòng chọn trạng thái nhân sự!' }]}
                    >
                        <Select size="large" disabled={editingUser?.role === 'admin'}>
                            <Select.Option value="active">Đang làm việc</Select.Option>
                            <Select.Option value="inactive">Tạm khóa tài khoản</Select.Option>
                            <Select.Option value="resigned">Đã nghỉ việc</Select.Option>
                        </Select>
                    </Form.Item>

                    {employmentStatus === 'resigned' && (
                        <>
                            <Form.Item
                                label="Ngày nghỉ việc"
                                name="resignationDate"
                                rules={[{ required: true, message: 'Vui lòng chọn ngày nghỉ việc!' }]}
                            >
                                <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                            </Form.Item>
                            <Form.Item label="Lý do nghỉ (tùy chọn)" name="resignationReason">
                                <Input.TextArea rows={2} placeholder="VD: Nghỉ theo nguyện vọng cá nhân" />
                            </Form.Item>
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: 16 }}
                                message="Tài khoản sẽ bị khóa hoàn toàn từ ngày nghỉ"
                                description="Không thể đăng nhập, chấm công, nhận việc hoặc phát sinh lương/thưởng/phạt mới. Lịch sử trước ngày nghỉ vẫn được giữ lại."
                            />
                        </>
                    )}

                    <Form.Item name="operationalAssignee" valuePropName="checked" style={{ marginBottom: 4 }}>
                        <Switch checkedChildren="Phân công" unCheckedChildren="Không phân công" />
                    </Form.Item>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                        Tham gia phân công vận hành: đóng gói TMĐT và kiểm hàng.
                    </Text>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setModalVisible(false)}>
                            Hủy
                        </Button>
                        <Button type="primary" htmlType="submit" size="large">
                            {editingUser ? 'Cập nhật' : 'Thêm'}
                        </Button>
                    </div>
                </Form>
            </Modal>

            {/* Password Change Modal */}
            <Modal
                title={<><KeyOutlined style={{ color: '#52c41a', marginRight: 8 }} /> Đặt lại mật khẩu</>}
                open={passwordModalVisible}
                onCancel={() => setPasswordModalVisible(false)}
                footer={null}
                width={500}
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="Không thể xem mật khẩu hiện tại"
                    description="Mật khẩu được lưu dưới dạng mã băm bảo mật. Admin chỉ có thể cấp mật khẩu tạm; người dùng sẽ phải đổi lại ở lần đăng nhập tiếp theo."
                />
                <Form form={passwordForm} layout="vertical" onFinish={handlePasswordSubmit}>
                    <div style={{ marginBottom: 16, padding: 12, background: '#f0f5ff', borderRadius: 8 }}>
                        <Text strong>Người dùng: </Text>
                        <Text>{changingPasswordUser?.username}</Text>
                        <br />
                        <Text strong>Họ tên: </Text>
                        <Text>{changingPasswordUser?.fullName}</Text>
                        <br />
                        <Text type="warning">Mật khẩu này là tạm thời. Người dùng sẽ phải đổi ngay sau khi đăng nhập.</Text>
                    </div>

                    <Form.Item
                        label="Mật khẩu tạm mới"
                        name="newPassword"
                        rules={[
                            { required: true, message: 'Vui lòng nhập mật khẩu mới!' },
                            { min: 8, message: 'Mật khẩu phải có ít nhất 8 ký tự!' },
                            { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: 'Mật khẩu phải gồm chữ và số!' },
                        ]}
                    >
                        <Input.Password placeholder="Nhập mật khẩu mới" size="large" />
                    </Form.Item>

                    <Form.Item
                        label="Xác nhận mật khẩu"
                        name="confirmPassword"
                        dependencies={['newPassword']}
                        rules={[
                            { required: true, message: 'Vui lòng xác nhận mật khẩu!' },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue('newPassword') === value) {
                                        return Promise.resolve();
                                    }
                                    return Promise.reject(new Error('Mật khẩu xác nhận không khớp!'));
                                },
                            }),
                        ]}
                    >
                        <Input.Password placeholder="Nhập lại mật khẩu mới" size="large" />
                    </Form.Item>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                        <Button onClick={() => setPasswordModalVisible(false)}>
                            Hủy
                        </Button>
                        <Button type="primary" htmlType="submit" size="large" icon={<KeyOutlined />}>
                            Đặt mật khẩu tạm
                        </Button>
                    </div>
                    {changingPasswordUser?.role !== 'admin' && (
                        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
                            <Text strong>Bắt đổi mật khẩu</Text>
                            <Text type="secondary" style={{ display: 'block', marginTop: 4, marginBottom: 10 }}>
                                Giữ nguyên mật khẩu hiện tại và yêu cầu nhân viên tự đổi ở lần đăng nhập tiếp theo.
                            </Text>
                            <Button onClick={handleForcePasswordChange} icon={<LockOutlined />}>
                                Bắt đổi mật khẩu
                            </Button>
                        </div>
                    )}
                </Form>
            </Modal>
        </div>
    );
}
