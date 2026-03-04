import { useState, useEffect, useCallback, useRef } from 'react';
import dayjs from 'dayjs';
import AlertPopup, { AlertPopupItem } from './AlertPopup';

/**
 * GlobalTaskAlerts - Component chạy TOÀN CỤC ở App.tsx
 * Kiểm tra deadline "Bàn giao" mỗi 30 giây, phát âm thanh + popup cảnh báo
 * BẤT KỂ user đang ở tab nào.
 */

// === AUDIO HELPERS ===
const generateBeepWav = (freq: number, durationMs: number, volume = 0.7, waveType: 'sine' | 'square' | 'sawtooth' = 'sine'): string => {
    const sampleRate = 22050;
    const numSamples = Math.floor(sampleRate * durationMs / 1000);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const fadeOut = i < numSamples * 0.1 ? (i / (numSamples * 0.1)) : 1 - ((i - numSamples * 0.1) / (numSamples * 0.9));
        let raw = 0;
        if (waveType === 'square') {
            raw = Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1;
        } else if (waveType === 'sawtooth') {
            raw = 2 * ((freq * t) % 1) - 1;
        } else {
            raw = Math.sin(2 * Math.PI * freq * t);
        }
        view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, raw * volume * fadeOut * 32767)), true);
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(binary);
};

const playSiren = (cycles: number) => {
    try {
        for (let i = 0; i < cycles; i++) {
            setTimeout(() => new Audio(generateBeepWav(880, 220, 0.8, 'square')).play().catch(() => { }), i * 440);
            setTimeout(() => new Audio(generateBeepWav(1200, 220, 0.8, 'square')).play().catch(() => { }), i * 440 + 220);
        }
    } catch { }
};

const playUrgentBeeps = (count: number) => {
    try {
        for (let i = 0; i < count; i++) {
            setTimeout(() => new Audio(generateBeepWav(1100, 120, 0.75, 'square')).play().catch(() => { }), i * 180);
        }
    } catch { }
};

const playWarningBeeps = (count: number) => {
    try {
        for (let i = 0; i < count; i++) {
            setTimeout(() => new Audio(generateBeepWav(880, 200, 0.6, 'sine')).play().catch(() => { }), i * 350);
        }
    } catch { }
};

const playInfoBeep = () => {
    try {
        new Audio(generateBeepWav(660, 300, 0.45, 'sine')).play().catch(() => { });
    } catch { }
};

const formatTimeDiff = (minutes: number) => {
    if (minutes < 60) return `${minutes} phút`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h < 24) return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
    const d = Math.floor(h / 24);
    return `${d} ngày ${h % 24}h`;
};

interface TaskForAlert {
    id: number;
    title: string;
    assignee: string;
    dueDate: string;
    dueTime: string;
    status: string;
    type?: string;
}

