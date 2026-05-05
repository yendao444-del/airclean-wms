import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Alert } from 'antd';
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

export default function Login() {
    const [loading, setLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const { login } = useAuth();
    const [form] = Form.useForm();

    const handleLogin = async (values: { username: string; password: string }) => {
        setLoading(true);
        setLoginError(null);
        try {
            const result = await login(values.username, values.password);

            if (result.success) {
                message.success('Đăng nhập thành công!');
            } else {
                const errorText = result.error || 'Tên đăng nhập hoặc mật khẩu không đúng!';
                setLoginError(errorText);
                message.error(errorText);
            }
        } catch (error) {
            const errorText = 'Đã xảy ra lỗi khi đăng nhập!';
            setLoginError(errorText);
            message.error(errorText);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Decorative circles */}
            <div style={{
                position: 'absolute',
                width: '500px',
                height: '500px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.1)',
                top: '-250px',
                right: '-250px',
            }} />
            <div style={{
                position: 'absolute',
                width: '300px',
                height: '300px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.05)',
                bottom: '-150px',
                left: '-150px',
            }} />

            {/* Login Card */}
            <Card
                style={{
                    width: 420,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                    borderRadius: 20,
                    border: 'none',
                    background: 'rgba(255,255,255,0.95)',
                    backdropFilter: 'blur(10px)',
                    position: 'relative',
                    zIndex: 1,
                }}
                bodyStyle={{ padding: '48px 40px' }}
            >
                {/* Logo/Header */}
                <div style={{ textAlign: 'center', marginBottom: 40 }}>
                    <div style={{
                        width: 100,
                        height: 100,
                        margin: '0 auto 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}>
                        <img
                            src="./logo_splash.png"
                            alt="AIRCLEAN Logo"
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                            }}
                        />
                    </div>
                    <Title level={2} style={{ margin: '0 0 8px 0', color: '#262626', fontSize: 28 }}>
                        AIRCLEAN CORP.
                    </Title>
                    <Text style={{ color: '#8c8c8c', fontSize: 14 }}>
                        Warehouse Management System
                    </Text>
                </div>

                {/* Login Form */}
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleLogin}
                    onValuesChange={() => setLoginError(null)}
                    size="large"
                >
                    {loginError && (
                        <Alert
                            type="error"
                            showIcon
                            message={loginError}
                            style={{ marginBottom: 16, borderRadius: 8 }}
                        />
                    )}

                    <Form.Item
                        name="username"
                        rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập!' }]}
                    >
                        <Input
                            prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                            placeholder="Tên đăng nhập"
                            autoFocus
                            style={{
                                height: 50,
                                borderRadius: 10,
                                fontSize: 15,
                            }}
                        />
                    </Form.Item>

                    <Form.Item
                        name="password"
                        rules={[{ required: true, message: 'Vui lòng nhập mật khẩu!' }]}
                        style={{ marginBottom: 16 }}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                            placeholder="Mật khẩu"
                            style={{
                                height: 50,
                                borderRadius: 10,
                                fontSize: 15,
                            }}
                        />
                    </Form.Item>

                    <Form.Item style={{ marginBottom: 0 }}>
                        <Button
                            type="primary"
                            htmlType="submit"
                            style={{
                                width: '100%',
                                height: 54,
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                border: 'none',
                                fontSize: 16,
                                fontWeight: 600,
                                borderRadius: 10,
                                boxShadow: '0 8px 20px rgba(102, 126, 234, 0.4)',
                            }}
                            icon={<LoginOutlined />}
                            loading={loading}
                        >
                            Đăng Nhập
                        </Button>
                    </Form.Item>
                </Form>
            </Card>

            {/* Footer with Dev Credit */}
            <div style={{
                position: 'absolute',
                bottom: 30,
                left: 0,
                right: 0,
                textAlign: 'center',
                zIndex: 1,
            }}>
                <Text style={{
                    color: 'rgba(255,255,255,0.95)',
                    fontSize: 13,
                    fontWeight: 500,
                    textShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }}>
                    💻 Developed by <span style={{ fontWeight: 700 }}>Dao Yen</span>
                </Text>
                <br />
                <Text style={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 12,
                    textShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }}>
                    © 2026 AIRCLEAN CORP. All rights reserved.
                </Text>
            </div>
        </div>
    );
}
