import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, message } from 'antd';
import {
    ArrowRightOutlined,
    LockOutlined,
    ShopOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

type Language = 'vi' | 'en';

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
    Promise.race([
        promise,
        new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('Máy chủ email phản hồi quá lâu. Vui lòng thử lại sau.')), timeoutMs)),
    ]);

const copy = {
    vi: {
        title: 'Đăng nhập',
        username: 'Tên đăng nhập',
        password: 'Mật khẩu',
        submit: 'Đăng nhập hệ thống',
        support: 'Hệ thống nội bộ AIRCLEAN CORP.',
        usernameRequired: 'Vui lòng nhập tên đăng nhập!',
        passwordRequired: 'Vui lòng nhập mật khẩu!',
        success: 'Đăng nhập thành công!',
        invalid: 'Tên đăng nhập hoặc mật khẩu không đúng!',
        unexpected: 'Đã xảy ra lỗi khi đăng nhập!',
        forgot: 'Quên mật khẩu?',
        resetTitle: 'Khôi phục mật khẩu',
        resetIntro: 'Nhập email đã được lưu trong tài khoản. Hệ thống sẽ gửi mã xác minh gồm 6 chữ số.',
        email: 'Email tài khoản',
        emailRequired: 'Vui lòng nhập email hợp lệ!',
        sendCode: 'Gửi mã xác minh',
        code: 'Mã xác minh',
        newPassword: 'Mật khẩu mới',
        confirmPassword: 'Nhập lại mật khẩu mới',
        resetSubmit: 'Đặt mật khẩu mới',
        resendCode: 'Gửi lại mã xác minh',
        passwordRule: 'Mật khẩu cần 8–72 ký tự, gồm ít nhất một chữ và một số.',
        sent: 'Mã xác minh đã được gửi đến email tài khoản. Mã có hiệu lực trong 10 phút.',
        resetSuccess: 'Đổi mật khẩu thành công. Bạn có thể đăng nhập ngay.',
        mismatch: 'Mật khẩu nhập lại không khớp!',
    },
    en: {
        title: 'Sign in',
        username: 'Username',
        password: 'Password',
        submit: 'Sign in to the system',
        support: 'AIRCLEAN CORP. Internal System',
        usernameRequired: 'Please enter your username!',
        passwordRequired: 'Please enter your password!',
        success: 'Signed in successfully!',
        invalid: 'Incorrect username or password!',
        unexpected: 'An error occurred while signing in!',
        forgot: 'Forgot password?',
        resetTitle: 'Reset password',
        resetIntro: 'Enter the email saved on your account. We will send a six-digit verification code.',
        email: 'Account email',
        emailRequired: 'Please enter a valid email!',
        sendCode: 'Send verification code',
        code: 'Verification code',
        newPassword: 'New password',
        confirmPassword: 'Confirm new password',
        resetSubmit: 'Set new password',
        resendCode: 'Resend verification code',
        passwordRule: 'Use 8–72 characters with at least one letter and one number.',
        sent: 'A verification code was sent to the account email. It expires in 10 minutes.',
        resetSuccess: 'Password updated. You can sign in now.',
        mismatch: 'The passwords do not match!',
    },
} as const;

