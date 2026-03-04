import { useState, useEffect, useRef } from 'react';
import { Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;

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
    const [status, setStatus] = useState<'checking' | 'downloading' | 'error' | 'idle'>('checking');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const autoStarted = useRef(false);

    const doDownload = async (info: UpdateInfo) => {
        if (!info.downloadUrl) return;
        setStatus('downloading');
        try {
            await window.electronAPI.update.download(info.downloadUrl);
            // App sẽ tự restart sau khi download xong
        } catch (e: any) {
            setStatus('error');
        }
    };

    useEffect(() => {
        const checkAndAutoUpdate = async () => {
            setStatus('checking');
            try {
                const result = await window.electronAPI.update.check();
                if (result.success && result.data?.hasUpdate && result.data.downloadUrl) {
                    const info: UpdateInfo = {
                        currentVersion: result.data.currentVersion,
                        latestVersion: result.data.latestVersion,
                        releaseNotes: result.data.releaseNotes || '',
                        downloadUrl: result.data.downloadUrl,
                        downloadSize: result.data.downloadSize || 0,
                    };
                    setUpdateInfo(info);

                    // TỰ ĐỘNG download — không cần user nhấn
                    if (!autoStarted.current) {
                        autoStarted.current = true;
                        console.log(`🔄 Auto-update: v${info.currentVersion} → v${info.latestVersion}`);
                        await doDownload(info);
                    }
                } else {
                    setStatus('idle');
                }
            } catch {
                // Không check được (mất mạng) → cho dùng app bình thường
                setStatus('idle');
            }
        };

        checkAndAutoUpdate();
    }, []);

    // Không có update hoặc đang idle → render app bình thường
    if (status === 'idle') {
        return <>{children}</>;
    }

    // Hiện thông báo nhỏ ở góc (KHÔNG block app)
    const sizeMB = updateInfo?.downloadSize
        ? (updateInfo.downloadSize / 1024 / 1024).toFixed(1) + ' MB'
        : '';

    return (
        <>
            {children}
            <div style={{
                position: 'fixed',
                bottom: 16,
                right: 16,
                background: status === 'error' ? 'rgba(255,77,79,0.95)' : 'rgba(0,171,86,0.95)',
                color: '#fff',
                borderRadius: 12,
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                fontWeight: 600,
                zIndex: 9999,
                boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                maxWidth: 360,
                backdropFilter: 'blur(8px)',
                cursor: status === 'error' ? 'pointer' : 'default',
                transition: 'all 0.3s ease',
            }}
                onClick={status === 'error' && updateInfo ? () => doDownload(updateInfo) : undefined}
                title={status === 'error' ? 'Nhấn để thử lại' : undefined}
            >
                {status === 'checking' && (
                    <>
                        <Spin size="small" />
                        <Text style={{ color: '#fff' }}>Đang kiểm tra cập nhật...</Text>
                    </>
                )}
                {status === 'downloading' && (
                    <>
                        <Spin size="small" />
                        <div>
                            <div>🔄 Đang cập nhật v{updateInfo?.latestVersion}...</div>
                            {sizeMB && <div style={{ fontSize: 11, opacity: 0.8 }}>{sizeMB} — App sẽ tự khởi động lại</div>}
                        </div>
                    </>
                )}
                {status === 'error' && (
                    <>
                        <ReloadOutlined style={{ fontSize: 16 }} />
                        <div>
                            <div>❌ Cập nhật lỗi</div>
                            <div style={{ fontSize: 11, opacity: 0.8 }}>Nhấn để thử lại</div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
