import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Progress } from 'antd';
import {
    CheckOutlined,
    ClockCircleOutlined,
    CloseOutlined,
    DatabaseOutlined,
    DownloadOutlined,
    InboxOutlined,
    ReloadOutlined,
    SafetyCertificateOutlined,
    SettingOutlined,
    SyncOutlined,
    WarningOutlined,
} from '@ant-design/icons';
import './ForceUpdateGate.css';

type UpdateStep = 'checking' | 'downloading' | 'extracting' | 'installing' | 'restarting';
type GateStatus = UpdateStep | 'error' | 'idle';

interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    releaseNotes: string;
    downloadUrl: string;
    downloadSize: number;
}

interface ProgressData {
    percent: number;
    dlMB: string;
    totalMB: string;
    speedKBs: number;
    etaSec: number;
    elapsed: number;
}

interface TestEventDetail {
    status?: GateStatus;
    percent?: number;
    currentVersion?: string;
    latestVersion?: string;
}

interface ForceUpdateGateProps {
    children: React.ReactNode;
}

const STEPS: { key: UpdateStep; label: string; icon: React.ReactNode }[] = [
    { key: 'checking', label: 'Kiểm tra', icon: <CheckOutlined /> },
    { key: 'downloading', label: 'Tải xuống', icon: <DownloadOutlined /> },
    { key: 'extracting', label: 'Giải nén', icon: <InboxOutlined /> },
    { key: 'installing', label: 'Cài đặt', icon: <SettingOutlined /> },
    { key: 'restarting', label: 'Khởi động lại', icon: <ReloadOutlined /> },
];

const DEV_PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).has('updateUiTest');

