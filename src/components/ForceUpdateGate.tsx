import { useState, useEffect, useRef } from 'react';

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

interface ForceUpdateGateProps {
    children: React.ReactNode;
}

const STEPS: { key: UpdateStep; label: string; icon: string; desc: string }[] = [
    { key: 'checking', label: 'Kiểm tra phiên bản', icon: '🔍', desc: 'Kết nối GitHub...' },
    { key: 'downloading', label: 'Tải bản cập nhật', icon: '⬇', desc: 'Đang tải...' },
    { key: 'extracting', label: 'Giải nén', icon: '📦', desc: 'Giải nén files...' },
    { key: 'installing', label: 'Cài đặt', icon: '📋', desc: 'Cập nhật files vào ứng dụng' },
    { key: 'restarting', label: 'Khởi động lại', icon: '🔄', desc: 'App sẽ tự mở lại' },
];

export default function ForceUpdateGate({ children }: ForceUpdateGateProps) {
    const [status, setStatus] = useState<GateStatus>('checking');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [progress, setProgress] = useState<ProgressData | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const autoStarted = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const doDownload = async (info: UpdateInfo) => {
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

    // Elapsed timer
    useEffect(() => {
        if (status !== 'idle' && status !== 'error') {
            timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
        }
    }, [status]);

    // Listen for progress & step events from main process
    useEffect(() => {
        const api = (window as any).electronAPI?.update;
        if (!api) return;

        const cleanupProgress = api.onProgress?.((data: ProgressData) => {
            setProgress(data);
        });
        const cleanupStep = api.onStep?.((data: { step: UpdateStep; message: string }) => {
            setStatus(data.step);
        });

        return () => {
            cleanupProgress?.();
            cleanupStep?.();
        };
    }, []);

    // Initial check
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

                    if (!autoStarted.current) {
                        autoStarted.current = true;
                        console.log(`🔄 Auto-update: v${info.currentVersion} → v${info.latestVersion}`);
                        await doDownload(info);
                    }
                } else {
                    setStatus('idle');
                }
            } catch {
                setStatus('idle');
            }
        };
        checkAndAutoUpdate();
    }, []);

    // Idle hoặc đang checking → render app bình thường (checking chạy ngầm, không chặn)
    if (status === 'idle' || status === 'checking') {
        return <>{children}</>;
    }

    // ===== FULL SCREEN BLOCKING - STEPS TIMELINE =====
    const currentStepIdx = STEPS.findIndex(s => s.key === status);
    const sizeMB = updateInfo?.downloadSize
        ? (updateInfo.downloadSize / 1024 / 1024).toFixed(1)
        : '0';

    const formatEta = (sec: number) => {
        if (sec <= 0) return '--';
        if (sec < 60) return `~${sec}s`;
        return `~${Math.floor(sec / 60)}m${sec % 60}s`;
    };

    const retryUpdate = () => {
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
                doDownload(info);
            } else {
                setStatus('idle');
            }
        }).catch(() => setStatus('idle'));
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(180deg, #111827 0%, #1e293b 100%)',
            fontFamily: "'Segoe UI', -apple-system, sans-serif",
        }}>
            <div style={{ width: 520, padding: 48 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 36 }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: 16,
                        background: status === 'error'
                            ? 'linear-gradient(135deg, #ff4d4f, #cf1322)'
                            : 'linear-gradient(135deg, #00ab56, #34d399)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 28, flexShrink: 0,
                        boxShadow: status === 'error'
                            ? '0 4px 20px rgba(255,77,79,0.3)'
                            : '0 4px 20px rgba(0,171,86,0.3)',
                    }}>
                        {status === 'error' ? '❌' : '🏭'}
                    </div>
                    <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>AIRCLEAN WMS</div>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                            {status === 'error'
                                ? 'Cập nhật thất bại'
                                : updateInfo
                                    ? `Cập nhật v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`
                                    : `Đang kiểm tra...`}
                        </div>
                    </div>
                </div>

                {/* Error state */}
                {status === 'error' ? (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{
                            padding: '20px', marginBottom: 24, borderRadius: 12,
                            background: 'rgba(255,77,79,0.08)',
                            border: '1px solid rgba(255,77,79,0.2)',
                            color: 'rgba(255,255,255,0.6)', fontSize: 14,
                        }}>
                            {errorMessage || 'Không thể cập nhật phần mềm. Vui lòng kiểm tra kết nối mạng và thử lại.'}
                        </div>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                            <button onClick={retryUpdate} style={{
                                padding: '10px 28px', borderRadius: 10, border: 'none',
                                background: '#00ab56', color: '#fff', fontSize: 14, fontWeight: 600,
                                cursor: 'pointer',
                            }}>🔄 Thử lại</button>
                            <button onClick={() => setStatus('idle')} style={{
                                padding: '10px 28px', borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.2)',
                                background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                fontSize: 14, cursor: 'pointer',
                            }}>Bỏ qua</button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Steps */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {STEPS.map((step, i) => {
                                const isDone = currentStepIdx > i;
                                const isActive = currentStepIdx === i;
                                const isPending = currentStepIdx < i;

                                return (
                                    <div key={step.key} style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 16,
                                        padding: '14px 0', position: 'relative',
                                    }}>
                                        {/* Dot */}
                                        <div style={{
                                            width: 32, height: 32, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 14, flexShrink: 0, position: 'relative', zIndex: 2,
                                            transition: 'all 0.5s',
                                            ...(isDone ? {
                                                background: '#00ab56', border: '2px solid #00ab56', color: '#fff',
                                            } : isActive ? {
                                                background: 'rgba(0,171,86,0.15)', border: '2px solid #00ab56', color: '#00ab56',
                                                animation: 'pulse 2s ease-in-out infinite',
                                            } : {
                                                background: 'rgba(255,255,255,0.06)', border: '2px solid rgba(255,255,255,0.1)',
                                                color: 'rgba(255,255,255,0.2)', opacity: 0.4,
                                            }),
                                        }}>
                                            {isDone ? '✓' : step.icon}
                                        </div>

                                        {/* Line */}
                                        {i < STEPS.length - 1 && (
                                            <div style={{
                                                position: 'absolute', left: 15, top: 46,
                                                width: 2, height: 'calc(100% - 32px)',
                                                background: isDone ? '#00ab56' : 'rgba(255,255,255,0.08)',
                                                transition: 'background 0.5s',
                                            }} />
                                        )}

                                        {/* Content */}
                                        <div style={{ flex: 1 }}>
                                            <div style={{
                                                fontSize: 14, fontWeight: 600, color: '#fff',
                                                opacity: isPending ? 0.3 : 1,
                                            }}>
                                                {step.label}
                                                {isActive && step.key === 'downloading' && progress && (
                                                    <span style={{ color: '#52c41a', marginLeft: 8 }}>
                                                        {progress.percent}%
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{
                                                fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2,
                                            }}>
                                                {isDone
                                                    ? (step.key === 'checking' && updateInfo
                                                        ? `Phát hiện v${updateInfo.latestVersion} (${sizeMB} MB)`
                                                        : '✅ Hoàn tất')
                                                    : isActive && step.key === 'downloading' && progress
                                                        ? `${progress.dlMB} / ${progress.totalMB} MB • ${progress.speedKBs} KB/s`
                                                        : step.desc
                                                }
                                            </div>

                                            {/* Mini progress bar for downloading */}
                                            {isActive && step.key === 'downloading' && (
                                                <div style={{
                                                    marginTop: 8, height: 4, borderRadius: 4,
                                                    background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
                                                }}>
                                                    <div style={{
                                                        height: '100%', borderRadius: 4,
                                                        background: 'linear-gradient(90deg, #00ab56, #34d399)',
                                                        width: `${progress?.percent || 0}%`,
                                                        transition: 'width 0.3s ease',
                                                    }} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer: elapsed + ETA */}
                        <div style={{
                            marginTop: 24, padding: '12px 16px', borderRadius: 12,
                            background: 'rgba(255,255,255,0.04)',
                            display: 'flex', justifyContent: 'space-between', fontSize: 12,
                            color: 'rgba(255,255,255,0.35)',
                        }}>
                            <span>⏱ Thời gian: {elapsed}s</span>
                            <span style={{ color: '#52c41a', fontWeight: 600 }}>
                                {progress?.etaSec
                                    ? `Còn lại: ${formatEta(progress.etaSec)}`
                                    : 'Đang xử lý...'}
                            </span>
                        </div>

                        {/* Warning */}
                        <div style={{
                            marginTop: 12, padding: '10px 14px', borderRadius: 10,
                            background: 'rgba(250,173,20,0.06)',
                            border: '1px solid rgba(250,173,20,0.15)',
                            fontSize: 12, color: '#faad14', textAlign: 'center',
                        }}>
                            ⚠️ Vui lòng không tắt ứng dụng trong quá trình cập nhật
                        </div>
                    </>
                )}
            </div>

            {/* CSS */}
            <style>{`
                @keyframes pulse {
                    0%,100% { box-shadow: 0 0 0 0 rgba(0,171,86,0.3); }
                    50% { box-shadow: 0 0 0 8px rgba(0,171,86,0); }
                }
            `}</style>
        </div>
    );
}
