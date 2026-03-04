import { useState, useEffect, useRef, useCallback } from 'react';
import dayjs from 'dayjs';

interface TickerTask {
    id: number;
    title: string;
    assignee: string;
    dueDate: string;
    dueTime: string;
    diffMinutes: number;
}

interface HeaderTaskTickerProps {
    onNavigate?: (key: string) => void;
}

export default function HeaderTaskTicker({ onNavigate }: HeaderTaskTickerProps) {
    const [tickerTasks, setTickerTasks] = useState<TickerTask[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    const loadTasks = useCallback(async () => {
        try {
            const result = await (window as any).electronAPI.dailyTasks.list({});
            if (result.success && result.data) {
                const now = dayjs();
                const upcoming = result.data
                    .filter((t: any) => t.type === 'assignment' && t.status !== 'completed')
                    .map((t: any) => {
                        const deadline = dayjs(t.dueDate);
                        const diff = deadline.diff(now, 'minute');
                        return {
                            id: t.id,
                            title: t.title,
                            assignee: t.assignee,
                            dueDate: dayjs(t.dueDate).format('YYYY-MM-DD'),
                            dueTime: dayjs(t.dueDate).format('HH:mm'),
                            diffMinutes: diff,
                        };
                    })
                    // Chỉ lấy task trong vòng 60 phút hoặc đã quá hạn (trong 24h)
                    .filter((t: TickerTask) => t.diffMinutes <= 60 && t.diffMinutes > -1440)
                    .sort((a: TickerTask, b: TickerTask) => a.diffMinutes - b.diffMinutes);
                setTickerTasks(upcoming);
            }
        } catch (err) {
            console.log('[HeaderTicker] Load error:', err);
        }
    }, []);

    // Load tasks mỗi 30 giây
    useEffect(() => {
        loadTasks();
        const interval = setInterval(loadTasks, 30000);
        return () => clearInterval(interval);
    }, [loadTasks]);

    // Lắng nghe event khi task bị xóa/hoàn thành → reload ngay
    useEffect(() => {
        const onTaskChanged = () => loadTasks();
        window.addEventListener('task-changed', onTaskChanged);
        return () => window.removeEventListener('task-changed', onTaskChanged);
    }, [loadTasks]);

    if (tickerTasks.length === 0) return null;

    const getUrgencyStyle = (diff: number) => {
        if (diff < 0) return { color: '#ff4d4f', icon: '⛔', label: `TRỄ ${Math.abs(diff)} phút` };
        if (diff <= 10) return { color: '#fa541c', icon: '🔥', label: `còn ${diff} phút` };
        if (diff <= 30) return { color: '#faad14', icon: '⚠️', label: `còn ${diff} phút` };
        return { color: '#1890ff', icon: '🔔', label: `còn ${diff} phút` };
    };

    // Build ticker text từ tất cả tasks
    const tickerContent = tickerTasks.map(task => {
        const style = getUrgencyStyle(task.diffMinutes);
        return `${style.icon} Bàn giao "${task.title}" (${task.assignee}) — ${style.label}`;
    });

    // Nhân đôi nội dung để tạo hiệu ứng chạy liên tục
    const separator = '          ★          ';
    const fullText = tickerContent.join(separator);

    // Tính tốc độ animation dựa trên độ dài text
    const speed = Math.max(15, tickerContent.length * 12);

    return (
        <>
            <style>{`
                @keyframes tickerScroll {
                    0% { transform: translateX(100%); }
                    100% { transform: translateX(-100%); }
                }
                .header-ticker-wrap:hover .header-ticker-track {
                    animation-play-state: paused;
                }
            `}</style>
            <div
                ref={containerRef}
                className="header-ticker-wrap"
                onClick={() => onNavigate?.('daily-tasks')}
                style={{
                    flex: 1,
                    margin: '0 20px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    position: 'relative',
                    height: 32,
                    borderRadius: 6,
                    background: tickerTasks.some(t => t.diffMinutes < 0)
                        ? 'linear-gradient(90deg, rgba(255,77,79,0.08), rgba(255,77,79,0.04))'
                        : tickerTasks.some(t => t.diffMinutes <= 10)
                            ? 'linear-gradient(90deg, rgba(250,84,28,0.08), rgba(250,84,28,0.04))'
                            : 'linear-gradient(90deg, rgba(24,144,255,0.06), rgba(24,144,255,0.03))',
                    border: tickerTasks.some(t => t.diffMinutes < 0)
                        ? '1px solid rgba(255,77,79,0.2)'
                        : tickerTasks.some(t => t.diffMinutes <= 10)
                            ? '1px solid rgba(250,84,28,0.15)'
                            : '1px solid rgba(24,144,255,0.12)',
                }}
            >
                {/* Fade edges */}
                <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0, width: 30,
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.95), transparent)',
                    zIndex: 2, pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: 30,
                    background: 'linear-gradient(270deg, rgba(255,255,255,0.95), transparent)',
                    zIndex: 2, pointerEvents: 'none',
                }} />

                {/* Scrolling track */}
                <div
                    className="header-ticker-track"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: '100%',
                        whiteSpace: 'nowrap',
                        animation: `tickerScroll ${speed}s linear infinite`,
                    }}
                >
                    {tickerTasks.map((task, i) => {
                        const style = getUrgencyStyle(task.diffMinutes);
                        return (
                            <span key={`a-${task.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                {i > 0 && (
                                    <span style={{
                                        margin: '0 16px',
                                        color: '#d9d9d9',
                                        fontSize: 10,
                                    }}>★</span>
                                )}
                                <span style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: style.color,
                                    letterSpacing: 0.3,
                                }}>
                                    {style.icon} Bàn giao "{task.title}"
                                </span>
                                <span style={{
                                    fontSize: 12,
                                    color: '#8c8c8c',
                                    marginLeft: 6,
                                }}>
                                    ({task.assignee})
                                </span>
                                <span style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: style.color,
                                    marginLeft: 6,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: task.diffMinutes < 0
                                        ? 'rgba(255,77,79,0.1)'
                                        : task.diffMinutes <= 10
                                            ? 'rgba(250,84,28,0.1)'
                                            : task.diffMinutes <= 30
                                                ? 'rgba(250,173,20,0.1)'
                                                : 'rgba(24,144,255,0.08)',
                                }}>
                                    {style.label}
                                </span>
                            </span>
                        );
                    })}
                    {/* Duplicate cho seamless loop */}
                    {tickerTasks.map((task, i) => {
                        const style = getUrgencyStyle(task.diffMinutes);
                        return (
                            <span key={`b-${task.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                <span style={{
                                    margin: '0 16px',
                                    color: '#d9d9d9',
                                    fontSize: 10,
                                }}>★</span>
                                <span style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: style.color,
                                    letterSpacing: 0.3,
                                }}>
                                    {style.icon} Bàn giao "{task.title}"
                                </span>
                                <span style={{
                                    fontSize: 12,
                                    color: '#8c8c8c',
                                    marginLeft: 6,
                                }}>
                                    ({task.assignee})
                                </span>
                                <span style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: style.color,
                                    marginLeft: 6,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: task.diffMinutes < 0
                                        ? 'rgba(255,77,79,0.1)'
                                        : task.diffMinutes <= 10
                                            ? 'rgba(250,84,28,0.1)'
                                            : task.diffMinutes <= 30
                                                ? 'rgba(250,173,20,0.1)'
                                                : 'rgba(24,144,255,0.08)',
                                }}>
                                    {style.label}
                                </span>
                            </span>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