export default function GlobalTaskAlerts() {
    const [tasks, setTasks] = useState<TaskForAlert[]>([]);
    const [alertPopups, setAlertPopups] = useState<AlertPopupItem[]>([]);
    const [acknowledgedTasks, setAcknowledgedTasks] = useState<Set<number>>(() => new Set());
    const lastOverdueAlertRef = useRef<Map<number, number>>(new Map());

    const addAlertPopup = useCallback((item: Omit<AlertPopupItem, 'id'>) => {
        const id = `global-alert-${Date.now()}-${Math.random()}`;
        setAlertPopups(prev => {
            const key = `${item.taskName}-${item.level}`;
            if (prev.some(p => `${p.taskName}-${p.level}` === key)) return prev;
            return [...prev, { ...item, id }];
        });
    }, []);

    const dismissAlertPopup = useCallback((id: string) => {
        setAlertPopups(prev => prev.filter(p => p.id !== id));
    }, []);

    // Load tasks từ DB mỗi 60 giây
    useEffect(() => {
        const loadTasks = async () => {
            try {
                const result = await window.electronAPI.dailyTasks.list({});
                if (result.success && result.data) {
                    const assignmentTasks = result.data
                        .filter((t: any) => (t.type === 'assignment') && t.status !== 'completed')
                        .map((t: any) => ({
                            id: t.id,
                            title: t.title,
                            assignee: t.assignee,
                            dueDate: dayjs(t.dueDate).format('YYYY-MM-DD'),
                            dueTime: dayjs(t.dueDate).format('HH:mm'),
                            status: t.status,
                            type: t.type,
                        }));
                    setTasks(assignmentTasks);
                }
            } catch (err) {
                console.log('[GlobalAlerts] Load tasks error:', err);
            }
        };

        loadTasks();
        const interval = setInterval(loadTasks, 60000); // reload mỗi 60 giây
        return () => clearInterval(interval);
    }, []);

    // Kiểm tra deadline mỗi 30 giây → popup + âm thanh
    useEffect(() => {
        const interval = setInterval(() => {
            const now = dayjs();

            tasks.forEach(task => {
                if (task.status === 'completed') return;
                const deadline = dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm');
                const diffMinutes = deadline.diff(now, 'minute');

                // QUÁ HẠN
                if (diffMinutes < 0) {
                    const overdueMin = Math.abs(diffMinutes);
                    if (overdueMin >= 1440) return; // quá 24h → bỏ

                    const alreadyAlerted = lastOverdueAlertRef.current.get(task.id);
                    if (!alreadyAlerted && overdueMin >= 10) {
                        lastOverdueAlertRef.current.set(task.id, Date.now());
                        playSiren(6);
                        addAlertPopup({
                            level: 'overdue',
                            taskName: task.title,
                            assignee: task.assignee,
                            deadline: `${task.dueDate} ${task.dueTime}`,
                            timeNum: overdueMin,
                            timeUnit: 'phút trễ',
                        });
                    }
                    return;
                }

                // CÒN ≤ 10 PHÚT
                if (diffMinutes <= 10) {
                    if (!acknowledgedTasks.has(task.id)) {
                        addAlertPopup({
                            level: 'urgent',
                            taskName: task.title,
                            assignee: task.assignee,
                            deadline: `${task.dueDate} ${task.dueTime}`,
                            timeNum: diffMinutes,
                            timeUnit: 'phút còn lại',
                        });
                    }
                    return;
                }

                // CÒN 10-20 PHÚT
                if (diffMinutes <= 20) {
                    playWarningBeeps(5);
                    addAlertPopup({
                        level: 'urgent',
                        taskName: task.title,
                        assignee: task.assignee,
                        deadline: `${task.dueDate} ${task.dueTime}`,
                        timeNum: diffMinutes,
                        timeUnit: 'phút còn lại',
                        autoDismiss: 10000,
                    });
                    return;
                }

                // CÒN 20-30 PHÚT
                if (diffMinutes <= 30) {
                    playWarningBeeps(3);
                    addAlertPopup({
                        level: 'warning',
                        taskName: task.title,
                        assignee: task.assignee,
                        deadline: `${task.dueDate} ${task.dueTime}`,
                        timeNum: diffMinutes,
                        timeUnit: 'phút còn lại',
                        autoDismiss: 8000,
                    });
                    return;
                }

                // CÒN 30-60 PHÚT
                if (diffMinutes <= 60) {
                    playInfoBeep();
                    addAlertPopup({
                        level: 'info',
                        taskName: task.title,
                        assignee: task.assignee,
                        deadline: `${task.dueDate} ${task.dueTime}`,
                        timeNum: formatTimeDiff(diffMinutes),
                        timeUnit: 'còn lại',
                        autoDismiss: 6000,
                    });
                    return;
                }
            });
        }, 30000);
        return () => clearInterval(interval);
    }, [tasks, acknowledgedTasks, addAlertPopup]);

    // Alarm liên tục mỗi 5 giây khi ≤ 10 phút
    useEffect(() => {
        const alarmInterval = setInterval(() => {
            const now = dayjs();
            const urgentTasks = tasks.filter(t => {
                if (t.status === 'completed') return false;
                if (acknowledgedTasks.has(t.id)) return false;
                const deadline = dayjs(`${t.dueDate} ${t.dueTime}`, 'YYYY-MM-DD HH:mm');
                const diff = deadline.diff(now, 'minute');
                return diff >= 0 && diff <= 10;
            });
            if (urgentTasks.length > 0) playUrgentBeeps(5);
        }, 5000);
        return () => clearInterval(alarmInterval);
    }, [tasks, acknowledgedTasks]);

    // Render popup overlay (luôn hiển thị bất kể tab nào)
    return <AlertPopup popups={alertPopups} onDismiss={dismissAlertPopup} />;
}
