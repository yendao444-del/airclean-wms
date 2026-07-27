import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Card, Divider, Form, Input, Modal, Space, Tag, Upload, message } from 'antd';
import { CameraOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, UploadOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const PASSWORD_ROTATION_DAYS = 7;

async function compressAvatar(file: File): Promise<string> {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Không thể đọc ảnh đại diện.'));
            element.src = sourceUrl;
        });
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Không thể xử lý ảnh.');
        const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.78));
        if (!blob || blob.size > 160 * 1024) throw new Error('Ảnh sau khi nén vẫn vượt quá 160 KB.');
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
            reader.readAsDataURL(blob);
        });
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

export default function MyProfile() {
    const { user, updateCurrentUser } = useAuth();
    const [profileForm] = Form.useForm();
    const [passwordForm] = Form.useForm();
    const [avatar, setAvatar] = useState<string | null | undefined>(user?.avatar);
    const [savingProfile, setSavingProfile] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);
    const [passwordOpen, setPasswordOpen] = useState(Boolean(user?.mustChangePassword));

    const daysRemaining = useMemo(() => {
        if (user?.role === 'admin') return null;
        if (!user?.passwordChangedAt) return 0;
        const expiry = new Date(user.passwordChangedAt).getTime() + PASSWORD_ROTATION_DAYS * 24 * 60 * 60 * 1000;
        return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
    }, [user?.passwordChangedAt, user?.role]);

    if (!user) return null;

    const saveProfile = async (values: { fullName: string }) => {
        setSavingProfile(true);
        try {
            const result = await window.electronAPI.users.updateProfile({ ...values, avatar });
            if (!result.success || !result.data) throw new Error(result.error || 'Không thể cập nhật hồ sơ.');
            updateCurrentUser(result.data);
            message.success('Đã cập nhật hồ sơ.');
        } catch (error: any) {
            message.error(error.message || 'Không thể cập nhật hồ sơ.');
        } finally {
            setSavingProfile(false);
        }
    };

    const changePassword = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
        setChangingPassword(true);
        try {
            const result = await window.electronAPI.users.changePassword({
                userId: user.id,
                oldPassword: values.oldPassword,
                newPassword: values.newPassword,
            });
            if (!result.success) throw new Error(result.error || 'Không thể đổi mật khẩu.');
            updateCurrentUser({ ...user, mustChangePassword: false, passwordChangedAt: new Date().toISOString() });
            passwordForm.resetFields();
            setPasswordOpen(false);
            message.success('Đã đổi mật khẩu.');
        } catch (error: any) {
            message.error(error.message || 'Không thể đổi mật khẩu.');
        } finally {
            setChangingPassword(false);
        }
    };

    return (
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '28px 32px 48px' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ margin: 0, color: '#172033', fontSize: 28, fontWeight: 750 }}>Hồ sơ của tôi</h1>
                <div style={{ marginTop: 6, color: '#64748b', fontSize: 14 }}>Quản lý thông tin tài khoản và bảo mật của bạn.</div>
            </div>

            {user.mustChangePassword && (
                <Alert
                    type="warning"
                    showIcon
                    message="Đã đến hạn đổi mật khẩu"
                    description="Để tiếp tục sử dụng hệ thống, vui lòng đặt mật khẩu mới cho tài khoản của bạn."
                    style={{ marginBottom: 18 }}
                />
            )}

            <Card style={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: 'none' }} styles={{ body: { padding: 28 } }}>
                <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 40 }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                            <Avatar size={144} src={avatar || undefined} icon={!avatar && <UserOutlined />} style={{ background: '#e8f5ee', color: '#087f46', fontSize: 52 }} />
                            <Upload
                                showUploadList={false}
                                accept="image/png,image/jpeg,image/webp"
                                beforeUpload={async file => {
                                    try {
                                        if (file.size > 2 * 1024 * 1024) throw new Error('Chọn ảnh tối đa 2 MB.');
                                        setAvatar(await compressAvatar(file as unknown as File));
                                    } catch (error: any) {
                                        message.error(error.message || 'Không thể xử lý ảnh.');
                                    }
                                    return Upload.LIST_IGNORE;
                                }}
                            >
                                <Button shape="circle" icon={<CameraOutlined />} aria-label="Thay ảnh đại diện" style={{ position: 'absolute', right: 2, bottom: 2, background: '#fff', borderColor: '#dbe3ec' }} />
                            </Upload>
                        </div>
                        <div style={{ marginTop: 12, fontWeight: 700, color: '#172033' }}>{user.fullName}</div>
                        <div style={{ marginTop: 3, color: '#64748b', fontSize: 13 }}>@{user.username}</div>
                        <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>Nhấn biểu tượng máy ảnh để thay ảnh</div>
                    </div>

                    <Form form={profileForm} layout="vertical" initialValues={{ fullName: user.fullName }} onFinish={saveProfile}>
                        <h2 style={{ margin: '0 0 18px', color: '#172033', fontSize: 17 }}>Thông tin cá nhân</h2>
                        <Form.Item label="Họ và tên hiển thị" name="fullName" rules={[{ required: true, min: 2, message: 'Nhập họ tên từ 2 ký tự.' }]}>
                            <Input prefix={<UserOutlined />} maxLength={80} />
                        </Form.Item>
                        <Form.Item label="Email" extra="Email được quản lý bởi quản trị viên và dùng để khôi phục tài khoản.">
                            <Input prefix={<MailOutlined />} value={user.email || 'Chưa được cập nhật'} disabled />
                        </Form.Item>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <Form.Item label="Tên đăng nhập" style={{ marginBottom: 0 }}><Input value={user.username} disabled /></Form.Item>
                            <Form.Item label="Vai trò" style={{ marginBottom: 0 }}><Input value={user.role === 'admin' ? 'Quản trị viên' : user.role === 'manager' ? 'Quản lý' : 'Nhân viên'} disabled /></Form.Item>
                        </div>
                        <div style={{ marginTop: 20, textAlign: 'right' }}><Button type="primary" htmlType="submit" loading={savingProfile}>Lưu thay đổi</Button></div>
                    </Form>
                </div>

                <Divider style={{ margin: '32px 0 22px' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
                    <div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: '#172033' }}><SafetyCertificateOutlined style={{ color: '#0f9f63', marginRight: 8 }} />Bảo mật</div>
                        <div style={{ marginTop: 7, color: '#64748b', fontSize: 14 }}>Mật khẩu cần ít nhất 8 ký tự, gồm chữ và số.</div>
                    </div>
                    <Space size={14}>
                        {daysRemaining !== null && <Tag color={daysRemaining === 0 ? 'error' : daysRemaining <= 2 ? 'warning' : 'green'}>{daysRemaining === 0 ? 'Cần đổi ngay' : `Còn ${daysRemaining} ngày cần đổi`}</Tag>}
                        <Button icon={<LockOutlined />} onClick={() => setPasswordOpen(true)}>Đổi mật khẩu</Button>
                    </Space>
                </div>
            </Card>

            <Modal
                title="Đổi mật khẩu"
                open={passwordOpen}
                closable={!user.mustChangePassword}
                maskClosable={!user.mustChangePassword}
                footer={null}
                onCancel={() => setPasswordOpen(false)}
                destroyOnClose
            >
                <Form form={passwordForm} layout="vertical" onFinish={changePassword} style={{ marginTop: 20 }}>
                    <Form.Item label="Mật khẩu hiện tại" name="oldPassword" rules={[{ required: true, message: 'Nhập mật khẩu hiện tại.' }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
                    <Form.Item label="Mật khẩu mới" name="newPassword" rules={[{ required: true, min: 8, message: 'Tối thiểu 8 ký tự.' }, { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: 'Mật khẩu cần có chữ và số.' }]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
                    <Form.Item label="Xác nhận mật khẩu mới" name="confirmPassword" dependencies={['newPassword']} rules={[{ required: true, message: 'Xác nhận mật khẩu mới.' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('Mật khẩu xác nhận chưa khớp.')); } })]}><Input.Password prefix={<LockOutlined />} /></Form.Item>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        {!user.mustChangePassword && <Button onClick={() => setPasswordOpen(false)}>Hủy</Button>}
                        <Button type="primary" htmlType="submit" loading={changingPassword}>Cập nhật mật khẩu</Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
