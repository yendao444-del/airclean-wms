import { useState } from 'react';
import { Alert, Button, Form, Input, message } from 'antd';
import {
    ArrowRightOutlined,
    LockOutlined,
    ShopOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

type Language = 'vi' | 'en';

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
    },
} as const;

export default function Login() {
    const [loading, setLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [language, setLanguage] = useState<Language>('vi');
    const { login } = useAuth();
    const [form] = Form.useForm();
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
        </main>
    );
}
