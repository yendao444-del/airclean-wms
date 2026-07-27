import { useEffect, useRef } from 'react';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';

export type AlertLevel = 'overdue' | 'urgent' | 'warning' | 'info' | 'assignment';

export interface AlertPopupItem {
    id: string;
    level: AlertLevel;
    taskName: string;
    assignee: string;
    deadline: string;
    timeNum: string | number;
    timeUnit: string;
    autoDismiss?: number; // ms, 0 = không tự đóng
    actionLabel?: string;
    onAction?: () => void;
}

interface AlertPopupProps {
    popups: AlertPopupItem[];
    onDismiss: (id: string) => void;
}

const LEVEL_CONFIG = {
    overdue: {
        icon: '⛔',
        headerTitle: 'QUÁ HẠN — Xử lý ngay!',
        headerSub: 'Bàn giao chưa được hoàn thành',
        headerBg: 'linear-gradient(135deg, #a8071a 0%, #ff4d4f 100%)',
        flash: true,
        countColor: '#cf1322',
        countBg: '#fff1f0',
        countBorder: '#ffa39e',
        btnColor: '#ff4d4f',
    },
    urgent: {
        icon: '🔥',
        headerTitle: 'Sắp đến hạn bàn giao!',
        headerSub: 'Còn rất ít thời gian',
        headerBg: 'linear-gradient(135deg, #ad4e00 0%, #fa541c 100%)',
        flash: false,
        countColor: '#d4380d',
        countBg: '#fff7e6',
        countBorder: '#ffd591',
        btnColor: '#fa541c',
    },
    warning: {
        icon: '⚠️',
        headerTitle: 'Nhắc nhở bàn giao',
        headerSub: 'Kiểm tra tiến độ công việc',
        headerBg: 'linear-gradient(135deg, #874d00 0%, #faad14 100%)',
        flash: false,
        countColor: '#d48806',
        countBg: '#fffbe6',
        countBorder: '#ffe58f',
        btnColor: '#faad14',
    },
    info: {
        icon: '🔔',
        headerTitle: 'Nhắc nhở bàn giao',
        headerSub: 'Còn thời gian chuẩn bị',
        headerBg: 'linear-gradient(135deg, #003a8c 0%, #1890ff 100%)',
        flash: false,
        countColor: '#096dd9',
        countBg: '#e6f7ff',
        countBorder: '#91d5ff',
        btnColor: '#1890ff',
    },
    assignment: {
        icon: '📌',
        headerTitle: 'BÀN GIAO MỚI',
        headerSub: 'Bạn vừa được giao công việc mới',
        headerBg: 'linear-gradient(135deg, #075985 0%, #0284c7 100%)',
        flash: false,
        countColor: '#0369a1',
        countBg: '#f0f9ff',
        countBorder: '#7dd3fc',
        btnColor: '#0284c7',
    },
};

function PopupCard({ popup, onDismiss }: { popup: AlertPopupItem; onDismiss: () => void }) {
    const cfg = LEVEL_CONFIG[popup.level];
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (popup.autoDismiss && popup.autoDismiss > 0) {
            timerRef.current = setTimeout(onDismiss, popup.autoDismiss);
        }
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, []);

    return (
        <div style={{
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)',
            animation: 'alertPopIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards',
            transformOrigin: 'bottom right',
            width: 360,
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px 10px',
                background: cfg.headerBg,
                color: popup.level === 'warning' ? '#1a1a1a' : '#fff',
                animation: cfg.flash ? 'alertFlashRed 0.9s infinite' : undefined,
                position: 'relative',
            }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{cfg.icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{cfg.headerTitle}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{cfg.headerSub}</div>
                </div>
                <button
                    onClick={onDismiss}
                    style={{
                        background: 'rgba(0,0,0,0.2)',
                        border: 'none',
                        color: 'inherit',
                        width: 22, height: 22,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        fontSize: 11,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <CloseOutlined />
                </button>
            </div>

            {/* Body */}
            <div style={{
                background: '#fff',
                padding: '12px 14px 14px',
                border: '1px solid rgba(0,0,0,0.06)',
                borderTop: 'none',
            }}>
                {/* Task name */}
                <div style={{
                    fontSize: 15, fontWeight: 700, color: '#1a1a2e',
                    marginBottom: 6,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    "{popup.taskName}"
                </div>

                {/* Meta */}
                <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
                        👤 <strong>{popup.assignee}</strong>
                    </span>
                    <span style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
                        🕐 Hạn: {popup.deadline}
                    </span>
                </div>

                {/* Countdown */}
                <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 6,
                    padding: '8px 12px',
                    background: cfg.countBg,
                    border: `1px solid ${cfg.countBorder}`,
                    borderRadius: 8,
                    marginBottom: 10,
                }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: cfg.countColor, lineHeight: 1 }}>
                        {popup.timeNum}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#595959' }}>
                        {popup.timeUnit}
                    </span>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => {
                            popup.onAction?.();
                            onDismiss();
                        }}
                        style={{
                            flex: 1, border: 'none', borderRadius: 7,
                            padding: '8px', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer',
                            background: cfg.btnColor, color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        }}
                    >
                        <CheckOutlined /> {popup.actionLabel || 'Đã biết'}
                    </button>
                    <button
                        onClick={onDismiss}
                        style={{
                            flex: 1, border: '1px solid #e8e8e8', borderRadius: 7,
                            padding: '8px', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', background: '#f5f5f5', color: '#595959',
                        }}
                    >
                        Bỏ qua
                    </button>
                </div>
            </div>

            {/* Progress bar auto-dismiss */}
            {popup.autoDismiss && popup.autoDismiss > 0 && (
                <div style={{ height: 3, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                    <div style={{
                        height: '100%',
                        background: 'rgba(0,0,0,0.2)',
                        animation: `alertShrink ${popup.autoDismiss / 1000}s linear forwards`,
                    }} />
                </div>
            )}
        </div>
    );
}

export default function AlertPopup({ popups, onDismiss }: AlertPopupProps) {
    return (
        <>
            <style>{`
                @keyframes alertPopIn {
                    from { transform: translateX(120%) scale(0.85); opacity: 0; }
                    to   { transform: translateX(0) scale(1);       opacity: 1; }
                }
                @keyframes alertFlashRed {
                    0%, 100% { background: linear-gradient(135deg, #a8071a, #ff4d4f); }
                    50%       { background: linear-gradient(135deg, #cf1322, #ff7875); }
                }
                @keyframes alertShrink {
                    from { width: 100%; }
                    to   { width: 0%; }
                }
            `}</style>
            <div style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                display: 'flex',
                flexDirection: 'column-reverse',
                gap: 12,
                zIndex: 9999,
                pointerEvents: 'none',
            }}>
                {popups.map(popup => (
                    <div key={popup.id} style={{ pointerEvents: 'auto' }}>
                        <PopupCard
                            popup={popup}
                            onDismiss={() => onDismiss(popup.id)}
                        />
                    </div>
                ))}
            </div>
        </>
    );
}
