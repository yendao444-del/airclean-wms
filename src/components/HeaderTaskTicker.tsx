import { useState, useEffect, useRef, useCallback } from 'react';
import dayjs from 'dayjs';

interface TickerAlert {
    key: string;
    icon: string;
    text: string;
    badge: string;
    color: string;
    navTo: string;
    priority: number;
}

interface HeaderTaskTickerProps {
    onNavigate?: (key: string) => void;
}

const PAUSE_BETWEEN_CYCLES = 20 * 60 * 1000; // 20 phút giữa các vòng
const PAUSE_BETWEEN_ALERTS = 1500; // 1.5s nghỉ giữa mỗi thông báo

export default function HeaderTaskTicker({ onNavigate }: HeaderTaskTickerProps) {
    const [alerts, setAlerts] = useState<TickerAlert[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [phase, setPhase] = useState<'scrolling' | 'pausing' | 'sleeping'>('scrolling');
    const trackRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animRef = useRef<number>(0);
    const posRef = useRef<number>(0);
    const pausedRef = useRef(false); // hover pause
    const textWidthRef = useRef<number>(0);

    const loadData = useCallback(async () => {
        const result: TickerAlert[] = [];

        try {
            const taskRes = await (window as any).electronAPI.dailyTasks.list({});
            if (taskRes.success && taskRes.data) {
                const now = dayjs();
                const urgent = taskRes.data
                    .filter((t: any) => t.type === 'assignment' && t.status !== 'completed')
                    .map((t: any) => ({ ...t, diff: dayjs(t.dueDate).diff(now, 'minute') }))
                    .filter((t: any) => t.diff <= 60 && t.diff > -1440);

                if (urgent.length > 0) {
                    const overdue = urgent.filter((t: any) => t.diff < 0);
                    const upcoming = urgent.filter((t: any) => t.diff >= 0);
                    if (overdue.length > 0) {
                        result.push({
                            key: 'task-overdue', icon: '⛔', navTo: 'daily-tasks', priority: 1,
                            color: '#ff4d4f',
                            text: `${overdue.length} bàn giao đã TRỄ`,
                            badge: `trễ nhất ${Math.abs(overdue[overdue.length - 1].diff)} phút`,
                        });
                    }
                    if (upcoming.length > 0) {
                        const nearest = upcoming[0];
                        result.push({
                            key: 'task-upcoming', icon: '🔔', navTo: 'daily-tasks', priority: 2,
                            color: nearest.diff <= 10 ? '#fa541c' : '#faad14',
                            text: `${upcoming.length} bàn giao sắp đến hạn`,
                            badge: `gần nhất ${nearest.diff} phút`,
                        });
                    }
                }
            }
        } catch { }

        try {
            const purRes = await (window as any).electronAPI.purchases.getAll();
            if (purRes.success && purRes.data) {
                const CUTOFF = dayjs('2026-03-19');
                const now = dayjs();
                const missing = purRes.data.filter((p: any) =>
                    p.vatInvoiceStatus !== 'uploaded' &&
                    p.vatInvoiceStatus !== 'thht' &&
                    p.vatInvoiceStatus !== 'no_vat' &&
                    now.diff(dayjs(p.purchaseDate || p.invoiceDate || p.createdAt), 'day') >= 3 &&
                    dayjs(p.purchaseDate || p.invoiceDate || p.createdAt).isAfter(CUTOFF)
                );
                if (missing.length > 0) {
                    const maxDays = Math.max(...missing.map((p: any) => now.diff(dayjs(p.purchaseDate), 'day')));
                    result.push({
                        key: 'vat', icon: '🧾', navTo: 'purchase', priority: 3,
                        color: maxDays >= 7 ? '#ff4d4f' : maxDays >= 5 ? '#fa541c' : '#faad14',
                        text: `${missing.length} phiếu chưa có HĐ VAT`,
                        badge: `lâu nhất ${maxDays} ngày`,
                    });
                }
            }
        } catch { }

        try {
            const prodRes = await (window as any).electronAPI.products.getAll();
            if (prodRes.success && prodRes.data) {
                const low = prodRes.data.filter((p: any) =>
                    p.status === 'active' && p.minStock > 0 && p.stock < p.minStock
                );
                if (low.length > 0) {
                    const outOfStock = low.filter((p: any) => p.stock === 0).length;
                    result.push({
                        key: 'stock', icon: '📦', navTo: 'products', priority: 4,
                        color: outOfStock > 0 ? '#ff4d4f' : '#faad14',
                        text: `${low.length} SP tồn kho thấp${outOfStock > 0 ? ` (${outOfStock} hết hàng)` : ''}`,
                        badge: 'cần nhập thêm',
                    });
                }
            }
        } catch { }

        // Không thông báo module Xuất HĐĐT

        result.sort((a, b) => a.priority - b.priority);
        setAlerts(result);
        setCurrentIndex(0);
        setPhase('scrolling');
    }, []);

    // ⚡ Delay 10s lần đầu để Dashboard load xong, sau đó poll mỗi 5 phút
    useEffect(() => {
        const initDelay = setTimeout(loadData, 10000);
        const interval = setInterval(loadData, 5 * 60 * 1000);
        return () => {
            clearTimeout(initDelay);
            clearInterval(interval);
        };
    }, [loadData]);

    useEffect(() => {
        const onTaskChanged = () => loadData();
        window.addEventListener('task-changed', onTaskChanged);
        return () => window.removeEventListener('task-changed', onTaskChanged);
    }, [loadData]);

    // Scroll animation cho từng alert riêng biệt
    useEffect(() => {
        if (alerts.length === 0 || phase !== 'scrolling') return;

        const idx = currentIndex % alerts.length;
        const speed = 1.2; // px/frame

        // Đợi DOM render xong rồi đo kích thước
        const startTimeout = setTimeout(() => {
            if (!trackRef.current || !containerRef.current) return;

            const containerW = containerRef.current.offsetWidth;
            const textW = trackRef.current.scrollWidth;
            textWidthRef.current = textW;

            // Bắt đầu từ mép phải
            posRef.current = containerW;

            const animate = () => {
                if (!trackRef.current) return;

                if (!pausedRef.current) {
                    posRef.current -= speed;
                    trackRef.current.style.transform = `translateX(${posRef.current}px)`;

                    // Khi text đã chạy hết khỏi bên trái
                    if (posRef.current < -textWidthRef.current) {
                        // Chuyển sang alert tiếp theo
                        const nextIdx = idx + 1;
                        if (nextIdx >= alerts.length) {
                            // Hết vòng → sleep 20 phút
                            setPhase('sleeping');
                            return;
                        } else {
                            // Pause ngắn rồi chạy alert tiếp
                            setPhase('pausing');
                            setTimeout(() => {
                                setCurrentIndex(nextIdx);
                                setPhase('scrolling');
                            }, PAUSE_BETWEEN_ALERTS);
                            return;
                        }
                    }
                }

                animRef.current = requestAnimationFrame(animate);
            };

            animRef.current = requestAnimationFrame(animate);
        }, 50);

        return () => {
            clearTimeout(startTimeout);
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [alerts, currentIndex, phase]);

    // Sleep cycle: 20 phút rồi chạy lại
    useEffect(() => {
        if (phase !== 'sleeping') return;
        const timer = setTimeout(() => {
            loadData(); // Reload data mới
        }, PAUSE_BETWEEN_CYCLES);
        return () => clearTimeout(timer);
    }, [phase, loadData]);

    if (alerts.length === 0 || phase === 'sleeping') return null;

    const current = alerts[currentIndex % alerts.length];
    if (!current) return null;

    const hasRed = current.color === '#ff4d4f';
    const hasOrange = current.color === '#fa541c';

    return (
        <div
            ref={containerRef}
            onClick={() => onNavigate?.(current.navTo)}
            onMouseEnter={() => { pausedRef.current = true; }}
            onMouseLeave={() => { pausedRef.current = false; }}
            style={{
                flex: 1, margin: '0 16px', overflow: 'hidden', cursor: 'pointer',
                position: 'relative', height: 36, borderRadius: 6,
                display: 'flex', alignItems: 'center',
                background: hasRed ? 'rgba(255,240,240,0.9)' : hasOrange ? 'rgba(255,245,235,0.9)' : 'rgba(255,251,240,0.9)',
                border: hasRed ? '1px solid #ffccc7' : hasOrange ? '1px solid #ffd8bf' : '1px solid #ffe7ba',
            }}
        >
            {/* Counter badge */}
            <div style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                fontSize: 10, color: '#8c8c8c', background: 'rgba(255,255,255,0.8)',
                padding: '1px 6px', borderRadius: 10, zIndex: 1,
                pointerEvents: 'none',
            }}>
                {currentIndex + 1}/{alerts.length}
            </div>

            {/* Single scrolling alert */}
            <div
                ref={trackRef}
                style={{
                    display: 'inline-flex', alignItems: 'center',
                    height: 36, lineHeight: '36px', whiteSpace: 'nowrap',
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600, color: current.color }}>
                    {current.icon} {current.text}
                </span>
                <span style={{
                    fontSize: 12, fontWeight: 700, color: current.color, marginLeft: 8,
                    padding: '2px 8px', borderRadius: 4,
                    background: current.color === '#ff4d4f' ? 'rgba(255,77,79,0.1)' : current.color === '#fa541c' ? 'rgba(250,84,28,0.1)' : 'rgba(250,173,20,0.1)',
                }}>
                    {current.badge}
                </span>
            </div>
        </div>
    );
}
