import { useState } from 'react';
import { Card, Button, Input, message, Space, Typography, Alert } from 'antd';
import { GlobalOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function BrowserTest() {
    const [url, setUrl] = useState('https://google.com');
    const [loading, setLoading] = useState(false);
    const [lastResult, setLastResult] = useState<{ success: boolean; error?: string } | null>(null);

    const handleOpenBrowser = async () => {
        if (!url) {
            message.error('Vui lòng nhập URL');
            return;
        }

        setLoading(true);
        setLastResult(null);

        try {
            const result = await window.electronAPI.shell.openExternal(url);
            setLastResult(result);

            if (result.success) {
                message.success('✅ Đã mở trình duyệt thành công!');
            } else {
                message.error(`❌ Lỗi: ${result.error}`);
            }
        } catch (error: any) {
            setLastResult({ success: false, error: error.message });
            message.error(`❌ Lỗi: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const testUrls = [
        'https://google.com',
        'https://facebook.com',
        'https://youtube.com',
        'https://github.com',
    ];

    return (
        <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
            <Card>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <GlobalOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
                    <Title level={2} style={{ margin: 0 }}>Test Mở Trình Duyệt</Title>
                    <Text type="secondary">Kiểm tra tính năng openExternal của Electron</Text>
                </div>

                <Space direction="vertical" style={{ width: '100%' }} size="large">
                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Nhập URL để test:</Text>
                        <Input.Search
                            size="large"
                            placeholder="https://example.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onSearch={handleOpenBrowser}
                            enterButton={
                                <Button type="primary" loading={loading}>
                                    <GlobalOutlined /> Mở trình duyệt
                                </Button>
                            }
                        />
                    </div>

                    <div>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>Hoặc chọn URL mẫu:</Text>
                        <Space wrap>
                            {testUrls.map((testUrl) => (
                                <Button
                                    key={testUrl}
                                    onClick={() => setUrl(testUrl)}
                                    type={url === testUrl ? 'primary' : 'default'}
                                >
                                    {testUrl.replace('https://', '')}
                                </Button>
                            ))}
                        </Space>
                    </div>

                    {lastResult && (
                        <Alert
                            type={lastResult.success ? 'success' : 'error'}
                            icon={lastResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                            message={lastResult.success ? 'Thành công!' : 'Thất bại!'}
                            description={
                                lastResult.success
                                    ? `Đã mở URL: ${url}`
                                    : `Lỗi: ${lastResult.error}`
                            }
                            showIcon
                        />
                    )}

                    <div style={{
                        background: '#f0f2f5',
                        padding: 16,
                        borderRadius: 8,
                        marginTop: 24
                    }}>
                        <Text strong style={{ display: 'block', marginBottom: 8 }}>📝 Lưu ý:</Text>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            <li>URL phải bắt đầu bằng <code>http://</code> hoặc <code>https://</code></li>
                            <li>Trình duyệt mặc định của hệ thống sẽ được mở</li>
                            <li>Nếu thành công, trình duyệt sẽ mở trang web trong tab/cửa sổ mới</li>
                        </ul>
                    </div>
                </Space>
            </Card>
        </div>
    );
}
