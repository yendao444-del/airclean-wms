import { useState, useEffect } from 'react';
import { Modal, Button, Typography, Alert, Spin, Tag } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    downloadSize: number;
}

interface ForceUpdateGateProps {
    children: React.ReactNode;
}

export default function ForceUpdateGate({ children }: ForceUpdateGateProps) {
    const [checking, setChecking] = useState(true);
    const [hasUpdate, setHasUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const checkUpdate = async () => {
        setChecking(true);
        setError(null);
        try {
            const result = await window.electronAPI.update.check();
            if (result.success && result.data?.hasUpdate) {
                setHasUpdate(true);
                setUpdateInfo({
                    currentVersion: result.data.currentVersion,
                    latestVersion: result.data.latestVersion,
                    releaseNotes: result.data.releaseNotes || '',
                    downloadUrl: result.data.downloadUrl || '',
                    downloadSize: result.data.downloadSize || 0,
                });
            }
        } catch {
            // Nếu không check được (mất mạng) → cho dùng app bình thường
        } finally {
            setChecking(false);
        }
    };

    useEffect(() => {
        checkUpdate();
    }, []);

    const handleUpdate = async () => {
        if (!updateInfo?.downloadUrl) return;
        setDownloading(true);
        setError(null);
        try {
            await window.electronAPI.update.download(updateInfo.downloadUrl);
            // App sẽ tự đóng sau khi download xong (xử lý trong update-handlers.js)
        } catch (e: any) {
            setError(e?.message || 'Tải về thất bại. Vui lòng thử lại.');
            setDownloading(false);
        }
    };

    // Đang kiểm tra: hiển thị spinner nhỏ ở góc, không block UI
    if (checking) {
        return (
            <>
                {children}
                <div style={{
                    position: 'fixed',
                    bottom: 16,
                    right: 16,
                    background: 'rgba(0,0,0,0.65)',
                    color: '#fff',
                    borderRadius: 8,
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    zIndex: 9999,
                }}>
                    <Spin size="small" />
                    Đang kiểm tra cập nhật...
                </div>
            </>
        );
    }

    // Không có update: render app bình thường
    if (!hasUpdate || !updateInfo) {
        return <>{children}</>;
    }

    // CÓ UPDATE: block toàn bộ app
    const sizeMB = updateInfo.downloadSize > 0
        ? (updateInfo.downloadSize / 1024 / 1024).toFixed(1) + ' MB'
        : '';

    return (
        <>
            {/* Render children ở dưới nhưng bị che hoàn toàn bởi modal */}
            <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none' }}>
                {children}
            </div>

            <Modal
                open={true}
                closable={false}
                maskClosable={false}
                keyboard={false}
                footer={null}
                width={520}
                centered
                styles={{ mask: { backdropFilter: 'blur(2px)' } }}
            >
                <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                    {/* Header */}
                    <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
                    <Title level={3} style={{ margin: 0, color: '#00ab56' }}>AIRCLEAN WMS</Title>
                    <Title level={4} style={{ margin: '12px 0 4px' }}>Có bản cập nhật mới!</Title>

                    {/* Version info */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 16, margin: '16px 0' }}>
                        <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Hiện tại</Text>
                            <br />
                            <Tag color="default">v{updateInfo.currentVersion}</Tag>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', color: '#00ab56', fontSize: 20 }}>→</div>
                        <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>Mới nhất</Text>
                            <br />
                            <Tag color="green">v{updateInfo.latestVersion}</Tag>
                        </div>
                    </div>

                    {/* Release notes */}
                    {updateInfo.releaseNotes && (
                        <div style={{
                            background: '#f5f5f5',
                            borderRadius: 8,
                            padding: '12px 16px',
                            textAlign: 'left',
                            maxHeight: 160,
                            overflowY: 'auto',
                            marginBottom: 16,
                        }}>
                            <Text strong style={{ fontSize: 12, color: '#666' }}>Nội dung cập nhật:</Text>
                            <Paragraph style={{ margin: '6px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                                {updateInfo.releaseNotes}
                            </Paragraph>
                        </div>
                    )}

                    {/* Warning */}
                    <Alert
                        message="Bắt buộc cập nhật để tiếp tục sử dụng phần mềm"
                        type="warning"
                        showIcon
                        style={{ marginBottom: 20, textAlign: 'left' }}
                    />

                    {/* Error */}
                    {error && (
                        <Alert
                            message={error}
                            type="error"
                            showIcon
                            style={{ marginBottom: 16, textAlign: 'left' }}
                        />
                    )}

                    {/* Action button */}
                    {downloading ? (
                        <div style={{ padding: '12px 0' }}>
                            <Spin size="large" />
                            <div style={{ marginTop: 12, color: '#666' }}>
                                Đang tải bản cập nhật... App sẽ tự động khởi động lại.
                            </div>
                        </div>
                    ) : error ? (
                        <Button
                            type="primary"
                            size="large"
                            icon={<ReloadOutlined />}
                            onClick={handleUpdate}
                            style={{ width: '100%', height: 48, fontSize: 16, background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            Thử lại
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            size="large"
                            icon={<CloudDownloadOutlined />}
                            onClick={handleUpdate}
                            style={{ width: '100%', height: 48, fontSize: 16, background: '#00ab56', borderColor: '#00ab56' }}
                        >
                            Cập nhật ngay (v{updateInfo.latestVersion}){sizeMB ? ` — ${sizeMB}` : ''}
                        </Button>
                    )}
                </div>
            </Modal>
        </>
    );
}