export default function Login() {
    const [loading, setLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [language, setLanguage] = useState<Language>('vi');
    const { login } = useAuth();
    const [form] = Form.useForm();
    const [resetForm] = Form.useForm();
    const [resetOpen, setResetOpen] = useState(false);
    const [resetStep, setResetStep] = useState<'email' | 'code' | 'success'>('email');
    const [resetEmail, setResetEmail] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);
    const text = copy[language];

    const handleLogin = async (values: { username: string; password: string }) => {
        setLoading(true);
        setLoginError(null);
        try {
            const result = await login(values.username, values.password);

            if (result.success) {
                message.success(text.success);
            } else {
                const errorText = result.error || text.invalid;
                setLoginError(errorText);
                message.error(errorText);
            }
        } catch {
            setLoginError(text.unexpected);
            message.error(text.unexpected);
        } finally {
            setLoading(false);
        }
    };

    const selectLanguage = (nextLanguage: Language) => {
        setLanguage(nextLanguage);
        setLoginError(null);
        form.setFields([
            { name: 'username', errors: [] },
            { name: 'password', errors: [] },
        ]);
    };

    const openPasswordReset = () => {
        const username = String(form.getFieldValue('username') || '');
        setResetEmail(username.includes('@') ? username.trim() : '');
        setResetStep('email');
        setResetError(null);
        resetForm.resetFields();
        resetForm.setFieldValue('email', username.includes('@') ? username.trim() : '');
        setResetOpen(true);
    };

    const requestResetCode = async ({ email }: { email: string }) => {
        setResetLoading(true);
        setResetError(null);
        try {
            const result = await withTimeout(window.electronAPI.users.requestPasswordReset(email), 35_000);
            if (!result.success) throw new Error(result.error);
            setResetEmail(email.trim().toLowerCase());
            setResetStep('code');
            resetForm.resetFields();
        } catch (error) {
            setResetError(error instanceof Error ? error.message : text.unexpected);
        } finally {
            setResetLoading(false);
        }
    };

    const completePasswordReset = async (values: { code: string; newPassword: string; confirmPassword: string }) => {
        if (values.newPassword !== values.confirmPassword) {
            setResetError(text.mismatch);
            return;
        }
        setResetLoading(true);
        setResetError(null);
        try {
            const result = await window.electronAPI.users.completePasswordReset(resetEmail, values.code, values.newPassword);
            if (!result.success) throw new Error(result.error);
            setResetStep('success');
            resetForm.resetFields();
        } catch (error) {
            setResetError(error instanceof Error ? error.message : text.unexpected);
        } finally {
            setResetLoading(false);
        }
    };

    return (
        <main className="login-page">
            <section className="login-content" aria-label="AIRCLEAN CORP. login">
                <header className="login-header">
                    <img className="login-logo" src="./logo_splash.png" alt="AIRCLEAN CORP." />

                    <div className="login-language" aria-label="Language selection">
                        {(['vi', 'en'] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                className={`login-language-button${language === item ? ' is-active' : ''}`}
                                aria-pressed={language === item}
                                onClick={() => selectLanguage(item)}
                            >
                                {item.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </header>

                <div className="login-brand">
                    <h1>AIRCLEAN CORP.</h1>
                </div>

                <div className="login-form-area">
                    <h2>{text.title}</h2>

                    <Form
                        form={form}
                        className="login-form"
                        layout="vertical"
                        onFinish={handleLogin}
                        onValuesChange={() => setLoginError(null)}
                        requiredMark={false}
                    >
                        {loginError && (
                            <Alert
                                className="login-error"
                                type="error"
                                showIcon
                                message={loginError}
                            />
                        )}

                        <Form.Item
                            name="username"
                            rules={[{ required: true, message: text.usernameRequired }]}
                        >
                            <Input
                                className="login-input"
                                prefix={<UserOutlined />}
                                placeholder={text.username}
                                autoComplete="username"
                                autoFocus
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            rules={[{ required: true, message: text.passwordRequired }]}
                        >
                            <Input.Password
                                className="login-input"
                                prefix={<LockOutlined />}
                                placeholder={text.password}
                                autoComplete="current-password"
                            />
                        </Form.Item>

                        <button type="button" className="login-forgot-password" onClick={openPasswordReset}>
                            {text.forgot}
                        </button>

                        <Form.Item className="login-submit-item">
                            <Button
                                className="login-submit"
                                type="primary"
                                htmlType="submit"
                                loading={loading}
                            >
                                <span>{text.submit}</span>
                                <ArrowRightOutlined className="login-submit-icon" />
                            </Button>
                        </Form.Item>
                    </Form>

                    <div className="login-support">
                        <ShopOutlined />
                        <span>{text.support}</span>
                    </div>
                </div>

                <img
                    className="login-warehouse-art"
                    src="./login-assets/warehouse-linework.png"
                    alt=""
                    aria-hidden="true"
                />

                <footer className="login-footer">
                    <span>© 2026 AIRCLEAN CORP.</span>
                    <span className="login-footer-line" aria-hidden="true" />
                </footer>
            </section>

            <aside className="login-visual" aria-hidden="true">
                <img src="./login-assets/global-logistics-panel.png" alt="" />
            </aside>

            <Modal
                className="password-reset-modal"
                title={text.resetTitle}
                open={resetOpen}
                footer={null}
                centered
                destroyOnHidden
                onCancel={() => !resetLoading && setResetOpen(false)}
                maskClosable={!resetLoading}
            >
                {resetStep === 'email' && (
                    <Form form={resetForm} layout="vertical" requiredMark={false} onFinish={requestResetCode}>
                        <p className="password-reset-intro">{text.resetIntro}</p>
                        {resetError && <Alert type="error" showIcon message={resetError} />}
                        <Form.Item name="email" label={text.email} rules={[{ required: true, type: 'email', message: text.emailRequired }]}>
                            <Input size="large" autoFocus autoComplete="email" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={resetLoading}>{text.sendCode}</Button>
                    </Form>
                )}
                {resetStep === 'code' && (
                    <Form form={resetForm} layout="vertical" requiredMark={false} onFinish={completePasswordReset}>
                        <Alert className="password-reset-sent" type="success" showIcon message={text.sent} />
                        {resetError && <Alert type="error" showIcon message={resetError} />}
                        <Form.Item name="code" label={text.code} rules={[{ required: true, pattern: /^\d{6}$/, message: 'Mã xác minh phải gồm 6 chữ số.' }]}>
                            <Input size="large" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
                        </Form.Item>
                        <Form.Item name="newPassword" label={text.newPassword} extra={text.passwordRule} rules={[{ required: true, min: 8, max: 72, pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/, message: text.passwordRule }]}>
                            <Input.Password size="large" autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item name="confirmPassword" label={text.confirmPassword} rules={[{ required: true, message: text.confirmPassword }]}>
                            <Input.Password size="large" autoComplete="new-password" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={resetLoading}>{text.resetSubmit}</Button>
                        <Button type="link" block disabled={resetLoading} onClick={() => { setResetStep('email'); setResetError(null); resetForm.setFieldValue('email', resetEmail); }}>{text.resendCode}</Button>
                    </Form>
                )}
                {resetStep === 'success' && (
                    <div className="password-reset-success">
                        <div className="password-reset-success-icon">✓</div>
                        <p>{text.resetSuccess}</p>
                        <Button type="primary" size="large" block onClick={() => setResetOpen(false)}>{text.title}</Button>
                    </div>
                )}
            </Modal>
        </main>
    );
}