export default function ForceUpdateGate({ children }: ForceUpdateGateProps) {
    const [status, setStatus] = useState<GateStatus>(DEV_PREVIEW ? 'installing' : 'checking');
    const [testMode, setTestMode] = useState(DEV_PREVIEW);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(DEV_PREVIEW ? {
        currentVersion: '1.0.397',
        latestVersion: '1.0.398',
        releaseNotes: '',
        downloadUrl: '',
        downloadSize: 0,
    } : null);
    const [progress, setProgress] = useState<ProgressData | null>(DEV_PREVIEW ? {
        percent: 84,
        dlMB: '84.0',
        totalMB: '100.0',
        speedKBs: 0,
        etaSec: 18,
        elapsed: 42,
    } : null);
    const [errorMessage, setErrorMessage] = useState('');
    const [elapsed, setElapsed] = useState(DEV_PREVIEW ? 42 : 0);
    const autoStarted = useRef(false);
    const testModeRef = useRef(DEV_PREVIEW);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const doDownload = async (info: UpdateInfo) => {
        if (testModeRef.current) return;
        if (!info.downloadUrl) {
            setErrorMessage('Bản cập nhật chưa có gói tải hợp lệ. Ứng dụng vẫn có thể sử dụng bình thường.');
            setStatus('error');
            return;
        }
        setStatus('downloading');
        try {
            const result = await window.electronAPI.update.download(info.downloadUrl);
            if (result.success) {
                setStatus('restarting');
            } else {
                setErrorMessage(result.error || 'Không thể tải hoặc xác minh gói cập nhật.');
                setStatus('error');
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Không thể tải hoặc xác minh gói cập nhật.');
            setStatus('error');
        }
    };

    useEffect(() => {
        testModeRef.current = testMode;
    }, [testMode]);

    useEffect(() => {
        if (status !== 'idle' && status !== 'error') {
            timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
        }
    }, [status]);

    useEffect(() => {
        const openTestPreview = (event: Event) => {
            const detail = (event as CustomEvent<TestEventDetail>).detail || {};
            const percent = Math.max(0, Math.min(100, detail.percent ?? 84));
            testModeRef.current = true;
            setTestMode(true);
            setErrorMessage('');
            setElapsed(42);
            setUpdateInfo({
                currentVersion: detail.currentVersion || '1.0.397',
                latestVersion: detail.latestVersion || '1.0.398',
                releaseNotes: '',
                downloadUrl: '',
                downloadSize: 0,
            });
            setProgress({ percent, dlMB: String(percent), totalMB: '100', speedKBs: 0, etaSec: 18, elapsed: 42 });
            setStatus(detail.status || 'installing');
        };
        window.addEventListener('dby:update-ui-test', openTestPreview);
        return () => window.removeEventListener('dby:update-ui-test', openTestPreview);
    }, []);

    useEffect(() => {
        const api = (window as any).electronAPI?.update;
        if (!api) return;

        const cleanupProgress = api.onProgress?.((data: ProgressData) => {
            if (!testModeRef.current) setProgress(data);
        });
        const cleanupStep = api.onStep?.((data: { step: UpdateStep; message: string }) => {
            if (!testModeRef.current) setStatus(data.step);
        });

        return () => {
            cleanupProgress?.();
            cleanupStep?.();
        };
    }, []);

    useEffect(() => {
        if (DEV_PREVIEW) return;
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

                    if (!autoStarted.current) {
                        autoStarted.current = true;
                        console.log(`Auto-update: v${info.currentVersion} -> v${info.latestVersion}`);
                        await doDownload(info);
                    }
                } else {
                    setStatus('idle');
                }
            } catch {
                setStatus('idle');
            }
        };
        void checkAndAutoUpdate();
    }, []);

    const displayPercent = useMemo(() => {
        if (status === 'checking') return 8;
        if (status === 'downloading') return progress?.percent || 36;
        if (status === 'extracting') return Math.max(progress?.percent || 0, 68);
        if (status === 'installing') return Math.max(progress?.percent || 0, 84);
        if (status === 'restarting') return 100;
        return progress?.percent || 0;
    }, [progress?.percent, status]);

    if (status === 'idle' || (status === 'checking' && !testMode)) {
        return <>{children}</>;
    }

    const currentStepIdx = STEPS.findIndex(step => step.key === status);

    const formatEta = (sec: number) => {
        if (sec <= 0) return 'vài giây';
        if (sec < 60) return `${sec} giây`;
        return `${Math.floor(sec / 60)} phút ${sec % 60} giây`;
    };

    const retryUpdate = () => {
        if (testMode) {
            setStatus('installing');
            setErrorMessage('');
            return;
        }
        autoStarted.current = false;
        setStatus('checking');
        setProgress(null);
        setElapsed(0);
        setErrorMessage('');
        window.electronAPI.update.check().then((result: any) => {
            if (result.success && result.data?.hasUpdate && result.data.downloadUrl) {
                const info: UpdateInfo = {
                    currentVersion: result.data.currentVersion,
                    latestVersion: result.data.latestVersion,
                    releaseNotes: result.data.releaseNotes || '',
                    downloadUrl: result.data.downloadUrl,
                    downloadSize: result.data.downloadSize || 0,
                };
                setUpdateInfo(info);
                autoStarted.current = true;
                void doDownload(info);
            } else {
                setStatus('idle');
            }
        }).catch(() => setStatus('idle'));
    };

    const closeTestMode = () => {
        testModeRef.current = false;
        setTestMode(false);
        setStatus('idle');
        setProgress(null);
        setElapsed(0);
        setErrorMessage('');
    };

    return (
        <div className="update-gate" role="dialog" aria-modal="true" aria-label="Đang cập nhật ứng dụng">
            <img className="update-gate__art" src="/login-assets/global-logistics-panel.png" alt="" />

            <header className="update-gate__header">
                <img src="/logo_splash.png" alt="DB" className="update-gate__logo" />
                <span className="update-gate__brand-divider" />
                <div>
                    <strong>AIRCLEAN CORP.</strong>
                    <span>Hệ thống nội bộ AIRCLEAN CORP.</span>
                </div>
            </header>

            {testMode && (
                <div className="update-gate__test-controls">
                    <span>CHẾ ĐỘ KIỂM THỬ</span>
                    <Button icon={<CloseOutlined />} onClick={closeTestMode}>Thoát kiểm thử</Button>
                </div>
            )}

            {status === 'error' ? (
                <main className="update-gate__error">
                    <WarningOutlined />
                    <h1>Cập nhật chưa hoàn tất</h1>
                    <p>{errorMessage || 'Không thể cập nhật phần mềm. Vui lòng kiểm tra kết nối mạng và thử lại.'}</p>
                    <div>
                        <Button type="primary" icon={<ReloadOutlined />} onClick={retryUpdate}>Thử lại</Button>
                        <Button onClick={testMode ? closeTestMode : () => setStatus('idle')}>{testMode ? 'Thoát kiểm thử' : 'Bỏ qua'}</Button>
                    </div>
                </main>
            ) : (
                <main className="update-gate__main">
                    <section className="update-gate__progress-panel">
                        <Progress
                            type="circle"
                            percent={displayPercent}
                            size={430}
                            strokeWidth={4}
                            strokeColor={{ '0%': '#d7bb63', '52%': '#9edbca', '100%': '#91c94a' }}
                            railColor="rgba(215, 187, 99, 0.16)"
                            format={percent => (
                                <div className="update-gate__progress-content">
                                    <InboxOutlined />
                                    <strong>{percent}%</strong>
                                    <span>{status === 'restarting' ? 'Sẵn sàng khởi động lại' : 'Đang cập nhật hệ thống'}</span>
                                </div>
                            )}
                        />
                    </section>

                    <ol className="update-gate__steps" aria-label="Tiến trình cập nhật">
                        {STEPS.map((step, index) => {
                            const isDone = currentStepIdx > index;
                            const isActive = currentStepIdx === index;
                            return (
                                <li key={step.key} className={`${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`}>
                                    <span className="update-gate__step-icon">{isDone ? <CheckOutlined /> : step.icon}</span>
                                    <span>{step.label}</span>
                                </li>
                            );
                        })}
                    </ol>
                </main>
            )}

            <footer className="update-gate__footer">
                <div className="update-gate__facts">
                    <div><SyncOutlined /><span>Hệ thống sẽ tự mở lại<br />khi hoàn tất</span></div>
                    <div><SafetyCertificateOutlined /><span>Không tắt ứng dụng<br />hoặc ngắt nguồn</span></div>
                    <div><DatabaseOutlined /><span>Dữ liệu được<br />bảo toàn</span></div>
                    <div><ClockCircleOutlined /><span>Thời gian còn lại<br />khoảng {formatEta(progress?.etaSec || Math.max(5, 60 - elapsed))}</span></div>
                </div>
                <div className="update-gate__version"><span />v{updateInfo?.latestVersion || '1.0.398'}<span /></div>
            </footer>
        </div>
    );
}
