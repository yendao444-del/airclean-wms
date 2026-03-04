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
    const trackRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animRef = useRef<number>(0);
    const posRef = useRef<number>(0);
    const pausedRef = useRef(false);
    const [containerWidth, setContainerWidth] = useState(600);

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
                    .filter((t: TickerTask) => t.diffMinutes <= 60 && t.diffMinutes > -1440)
                    .sort((a: TickerTask, b: TickerTask) => a.diffMinutes - b.diffMinutes);
                setTickerTasks(upcoming);
            }
        } catch (err) {
            console.log('[HeaderTicker] Load error:', err);
        }
    }, []);

    // Load mỗi 30 giây
    useEffect(() => {
        loadTasks();
        const interval = setInterval(loadTasks, 30000);
        return () => clearInterval(interval);
    }, [loadTasks]);

    // Lắng nghe event task-changed
    useEffect(() => {
        const onTaskChanged = () => loadTasks();
        window.addEventListener('task-changed', onTaskChanged);
        return () => window.removeEventListener('task-changed', onTaskChanged);
    }, [loadTasks]);

    // Đo container width
    useEffect(() => {
        if (containerRef.current) {
            setContainerWidth(containerRef.current.offsetWidth);
        }
        const onResize = () => {
            if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [tickerTasks]);

    // JavaScript-based scroll animation (đáng tin cậy hơn CSS animation)
    useEffect(() => {
        if (tickerTasks.length === 0) return;

        const speed = 0.8; // pixels per frame (~48px/s at 60fps)

        const animate = () => {
            if (!trackRef.current || !containerRef.current) return;
            if (!pausedRef.current) {
                posRef.current -= speed;
                // Nửa đầu track = nội dung gốc + gap (containerWidth)
                const halfTrack = trackRef.current.scrollWidth / 2;
                // Khi nửa đầu đã chạy hết khỏi viewport → reset (seamless)
                if (Math.abs(posRef.current) >= halfTrack) {
                    posRef.current += halfTrack;
                }
                trackRef.current.style.transform = `translateX(${posRef.current}px)`;
            }
            animRef.current = requestAnimationFrame(animate);
        };

        // Bắt đầu từ mép phải container
        posRef.current = containerRef.current?.offsetWidth || 300;
        animRef.current = requestAnimationFrame(animate);

        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [tickerTasks, containerWidth]);

    if (tickerTasks.length === 0) return null;

    const getUrgencyStyle = (diff: number) => {
        if (diff < 0) return { color: '#ff4d4f', icon: '⛔', label: `TRỄ ${Math.abs(diff)} phút` };
        if (diff <= 10) return { color: '#fa541c', icon: '🔥', label: `còn ${diff} phút` };
        if (diff <= 30) return { color: '#faad14', icon: '⚠️', label: `còn ${diff} phút` };
        return { color: '#1890ff', icon: '🔔', label: `còn ${diff} phút` };
    };

    const renderTaskItems = (keyPrefix: string) =>
        tickerTasks.map((task, i) => {
            const style = getUrgencyStyle(task.diffMinutes);
            return (
                <span key={`${keyPrefix}-${task.id}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    {i > 0 && (
                        <span style={{ margin: '0 16px', color: '#d9d9d9', fontSize: 10 }}>★</span>
                    )}
                    <span style={{
                        fontSize: 13, fontWeight: 600, color: style.color, letterSpacing: 0.3,
                    }}>
                        {style.icon} Bàn giao "{task.title}"
                    </span>
                    <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 6 }}>
                        ({task.assignee})
                    </span>
                    <span style={{
                        fontSize: 12, fontWeight: 700, color: style.color, marginLeft: 6,
                        padding: '1px 6px', borderRadius: 4,
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
        });

    return (
        <div
            ref={containerRef}
            onClick={() => onNavigate?.('daily-tasks')}
            onMouseEnter={() => { pausedRef.current = true; }}
            onMouseLeave={() => { pausedRef.current = false; }}
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

            {/* Scrolling track — JS animation */}
            <div
                ref={trackRef}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: '100%',
                    whiteSpace: 'nowrap',
                    willChange: 'transform',
                }}
            >
                {/* Original content */}
                {renderTaskItems('a')}
                {/* Gap = container width → đảm bảo bản copy không bao giờ hiện cùng lúc */}
                <span style={{ display: 'inline-block', minWidth: containerWidth }} />
                {/* Duplicate cho seamless loop */}
                {renderTaskItems('b')}
                <span style={{ display: 'inline-block', minWidth: containerWidth }} />
            </div>
        </div>
    );
}
