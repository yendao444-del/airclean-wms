import { useState, useEffect, useRef } from 'react';
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
            // Ensure admin exists
            await window.electronAPI.users.ensureAdmin();
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

            if (editingUser) {
                // Update
                await window.electronAPI.users.update(editingUser.id, values);
                await loadUsers();
                message.success('Đã cập nhật người dùng!');
            } else {
                // Create
                const newUser = {
                    username: values.username,
                    fullName: ROLES[values.role as keyof typeof ROLES].label,
                    email: undefined,
                    role: values.role,
                    isActive: true,
                    password: values.password,
                };
                await window.electronAPI.users.create(newUser);
                await loadUsers();
                message.success('Đã thêm người dùng mới!');
            }

            setModalVisible(false);
            form.resetFields();
        } catch (error) {
            console.error('Submit error:', error);
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

            // Update password via API
            await window.electronAPI.users.update(changingPasswordUser!.id, { password: values.newPassword });
            await loadUsers();

            message.success('Đã đổi mật khẩu thành công!');
            setPasswordModalVisible(false);
            passwordForm.resetFields();
        } catch (error) {
            console.error('Password submit error:', error);
        }
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
                <Switch
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
                        >
                            Đổi MK
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

                    {!editingUser && (
                        <Form.Item
                            label="Mật khẩu"
                            name="password"
                            rules={[
                                { required: true, message: 'Vui lòng nhập mật khẩu!' },
                                { min: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự!' },
                            ]}
                        >
                            <Input.Password placeholder="Nhập mật khẩu" size="large" />
                        </Form.Item>
                    )}


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
                title={<><KeyOutlined style={{ color: '#52c41a', marginRight: 8 }} /> Đổi mật khẩu</>}
                open={passwordModalVisible}
                onCancel={() => setPasswordModalVisible(false)}
                footer={null}
                width={500}
            >
                <Form form={passwordForm} layout="vertical" onFinish={handlePasswordSubmit}>
                    <div style={{ marginBottom: 16, padding: 12, background: '#f0f5ff', borderRadius: 8 }}>
                        <Text strong>Người dùng: </Text>
                        <Text>{changingPasswordUser?.username}</Text>
                        <br />
                        <Text strong>Họ tên: </Text>
                        <Text>{changingPasswordUser?.fullName}</Text>
                    </div>

                    <Form.Item
                        label="Mật khẩu mới"
                        name="newPassword"
                        rules={[
                            { required: true, message: 'Vui lòng nhập mật khẩu mới!' },
                            { min: 6, message: 'Mật khẩu phải có ít nhất 6 ký tự!' },
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
                            Đổi mật khẩu
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
