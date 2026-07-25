import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
    Card,
    Button,
    Checkbox,
    Tag,
    Avatar,
    Space,
    Tooltip,
    Badge,
    Progress,
    Empty,
    Divider,
    Modal,
    Form,
    Input,
    InputNumber,
    message,
    DatePicker,
    Select,
    Radio,
    Alert,
    Upload
} from 'antd';
const { TextArea } = Input;
const { Option } = Select;
import {
    PlusOutlined,
    ClockCircleOutlined,
    FireFilled,
    ThunderboltFilled,
    CheckCircleFilled,
    CheckCircleOutlined,
    WarningOutlined,
    UserOutlined,
    EditOutlined,
    DeleteOutlined,
    CalendarOutlined,
    FileTextOutlined,
    UploadOutlined,
    LinkOutlined,
    PictureOutlined,
    EyeOutlined,
    SafetyCertificateOutlined,
    MoreOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
    DAILY_REPORT_MISSING_FINE_OFFICIAL,
    DAILY_REPORT_POLICY_START_DATE,
    getFixedVietnamHolidayName,
    isDailyReportRestDay,
    isPastDailyReportWorkingDay,
} from '../lib/workCalendar';
import './DailyTasks.css';
import AlertPopup, { AlertPopupItem } from '../components/AlertPopup';


interface ProcessLog {
    timestamp: string; // DD/MM HH[h]mm
    note: string;
}

const parseNotes = (note?: string): ProcessLog[] => {
    if (!note) return [];
    try {
        const parsed = JSON.parse(note);
        if (Array.isArray(parsed)) return parsed;
        return [{ timestamp: '', note: String(parsed) }];
    } catch {
        return [{ timestamp: '', note }];
    }
};

interface Task {
    id: number;
    title: string;
    category: string;
    assignee: string; // Có thể rỗng '' khi chưa phân công
    verifier?: string;
    area?: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    dueTime: string;
    dueDate?: string;
    status: 'pending' | 'completed';
    tags?: string[];
    description?: string;
    note?: string;
    type?: 'daily' | 'assignment';
    attachments?: unknown;
    evidencePenaltyRecorded?: boolean;
}

interface EvidenceMeta {
    required?: boolean;
    method?: 'link' | 'image' | 'both';
    status?: 'pending' | 'submitted' | 'approved' | 'rejected';
    penaltyAmount?: number;
    submittedAt?: string;
    submittedBy?: string;
    submittedUrl?: string;
    submittedImage?: { name: string; mimeType: string; storagePath: string; hash: string };
    reviewedAt?: string;
    reviewedBy?: string;
}

const parseAttachments = (attachments?: unknown): Record<string, any> => {
    if (!attachments) return {};
    if (typeof attachments === 'string') {
        try {
            const parsed = JSON.parse(attachments);
            return Array.isArray(parsed) ? { files: parsed } : parsed || {};
        } catch {
            return {};
        }
    }
    return Array.isArray(attachments) ? { files: attachments } : attachments as Record<string, any>;
};

const getEvidence = (task: Task): EvidenceMeta => parseAttachments(task.attachments).evidence || {};

const DEFAULT_EVIDENCE_PENALTY = 30000;
const EVIDENCE_DEADLINE_OPTIONS = Array.from({ length: 24 * 12 }, (_, index) => {
    const hour = Math.floor(index / 12);
    const minute = (index % 12) * 5;
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { value, label: value };
});

const normalizePenaltyAmount = (value: unknown): number => {
    const raw = typeof value === 'string' ? value.replace(/[^\d]/g, '') : value;
    const amount = Number(raw);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : DEFAULT_EVIDENCE_PENALTY;
};

const formatPenaltyAmount = (value: string | number | undefined): string => {
    if (value === undefined || value === null || value === '') return '';
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(normalizePenaltyAmount(value));
};

const normalizeEvidenceUrl = (value: string): string | null => {
    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
};

const MAX_EVIDENCE_IMAGE_BYTES = 200 * 1024;

const compressEvidenceImage = async (file: File): Promise<File> => {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Không thể đọc ảnh.'));
            element.src = sourceUrl;
        });
        let width = Math.min(image.naturalWidth, 1600);
        let height = Math.round(image.naturalHeight * (width / image.naturalWidth));

        for (let quality = 0.82; quality >= 0.35; quality -= 0.08) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
            if (blob && (blob.size <= MAX_EVIDENCE_IMAGE_BYTES || quality <= 0.35)) {
                return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
            }
            width = Math.max(640, Math.round(width * 0.82));
            height = Math.max(480, Math.round(height * 0.82));
        }
        throw new Error('Không thể nén ảnh xuống 200 KB. Hãy chọn ảnh khác.');
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
};

// Default categories (dùng khi DB chưa có dữ liệu)

const CATEGORIES = [
    { key: 'Sàn TMDT', icon: '🛒', color: '#1890ff', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    { key: 'Kho hàng', icon: '📦', color: '#52c41a', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
    { key: 'Chăm sóc KH', icon: '💬', color: '#eb2f96', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
    { key: 'Vệ sinh', icon: '🧹', color: '#722ed1', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
    { key: 'Báo cáo', icon: '📊', color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' }
];

const GRADIENT_PRESETS = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Purple
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', // Pink
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', // Blue
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', // Green
    'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', // Orange
    'linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)', // Sunset
    'linear-gradient(135deg, #3a7bd5 0%, #00d2ff 100%)', // Ocean
    'linear-gradient(135deg, #0ba360 0%, #3cba92 100%)', // Forest
    'linear-gradient(135deg, #fc466b 0%, #3f5efb 100%)', // Fire
    'linear-gradient(135deg, #fdbb2d 0%, #22c1c3 100%)', // Tropical
];

const DailyTasks = () => {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [tasks, setTasks] = useState<Task[]>([]);
    const [categories, setCategories] = useState(CATEGORIES);
    const [editingCategory, setEditingCategory] = useState<any>(null);
    const [categoryModalVisible, setCategoryModalVisible] = useState(false);
    const [categoryForm] = Form.useForm();

    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [taskModalVisible, setTaskModalVisible] = useState(false);
    const [taskForm] = Form.useForm();
    const [assigneeFixed, setAssigneeFixed] = useState(false);
    const [loading, setLoading] = useState(false);

    // Quick note state for assignment cards
    const [quickNotes, setQuickNotes] = useState<Record<number, string>>({});
    const [showNoteInput, setShowNoteInput] = useState<Record<number, boolean>>({});

    // Assignee management
    const [assigneeList, setAssigneeList] = useState<string[]>([]);
    const [newAssigneeName, setNewAssigneeName] = useState('');
    const [showAddAssignee, setShowAddAssignee] = useState(false);

    // Load assignee list + categories from database on mount
    useEffect(() => {
        (async () => {
            try {
                // Load assignee list
                const usersResult = await window.electronAPI.users.getAll();
                if (usersResult.success && usersResult.data) {
                    const usernames = usersResult.data
                        .filter((u: any) => u?.username && u.username !== 'admin' && u.isActive !== false)
                        .map((u: any) => String(u.username).trim())
                        .filter(Boolean)
                        .sort((a: string, b: string) => a.localeCompare(b, 'vi'));
                    setAssigneeList(usernames);
                } else {
                    const defaults = ['Khánh', 'Toàn', 'Phượng'];
                    setAssigneeList([]);
                    
                }

                // Load categories from DB
                const catResult = await window.electronAPI.appConfig.get('dailyTasksCategories');
                if (catResult.success && catResult.data) {
                    setCategories(catResult.data);
                } else {
                    // Lưu default categories vào DB lần đầu
                    await window.electronAPI.appConfig.set('dailyTasksCategories', CATEGORIES);
                }
            } catch (error) {
                console.error('Error loading config:', error);
            }
        })();
    }, []);

    const saveAssigneeList = async (_list: string[]) => {
        const usersResult = await window.electronAPI.users.getAll();
        if (usersResult.success && usersResult.data) {
            const usernames = usersResult.data
                .filter((u: any) => u?.username && u.username !== 'admin' && u.isActive !== false)
                .map((u: any) => String(u.username).trim())
                .filter(Boolean)
                .sort((a: string, b: string) => a.localeCompare(b, 'vi'));
            setAssigneeList(usernames);
        }
    };

    const saveCategories = async (cats: typeof CATEGORIES) => {
        setCategories(cats);
        await window.electronAPI.appConfig.set('dailyTasksCategories', cats);
    };

    // History state
    const [activeTab, setActiveTab] = useState<'tasks' | 'assignments' | 'history'>('tasks');
    const [boardFilter, setBoardFilter] = useState<'all' | 'action' | 'evidence' | 'overdue'>('all');
    const [history, setHistory] = useState<any[]>([]);

    // === ASSIGNMENT TASKS ===
    const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
    const [editingAssignment, setEditingAssignment] = useState<Task | null>(null);
    const [assignmentForm] = Form.useForm();
    const [, forceUpdate] = useState(0); // for countdown re-render
    const [alertPopups, setAlertPopups] = useState<AlertPopupItem[]>([]);

    const addAlertPopup = useCallback((item: Omit<AlertPopupItem, 'id'>) => {
        const id = `alert-${Date.now()}-${Math.random()}`;
        setAlertPopups(prev => {
            // Không thêm trùng key cho cùng task + level
            const key = `${item.taskName}-${item.level}`;
            if (prev.some(p => `${p.taskName}-${p.level}` === key)) return prev;
            return [...prev, { ...item, id }];
        });
    }, []);

    const dismissAlertPopup = useCallback((id: string) => {
        setAlertPopups(prev => prev.filter(p => p.id !== id));
    }, []);

    // Load tasks from backend
    useEffect(() => {
        (async () => {
            // 🔄 Reset daily tasks nếu sang ngày mới
            try {
                const resetResult = await window.electronAPI.dailyTasks.resetDaily();
                if (resetResult.success && resetResult.data?.reset) {
                    message.info({
                        content: `🔄 Sang ngày mới! Đã reset ${resetResult.data.resetCount} công việc về chưa hoàn thành.`,
                        duration: 4
                    });
                }
            } catch (err) {
                console.log('Daily reset skipped:', err);
            }

            // Load data
            loadTasks();
            loadHistory();
        })();
    }, []);

    const loadTasks = async () => {
        try {
            setLoading(true);
            const [result, penaltiesResult] = await Promise.all([
                window.electronAPI.dailyTasks.list({}),
                window.electronAPI.dailyTasks.listEvidencePenalties(),
            ]);
            if (result.success && result.data) {
                const penaltyKeys = new Set(
                    (penaltiesResult?.success && Array.isArray(penaltiesResult.data) ? penaltiesResult.data : [])
                        .map((penalty: any) => `${penalty.taskId}:${penalty.dueAt}`)
                );
                setTasks(result.data.map((t: any) => ({
                    ...t,
                    evidencePenaltyRecorded: penaltyKeys.has(`${t.id}:${new Date(t.dueDate).toISOString()}`),
                    tags: t.tags ? JSON.parse(t.tags) : [],
                    attachments: parseAttachments(t.attachments),
                    dueTime: dayjs(t.dueDate).format('HH:mm'),
                    dueDate: dayjs(t.dueDate).format('YYYY-MM-DD'),
                    type: t.type || 'daily'
                })));
            } else if (!result.success) {
                message.error('Lỗi tải công việc: ' + (result.error || 'Không xác định'));
            }
        } catch (error: any) {
            message.error('Lỗi khi tải dữ liệu: ' + (error.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    // === ASSIGNMENT DEADLINE LOGIC ===
    const getDeadlineStatus = (task: Task) => {
        if (task.status === 'completed') return { status: 'done', color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f', label: '✅ Hoàn thành', icon: '✅' };
        const now = dayjs();
        const deadline = dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm');
        const diffMinutes = deadline.diff(now, 'minute');
        if (diffMinutes < 0) return { status: 'overdue', color: '#ff4d4f', bg: '#fff2f0', border: '#ffa39e', label: `⛔ Quá hạn ${formatTimeDiff(Math.abs(diffMinutes))}`, icon: '🔴' };
        if (diffMinutes <= 60) return { status: 'warning', color: '#fa8c16', bg: '#fff7e6', border: '#ffd591', label: `⚠️ Còn ${formatTimeDiff(diffMinutes)}`, icon: '🟡' };
        return { status: 'normal', color: '#1890ff', bg: '#e6f7ff', border: '#91d5ff', label: `🕐 Còn ${formatTimeDiff(diffMinutes)}`, icon: '🟢' };
    };

    const formatTimeDiff = (minutes: number) => {
        if (minutes < 60) return `${minutes} phút`;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h < 24) return m > 0 ? `${h}h ${m}p` : `${h} giờ`;
        const d = Math.floor(h / 24);
        return `${d} ngày ${h % 24}h`;
    };

    // === AUDIO ALERT SYSTEM (ESCALATING) ===
    const [acknowledgedTasks, setAcknowledgedTasks] = useState<Set<number>>(() => new Set());
    const lastOverdueAlertRef = useState<Map<number, number>>(() => new Map())[0];

    // === AUDIO ALERT SYSTEM ===
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

    // Còi hú 2 tần số xen kẽ - dùng khi quá hạn
    const playSiren = (cycles: number) => {
        try {
            for (let i = 0; i < cycles; i++) {
                setTimeout(() => new Audio(generateBeepWav(880, 220, 0.8, 'square')).play().catch(() => { }), i * 440);
                setTimeout(() => new Audio(generateBeepWav(1200, 220, 0.8, 'square')).play().catch(() => { }), i * 440 + 220);
            }
        } catch { }
    };

    // Beep nhanh liên tiếp - dùng khi khẩn cấp ≤10p
    const playUrgentBeeps = (count: number) => {
        try {
            for (let i = 0; i < count; i++) {
                setTimeout(() => new Audio(generateBeepWav(1100, 120, 0.75, 'square')).play().catch(() => { }), i * 180);
            }
        } catch { }
    };

    // Beep thường - dùng khi còn 10-30p
    const playWarningBeeps = (count: number) => {
        try {
            for (let i = 0; i < count; i++) {
                setTimeout(() => new Audio(generateBeepWav(880, 200, 0.6, 'sine')).play().catch(() => { }), i * 350);
            }
        } catch { }
    };

    // Beep nhẹ - dùng khi còn 30-60p
    const playInfoBeep = () => {
        try {
            new Audio(generateBeepWav(660, 300, 0.45, 'sine')).play().catch(() => { });
        } catch { }
    };

    // Xác nhận "Đang làm" - dừng kêu cho task ≤10p
    const handleAcknowledgeTask = (taskId: number) => {
        setAcknowledgedTasks(prev => {
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
        // Thông báo GlobalTaskAlerts dừng kêu
        window.dispatchEvent(new CustomEvent('task-acknowledged', { detail: { taskId } }));
        message.success({ content: '✅ Đã xác nhận đang làm!', duration: 2 });
    };

    // Countdown timer - update every 30 seconds (UI + popup alerts)
    useEffect(() => {
        const interval = setInterval(() => {
            forceUpdate(v => v + 1);

            const pendingAssignments = tasks.filter(t => t.type === 'assignment' && t.status !== 'completed');
            const now = dayjs();

            pendingAssignments.forEach(task => {
                const deadline = dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm');
                const diffMinutes = deadline.diff(now, 'minute');

                // === QUÁ HẠN ===
                if (diffMinutes < 0) {
                    const overdueMin = Math.abs(diffMinutes);
                    if (overdueMin >= 1440) return; // quá 24h → bỏ qua

                    const alreadyAlerted = lastOverdueAlertRef.get(task.id);
                    if (!alreadyAlerted && overdueMin >= 10) {
                        lastOverdueAlertRef.set(task.id, Date.now());
                        playSiren(6); // còi hú 6 chu kỳ
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

                // === CÒN ≤ 10 PHÚT ===
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

                // === CÒN 10-20 PHÚT ===
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

                // === CÒN 20-30 PHÚT ===
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

                // === CÒN 30-60 PHÚT ===
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

    // === CONTINUOUS ALARM: còi hú + beep liên tục mỗi 5 giây khi ≤ 10 phút ===
    useEffect(() => {
        const alarmInterval = setInterval(() => {
            const now = dayjs();
            const urgentTasks = tasks.filter(t => {
                if (t.type !== 'assignment' || t.status === 'completed') return false;
                if (acknowledgedTasks.has(t.id)) return false;
                const deadline = dayjs(`${t.dueDate} ${t.dueTime}`, 'YYYY-MM-DD HH:mm');
                const diff = deadline.diff(now, 'minute');
                return diff >= 0 && diff <= 10;
            });
            if (urgentTasks.length > 0) playUrgentBeeps(5);
        }, 5000);
        return () => clearInterval(alarmInterval);
    }, [tasks, acknowledgedTasks]);

    // Request notification permission on mount
    useEffect(() => {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Assignment task handlers
    const handleAddAssignment = () => {
        setEditingAssignment(null);
        assignmentForm.resetFields();
        assignmentForm.setFieldsValue({
            priority: 'normal',
            deadline: dayjs().add(2, 'hour'),
        });
        setAssignmentModalVisible(true);
    };

    const handleEditAssignment = (task: Task) => {
        setEditingAssignment(task);
        assignmentForm.setFieldsValue({
            title: task.title,
            description: task.description,
            assignee: task.assignee,
            priority: task.priority,
            deadline: dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm'),
            note: task.note || '',
        });
        setAssignmentModalVisible(true);
    };

    const handleSaveAssignment = async () => {
        try {
            const values = await assignmentForm.validateFields();
            const taskData: any = {
                title: values.title,
                description: values.description || '',
                assignee: values.assignee,
                priority: values.priority,
                dueDate: values.deadline.toISOString(),
                type: 'assignment',
                category: 'Bàn giao',
                note: values.note || '',
            };
            // Khi tạo mới: set pending. Khi edit: giữ nguyên status hiện tại
            if (!editingAssignment) {
                taskData.status = 'pending';
            }

            let result;
            if (editingAssignment) {
                result = await window.electronAPI.dailyTasks.update(editingAssignment.id, taskData);
                message.success('Đã cập nhật!');
            } else {
                result = await window.electronAPI.dailyTasks.create(taskData);
                message.success('Đã tạo công việc bàn giao!');
            }
            if (result.success) {
                setAssignmentModalVisible(false);
                assignmentForm.resetFields();
                setEditingAssignment(null);
                loadTasks();
            }
        } catch (error: any) {
            message.error('Lỗi: ' + (error.message || ''));
        }
    };

    const handleCompleteAssignment = async (taskId: number) => {
        try {
            await window.electronAPI.dailyTasks.update(taskId, { status: 'completed' });
            message.success('✅ Đã hoàn thành!');
            window.dispatchEvent(new CustomEvent('task-changed'));
            loadTasks();
        } catch (e: any) {
            message.error('Lỗi: ' + e.message);
        }
    };

    const handleDeleteAssignment = (taskId: number) => {
        Modal.confirm({
            title: 'Xóa công việc bàn giao?',
            content: 'Bạn có chắc muốn xóa?',
            okText: 'Xóa', okType: 'danger', cancelText: 'Hủy',
            onOk: async () => {
                await window.electronAPI.dailyTasks.delete(taskId);
                message.success('Đã xóa!');
                window.dispatchEvent(new CustomEvent('task-changed'));
                loadTasks();
            }
        });
    };

    // Quick note for assignment
    const handleNoteAssignment = (task: Task) => {
        let noteValue = '';
        Modal.confirm({
            title: '✏️ Thêm ghi chú',
            icon: null,
            width: 480,
            content: (
                <div>
                    <p style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
                        <strong>{task.title}</strong> — {task.assignee}
                    </p>
                    <TextArea
                        rows={4}
                        placeholder="Nhập ghi chú tiến độ, lý do chưa xong..."
                        onChange={e => { noteValue = e.target.value; }}
                        style={{ fontSize: 14 }}
                        autoFocus
                    />
                </div>
            ),
            okText: 'Lưu ghi chú',
            cancelText: 'Hủy',
            onOk: async () => {
                if (!noteValue.trim()) {
                    message.warning('Vui lòng nhập nội dung ghi chú!');
                    return Promise.reject();
                }
                try {
                    const existing = parseNotes(task.note);
                    const newLog: ProcessLog = {
                        timestamp: dayjs().format('DD/MM HH[h]mm'),
                        note: noteValue.trim()
                    };
                    await window.electronAPI.dailyTasks.update(task.id, {
                        note: JSON.stringify([...existing, newLog])
                    });
                    message.success('Đã lưu ghi chú!');
                    loadTasks();
                } catch (e: any) {
                    message.error('Lỗi: ' + e.message);
                }
            }
        });
    };

    const handleQuickAddNote = async (task: Task) => {
        const noteText = (quickNotes[task.id] || '').trim();
        if (!noteText) {
            message.warning('Vui lòng nhập nội dung ghi chú!');
            return;
        }
        try {
            const existing = parseNotes(task.note);
            const newLog: ProcessLog = {
                timestamp: dayjs().format('DD/MM HH[h]mm'),
                note: noteText
            };
            await window.electronAPI.dailyTasks.update(task.id, {
                note: JSON.stringify([...existing, newLog])
            });
            message.success('Đã thêm ghi chú!');
            setQuickNotes(prev => ({ ...prev, [task.id]: '' }));
            setShowNoteInput(prev => ({ ...prev, [task.id]: false }));
            loadTasks();
        } catch (e: any) {
            message.error('Lỗi: ' + e.message);
        }
    };

    // Filter tasks by type
    const dailyTasks = tasks.filter(t => !t.type || t.type === 'daily');
    const assignmentTasks = tasks.filter(t => t.type === 'assignment');
    const pendingAssignments = assignmentTasks.filter(t => t.status !== 'completed');
    const overdueAssignments = assignmentTasks.filter(t => getDeadlineStatus(t).status === 'overdue');

    const loadHistory = async () => {
        try {
            const result = await window.electronAPI.appConfig.get('dailyTasksHistory');
            if (result.success && result.data) {
                setHistory(result.data);
            }
        } catch (error) {
            console.error('Error loading history:', error);
        }
    };

    const addToHistory = async (task: Task, action: string) => {
        try {
            const historyEntry = {
                taskId: task.id,
                taskTitle: task.title,
                category: task.category,
                assignee: task.assignee,
                verifier: task.verifier || '',
                action,
                timestamp: new Date().toISOString(),
                description: `${action === 'completed' ? 'Đã hoàn thành' : 'Đã hủy hoàn thành'} công việc: "${task.title}"`
            };

            // Save to database via appConfig
            const newHistory = [historyEntry, ...history];
            await window.electronAPI.appConfig.set('dailyTasksHistory', newHistory);
            setHistory(newHistory);
        } catch (error) {
            console.error('Error adding to history:', error);
        }
    };

    const handleToggleComplete = (taskId: number) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        if (task.status === 'pending' && getEvidence(task).required) {
            handleSubmitEvidence(task);
            return;
        }

        const isCompleting = task.status === 'pending';

        // Nếu đang hoàn thành, yêu cầu chọn người xác nhận
        if (isCompleting) {
            // Khởi tạo với người xác nhận cũ nếu có, nếu không thì empty
            let selectedVerifier = task.verifier || '';
            let selectedAssignee = task.assignee || '';
            const needAssignee = !task.assignee; // Chưa ai nhận việc → cần chọn khi hoàn thành

            Modal.confirm({
                title: '✅ Xác nhận hoàn thành?',
                content: (
                    <div>
                        <p style={{ marginBottom: 8 }}>
                            <strong>{task.title}</strong>
                        </p>
                        <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
                            Bạn có chắc chắn đã hoàn thành công việc này không?
                        </p>

                        {/* Nếu chưa có assignee → cho chọn */}
                        {needAssignee ? (
                            <div style={{ marginBottom: 12 }}>
                                <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#262626' }}>
                                    👤 Người thực hiện: <span style={{ color: '#ff4d4f' }}>*</span>
                                </label>
                                <Select
                                    placeholder="Chọn người đã thực hiện"
                                    style={{ width: '100%' }}
                                    size="large"
                                    virtual={false}
                                    onChange={(value) => { selectedAssignee = value; }}
                                >
                                    {assigneeList.map((name, index) => {
                                        const colors = ['#1890ff', '#52c41a', '#eb2f96', '#722ed1', '#fa8c16', '#13c2c2'];
                                        const color = colors[index % colors.length];
                                        return (
                                            <Option key={name} value={name}>
                                                <Avatar size="small" style={{ backgroundColor: color, marginRight: 8 }}>
                                                    {name[0]}
                                                </Avatar>
                                                {name}
                                            </Option>
                                        );
                                    })}
                                </Select>
                            </div>
                        ) : (
                            <p style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>
                                Người thực hiện: <strong>{task.assignee}</strong>
                            </p>
                        )}

                        {/* Người xác nhận - BẮT BUỘC */}
                        <div style={{ marginTop: 16 }}>
                            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, color: '#262626' }}>
                                ✓ Người xác nhận: <span style={{ color: '#ff4d4f' }}>*</span>
                            </label>
                            <Select
                                placeholder="Chọn người xác nhận"
                                style={{ width: '100%' }}
                                size="large"
                                virtual={false}
                                onChange={(value) => { selectedVerifier = value; }}
                                defaultValue={task.verifier || undefined}
                            >
                                {assigneeList.map((name, index) => {
                                    const colors = ['#1890ff', '#52c41a', '#eb2f96', '#722ed1', '#fa8c16', '#13c2c2'];
                                    const color = colors[index % colors.length];

                                    return (
                                        <Option key={name} value={name}>
                                            <Avatar size="small" style={{ backgroundColor: color, marginRight: 8 }}>
                                                {name[0]}
                                            </Avatar>
                                            {name}
                                        </Option>
                                    );
                                })}
                            </Select>
                        </div>
                    </div>
                ),
                icon: <CheckCircleFilled style={{ color: '#52c41a' }} />,
                okText: 'Xác nhận hoàn thành',
                okType: 'primary',
                cancelText: 'Đóng',
                width: 500,
                onOk: async () => {
                    // Validate verifier
                    if (!selectedVerifier) {
                        message.error('⚠️ Vui lòng chọn người xác nhận!');
                        return Promise.reject();
                    }
                    // Validate assignee nếu chưa có
                    if (needAssignee && isAdmin && !selectedAssignee) {
                        message.error('⚠️ Vui lòng chọn người thực hiện!');
                        return Promise.reject();
                    }

                    try {
                        const result = await window.electronAPI.dailyTasks.completeRegularTask(taskId, {
                            verifier: selectedVerifier,
                            assignee: selectedAssignee || task.assignee,
                        });
                        if (!result.success || !result.data) throw new Error(result.error || 'Không thể xác nhận công việc.');
                        const finalAssignee = result.data.assignee;
                        const finalVerifier = result.data.verifier;
                        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...result.data, attachments: parseAttachments(result.data.attachments) } : t));

                        // Add to history
                        await addToHistory({ ...task, assignee: finalAssignee, verifier: finalVerifier }, 'completed');

                        // Show success message
                        message.success({
                            content: `✅ Đã xác nhận hoàn thành! (Thực hiện: ${finalAssignee}, Xác nhận: ${finalVerifier})`,
                            duration: 3
                        });
                    } catch (error: any) {
                        message.error('Lỗi: ' + (error.message || 'Unknown error'));
                    }
                }
            });
        } else {
            if (!isAdmin) {
                message.warning('Chỉ admin mới có thể mở lại công việc đã xác nhận.');
                return;
            }
            // Hủy hoàn thành - không cần người xác nhận
            Modal.confirm({
                title: '⚠️ Hủy hoàn thành?',
                content: (
                    <div>
                        <p style={{ marginBottom: 8 }}>
                            <strong>{task.title}</strong>
                        </p>
                        <p style={{ color: '#666', fontSize: 13 }}>
                            Bạn muốn đánh dấu lại công việc này là chưa hoàn thành?
                        </p>
                        <p style={{ color: '#999', fontSize: 12, marginTop: 12, marginBottom: 0 }}>
                            Người thực hiện: <strong>{task.assignee}</strong>
                        </p>
                    </div>
                ),
                icon: <WarningOutlined style={{ color: '#faad14' }} />,
                okText: 'Hủy hoàn thành',
                okType: 'default',
                cancelText: 'Đóng',
                onOk: async () => {
                    try {
                        // Update status
                        setTasks(prev => prev.map(t =>
                            t.id === taskId
                                ? { ...t, status: 'pending' }
                                : t
                        ));

                        // Add to history
                        await addToHistory(task, 'pending');

                        // Show success message
                        message.success({
                            content: '⚠️ Đã hủy hoàn thành!',
                            duration: 2
                        });

                        // Update backend if API exists
                        try {
                            await window.electronAPI.dailyTasks.update(taskId, { status: 'pending' });
                        } catch (err) {
                            console.log('Backend update skipped:', err);
                        }
                    } catch (error: any) {
                        message.error('Lỗi: ' + (error.message || 'Unknown error'));
                    }
                }
            });
        }
    };

    // Edit category
    const handleEditCategory = (category: any) => {
        setEditingCategory(category);
        categoryForm.setFieldsValue(category);
        setCategoryModalVisible(true);
    };

    // Delete category
    const handleDeleteCategory = (categoryKey: string) => {
        if (categoryKey === '__orphan__') {
            const categoryKeys = categories.map(c => c.key);
            const orphanTasks = dailyTasks.filter(t => !t.category || !categoryKeys.includes(t.category));

            Modal.confirm({
                title: 'Xóa cột Khác?',
                content: `Cột "Khác" là cột tự động gom các công việc không còn thuộc danh mục nào. Bạn có chắc muốn xóa ${orphanTasks.length} công việc trong cột này?`,
                okText: 'Xóa',
                okType: 'danger',
                cancelText: 'Hủy',
                onOk: async () => {
                    try {
                        for (const task of orphanTasks) {
                            await window.electronAPI.dailyTasks.delete(task.id);
                        }
                        await loadTasks();
                        message.success(`Đã xóa ${orphanTasks.length} công việc trong cột "Khác"!`);
                    } catch (error: any) {
                        message.error('Lỗi khi xóa: ' + (error.message || 'Unknown'));
                    }
                }
            });
            return;
        }

        const tasksInCategory = dailyTasks.filter(t => t.category === categoryKey);
        Modal.confirm({
            title: 'Xóa danh mục?',
            content: `Bạn có chắc muốn xóa danh mục "${categoryKey}"? ${tasksInCategory.length > 0 ? `⚠️ ${tasksInCategory.length} công việc trong danh mục này cũng sẽ bị xóa!` : 'Danh mục này đang trống.'}`,
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    // Xóa tất cả tasks trong danh mục này trên DATABASE
                    for (const task of tasksInCategory) {
                        await window.electronAPI.dailyTasks.delete(task.id);
                    }
                    // Xóa danh mục khỏi config
                    const updated = categories.filter(c => c.key !== categoryKey);
                    await saveCategories(updated);
                    // Reload tasks từ DB để đồng bộ
                    await loadTasks();
                    message.success(`Đã xóa danh mục "${categoryKey}" và ${tasksInCategory.length} công việc!`);
                } catch (error: any) {
                    message.error('Lỗi khi xóa: ' + (error.message || 'Unknown'));
                }
            }
        });
    };

    // Add task
    const handleAddTask = (categoryKey?: string) => {
        setEditingTask(null);
        setAssigneeFixed(false);
        taskForm.resetFields();

        // ⚡ Set data TRƯỚC
        taskForm.setFieldsValue({
            priority: 'normal',
            category: categoryKey || categories[0]?.key || 'Sàn TMDT',
            status: 'pending',
            evidenceRequired: false,
            evidenceMethod: 'link',
            assigneeFixed: false,
            penaltyAmount: DEFAULT_EVIDENCE_PENALTY,
            evidenceDeadlineTime: '19:00',
            dueDate: dayjs().hour(20).minute(0).second(0) // Default 20:00 hôm nay
        });

        // ✅ Mở modal SAU
        setTaskModalVisible(true);
    };

    // Edit task
    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        setAssigneeFixed(Boolean(task.assignee));
        taskForm.setFieldsValue({
            ...task,
            dueDate: dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm'),
            tags: task.tags ? task.tags.join(', ') : '',
            evidenceRequired: getEvidence(task).required || false,
            evidenceMethod: getEvidence(task).method || 'link',
            assigneeFixed: Boolean(task.assignee),
            penaltyAmount: normalizePenaltyAmount(getEvidence(task).penaltyAmount),
            evidenceDeadlineTime: task.dueTime,
        });
        setTaskModalVisible(true);
    };

    // Delete task
    const handleDeleteTask = (taskId: number) => {
        Modal.confirm({
            title: 'Xóa công việc?',
            content: 'Bạn có chắc muốn xóa công việc này?',
            okText: 'Xóa',
            okType: 'danger',
            cancelText: 'Hủy',
            onOk: async () => {
                try {
                    const result = await window.electronAPI.dailyTasks.delete(taskId);
                    if (result.success) {
                        message.success('Đã xóa!');
                        loadTasks();
                    }
                } catch (error: any) {
                    message.error('Lỗi: ' + (error.message || 'Unknown error'));
                }
            }
        });
    };

    // Nhận việc (Claim task)
    const handleClaimTask = async (taskId: number, claimerName?: string) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        // Nếu task đã có assignee → không cho claim
        if (task.assignee) {
            message.info(`Công việc này đã được gán cho ${task.assignee}`);
            return;
        }

        // Nếu có claimerName (từ dropdown) → dùng luôn
        if (claimerName) {
            try {
                await window.electronAPI.dailyTasks.update(taskId, { assignee: claimerName });
                message.success(`✅ ${claimerName} đã nhận việc: "${task.title}"`);
                loadTasks();
            } catch (e: any) {
                message.error('Lỗi: ' + e.message);
            }
            return;
        }

        // Hiển thị modal chọn người nhận việc
        let selectedPerson = '';
        Modal.confirm({
            title: '🙋 Nhận việc',
            icon: null,
            width: 420,
            content: (
                <div>
                    <p style={{ marginBottom: 8 }}>
                        <strong>{task.title}</strong>
                    </p>
                    <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
                        Chọn người nhận công việc này:
                    </p>
                    <Select
                        placeholder="Chọn người nhận việc"
                        style={{ width: '100%' }}
                        size="large"
                        virtual={false}
                        onChange={(value) => { selectedPerson = value; }}
                    >
                        {assigneeList.map((name, index) => {
                            const colors = ['#1890ff', '#52c41a', '#eb2f96', '#722ed1', '#fa8c16', '#13c2c2'];
                            const color = colors[index % colors.length];
                            return (
                                <Option key={name} value={name}>
                                    <Avatar size="small" style={{ backgroundColor: color, marginRight: 8 }}>
                                        {name[0]}
                                    </Avatar>
                                    {name}
                                </Option>
                            );
                        })}
                    </Select>
                </div>
            ),
            okText: 'Nhận việc',
            okType: 'primary',
            cancelText: 'Hủy',
            onOk: async () => {
                if (!selectedPerson) {
                    message.warning('Vui lòng chọn người nhận việc!');
                    return Promise.reject();
                }
                try {
                    await window.electronAPI.dailyTasks.update(taskId, { assignee: selectedPerson });
                    message.success(`✅ ${selectedPerson} đã nhận việc: "${task.title}"`);
                    loadTasks();
                } catch (e: any) {
                    message.error('Lỗi: ' + e.message);
                }
            }
        });
    };

    // Save task
    const handleSaveTask = async () => {
        try {
            const values = await taskForm.validateFields();

            const existingAttachments = editingTask ? parseAttachments(editingTask.attachments) : {};
            const existingEvidence = editingTask ? getEvidence(editingTask) : {};
            // Only administrators decide how a task is completed and whether a penalty applies.
            const requiresEvidence = isAdmin ? Boolean(values.evidenceRequired) : Boolean(existingEvidence.required);
            if (requiresEvidence && (!values.assigneeFixed || !values.assignee)) {
                message.error('Công việc yêu cầu bằng chứng phải cố định người thực hiện để hệ thống phạt đúng người.');
                return;
            }
            let dueAt = dayjs(values.dueDate);
            if (requiresEvidence && values.evidenceDeadlineTime) {
                const [hour, minute] = String(values.evidenceDeadlineTime).split(':').map(Number);
                dueAt = dueAt.hour(hour).minute(minute).second(0).millisecond(0);
            }
            const taskData = {
                title: values.title,
                description: values.description || '',
                category: values.category,
                assignee: values.assigneeFixed ? values.assignee || '' : '',
                verifier: values.verifier || '',
                area: values.area || '',
                dueDate: dueAt.toISOString(),
                priority: values.priority,
                status: values.status || 'pending',
                tags: values.tags ? JSON.stringify(values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)) : null,
                note: values.note || '',
                attachments: {
                    ...existingAttachments,
                    assignment: {
                        ...(existingAttachments.assignment || {}),
                        fixedAssignee: Boolean(values.assigneeFixed),
                    },
                    evidence: requiresEvidence ? {
                        ...existingEvidence,
                        required: true,
                        method: isAdmin ? values.evidenceMethod || 'link' : existingEvidence.method || 'link',
                        status: existingEvidence.status || 'pending',
                        penaltyAmount: isAdmin
                            ? normalizePenaltyAmount(values.penaltyAmount)
                            : normalizePenaltyAmount(existingEvidence.penaltyAmount),
                    } : undefined,
                }
            };

            let result;
            if (editingTask) {
                result = await window.electronAPI.dailyTasks.update(editingTask.id, taskData);
                message.success('Đã cập nhật task!');
            } else {
                result = await window.electronAPI.dailyTasks.create(taskData);
                message.success('Đã thêm task mới!');
            }

            if (result.success) {
                setTaskModalVisible(false);
                taskForm.resetFields();
                setEditingTask(null);
                loadTasks();
            }
        } catch (error: any) {
            message.error('Lỗi: ' + (error.message || 'Unknown error'));
        }
    };

    // Save category
    const handleSaveCategory = async () => {
        try {
            const values = await categoryForm.validateFields();

            if (editingCategory) {
                // Update existing
                const updated = categories.map(c =>
                    c.key === editingCategory.key ? { ...c, ...values } : c
                );
                await saveCategories(updated);
                // Update tasks
                if (values.key !== editingCategory.key) {
                    setTasks(prev => prev.map(task =>
                        task.category === editingCategory.key ? { ...task, category: values.key } : task
                    ));
                }
                message.success('Đã cập nhật danh mục!');
            } else {
                // Add new
                const updated = [...categories, values];
                await saveCategories(updated);
                message.success('Đã thêm danh mục mới!');
            }

            setCategoryModalVisible(false);
            categoryForm.resetFields();
            setEditingCategory(null);
        } catch (error) {
            console.error('Validation error:', error);
        }
    };

    const getPriorityConfig = (priority: string) => {
        const config: any = {
            urgent: {
                color: '#ff4d4f',
                bgGradient: 'linear-gradient(135deg, #fff1f0 0%, #ffe7e7 50%, #fff1f0 100%)',
                borderColor: '#ff4d4f',
                icon: '🔥',
                label: 'KHẨN CẤP',
                shadow: '0 6px 16px rgba(255, 77, 79, 0.25)'
            },
            high: {
                color: '#fa8c16',
                bgGradient: 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 50%, #fff7e6 100%)',
                borderColor: '#fa8c16',
                icon: '⚡',
                label: 'CAO',
                shadow: '0 6px 16px rgba(250, 140, 22, 0.2)'
            },
            normal: {
                color: '#1890ff',
                bgGradient: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 50%, #e6f7ff 100%)',
                borderColor: '#91d5ff',
                icon: '📋',
                label: 'BÌNH THƯỜNG',
                shadow: '0 6px 16px rgba(24, 144, 255, 0.15)'
            },
            low: {
                color: '#8c8c8c',
                bgGradient: 'linear-gradient(135deg, #fafafa 0%, #f0f0f0 50%, #fafafa 100%)',
                borderColor: '#d9d9d9',
                icon: '💤',
                label: 'THẤP',
                shadow: '0 4px 12px rgba(0, 0, 0, 0.06)'
            }
        };
        return config[priority] || config.normal;
    };

    const getAvatarColor = (name: string) => {
        const colors: any = {
            'Khánh': '#1890ff',
            'Toàn': '#52c41a',
            'Phượng': '#eb2f96'
        };
        return colors[name] || '#722ed1';
    };

    const isOverdue = (task: Task) => {
        if (task.status === 'completed') return false;
        const [hour, minute] = task.dueTime.split(':').map(Number);
        const dueTime = dayjs(task.dueDate).hour(hour).minute(minute).second(0).millisecond(0);
        return dayjs().isAfter(dueTime);
    };

    const CompletionButton = ({ task, size = 22 }: { task: Task; size?: number }) => {
        const isCompleted = task.status === 'completed';

        return (
            <button
                type="button"
                className="daily-task-completion-button"
                aria-label={isCompleted ? `Mở lại công việc ${task.title}` : `Xác nhận hoàn thành công việc ${task.title}`}
                title={isCompleted ? 'Mở lại công việc' : 'Xác nhận hoàn thành'}
                onClick={(event) => {
                    event.stopPropagation();
                    handleToggleComplete(task.id);
                }}
            >
                {isCompleted
                    ? <CheckCircleFilled style={{ fontSize: size, color: '#52c41a' }} />
                    : <CheckCircleOutlined style={{ fontSize: size, color: '#64748b' }} />}
            </button>
        );
    };

    const updateEvidence = async (task: Task, evidence: EvidenceMeta) => {
        const attachments = { ...parseAttachments(task.attachments), evidence };
        const result = await window.electronAPI.dailyTasks.update(task.id, { attachments });
        if (!result.success) throw new Error(result.error || 'Không thể cập nhật bằng chứng');
        await loadTasks();
    };

    /* const handleSubmitEvidence = (task: Task) => {
        let submittedUrl = getEvidence(task).submittedUrl || '';
        Modal.confirm({
            title: 'Nộp bằng chứng',
            icon: <UploadOutlined style={{ color: '#16a34a' }} />,
            content: (
                <div>
                    <p style={{ marginBottom: 12, color: '#475569' }}>
                        <strong>{task.title}</strong>
                    </p>
                    <Input
                        type="url"
                        defaultValue={submittedUrl}
                        placeholder="Dán link TikTok, Drive hoặc bằng chứng công việc"
                        onChange={(event) => { submittedUrl = event.target.value; }}
                    />
                </div>
            ),
            okText: 'Gửi bằng chứng',
            cancelText: 'Hủy',
            onOk: async () => {
                const normalizedUrl = normalizeEvidenceUrl(submittedUrl);
                if (!normalizedUrl) {
                    message.warning('Bằng chứng phải là link http:// hoặc https:// hợp lệ.');
                    return Promise.reject();
                }
                const duplicateTask = tasks.find(other =>
                    other.id !== task.id && normalizeEvidenceUrl(getEvidence(other).submittedUrl || '') === normalizedUrl
                );
                if (duplicateTask) {
                    message.warning(`Link này đã được dùng cho công việc "${duplicateTask.title}".`);
                    return Promise.reject();
                }
                try {
                    const evidence = {
                        ...getEvidence(task),
                        status: 'submitted' as const,
                        submittedUrl: normalizedUrl,
                        submittedAt: new Date().toISOString(),
                        submittedBy: user?.fullName || user?.username || 'Nhân viên',
                    };
                    const result = await window.electronAPI.dailyTasks.update(task.id, {
                        attachments: { ...parseAttachments(task.attachments), evidence },
                        status: 'completed',
                    });
                    if (!result.success) throw new Error(result.error || 'Không thể lưu bằng chứng');
                    await loadTasks();
                    message.success('Đã nộp bằng chứng và hoàn thành công việc.');
                } catch (error: any) {
                    message.error(error.message || 'Không thể gửi bằng chứng.');
                }
            }
        });
    }; */

    const handleSubmitEvidence = (task: Task) => {
        const currentEvidence = getEvidence(task);
        const method = currentEvidence.method || 'link';
        const needsLink = method === 'link' || method === 'both';
        const needsImage = method === 'image' || method === 'both';
        let submittedUrl = currentEvidence.submittedUrl || '';
        let selectedImage: File | null = null;

        Modal.confirm({
            title: 'Nộp bằng chứng',
            icon: <UploadOutlined style={{ color: '#16a34a' }} />,
            content: (
                <div>
                    <p style={{ marginBottom: 12, color: '#475569' }}><strong>{task.title}</strong></p>
                    {needsLink && <Input type="url" defaultValue={submittedUrl} placeholder="Dán link bằng chứng hợp lệ" onChange={(event) => { submittedUrl = event.target.value; }} />}
                    {needsImage && <div style={{ marginTop: needsLink ? 12 : 0 }}>
                        <Upload accept="image/png,image/jpeg,image/webp" maxCount={1} beforeUpload={(file) => {
                            selectedImage = file as unknown as File;
                            return false;
                        }}>
                            <Button icon={<UploadOutlined />}>Chọn ảnh từ máy</Button>
                        </Upload>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Chấp nhận JPG, PNG, WebP; tối đa 1 MB trước khi nén.</div>
                    </div>}
                </div>
            ),
            okText: 'Gửi bằng chứng', cancelText: 'Hủy',
            onOk: async () => {
                const normalizedUrl = needsLink ? normalizeEvidenceUrl(submittedUrl) : undefined;
                if (needsLink && !normalizedUrl) {
                    message.warning('Vui lòng nhập link http:// hoặc https:// hợp lệ.');
                    return Promise.reject();
                }
                if (needsImage && !selectedImage) {
                    message.warning('Vui lòng chọn ảnh bằng chứng từ máy.');
                    return Promise.reject();
                }
                if (selectedImage && (selectedImage.size > 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(selectedImage.type))) {
                    message.warning('Ảnh phải là JPG, PNG hoặc WebP và không vượt quá 1 MB trước khi nén.');
                    return Promise.reject();
                }
                try {
                    let image: { name: string; mimeType: string; data: string } | undefined;
                    if (selectedImage) {
                        const compressedImage = await compressEvidenceImage(selectedImage);
                        if (compressedImage.size > MAX_EVIDENCE_IMAGE_BYTES) throw new Error('Ảnh sau nén vượt quá 200 KB.');
                        const data = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result));
                            reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
                            reader.readAsDataURL(compressedImage);
                        });
                        image = { name: compressedImage.name, mimeType: compressedImage.type, data };
                    }
                    const result = await window.electronAPI.dailyTasks.submitEvidence({
                        taskId: task.id,
                        submittedUrl: normalizedUrl,
                        image,
                    });
                    if (!result.success) throw new Error(result.error || 'Không thể lưu bằng chứng');
                    await loadTasks();
                    message.success('Đã nộp bằng chứng và hoàn thành công việc.');
                } catch (error: any) { message.error(error.message || 'Không thể gửi bằng chứng.'); }
            }
        });
    };

    const handleReviewEvidence = async (task: Task, approved: boolean) => {
        try {
            await updateEvidence(task, {
                ...getEvidence(task),
                status: approved ? 'approved' : 'rejected',
                reviewedAt: new Date().toISOString(),
                reviewedBy: user?.fullName || user?.username || 'Quản lý',
            });
            message.success(approved ? 'Đã duyệt bằng chứng.' : 'Đã từ chối bằng chứng.');
        } catch (error: any) {
            message.error(error.message || 'Không thể duyệt bằng chứng.');
        }
    };

    // Task Card - GRADIENT STYLE
    const TaskCard = ({ task }: { task: Task }) => {
        const priorityConfig = getPriorityConfig(task.priority);
        const overdue = isOverdue(task);

        return (
            <div
                className={`gradient-task-card ${task.status === 'completed' ? 'completed' : ''} ${overdue ? 'overdue' : ''}`}
                style={{
                    background: task.status === 'completed' ? '#f5f5f5' : priorityConfig.bgGradient,
                    borderLeft: `5px solid ${priorityConfig.borderColor}`,
                    borderRadius: 12,
                    padding: '16px',
                    marginBottom: 12,
                    boxShadow: task.status === 'completed' ? '0 2px 8px rgba(0,0,0,0.06)' : priorityConfig.shadow,
                    transition: 'all 0.3s ease',
                    opacity: task.status === 'completed' ? 0.7 : 1,
                    position: 'relative',
                    cursor: 'pointer'
                }}
            >
                {/* Priority Badge - Top Right */}
                <div style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: priorityConfig.color,
                    color: '#fff',
                    padding: '3px 10px',
                    borderRadius: 16,
                    fontSize: 11,
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
                }}>
                    <span>{priorityConfig.icon}</span>
                </div>

                {/* Main Content */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
                    <div style={{ marginTop: 1 }}>
                        <CompletionButton task={task} size={22} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                        {/* Title */}
                        <h4 style={{
                            margin: 0,
                            marginBottom: 8,
                            fontSize: 15,
                            fontWeight: 600,
                            color: task.status === 'completed' ? '#999' : '#000',
                            textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                            paddingRight: 80,
                            lineHeight: 1.4
                        }}>
                            {task.title}
                        </h4>

                        {/* Description */}
                        {task.description && (
                            <p style={{
                                margin: 0,
                                marginBottom: 10,
                                fontSize: 12,
                                color: '#666',
                                lineHeight: 1.5
                            }}>
                                {task.description}
                            </p>
                        )}

                        {/* Tags */}
                        {task.tags && task.tags.length > 0 && (
                            <Space size={4} wrap style={{ marginBottom: 10 }}>
                                {task.tags.map(tag => (
                                    <Tag
                                        key={tag}
                                        color="blue"
                                        style={{
                                            borderRadius: 10,
                                            padding: '1px 10px',
                                            fontSize: 11,
                                            margin: 0
                                        }}
                                    >
                                        {tag}
                                    </Tag>
                                ))}
                            </Space>
                        )}

                        {/* Footer: Time + People + Actions */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 12,
                            paddingTop: 10,
                            borderTop: '1px solid rgba(0,0,0,0.06)'
                        }}>
                            {/* Left: Time */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                color: overdue ? '#ff4d4f' : '#666'
                            }}>
                                <ClockCircleOutlined style={{ fontSize: 14 }} />
                                {task.dueTime}
                                {overdue && <WarningOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />}
                            </div>

                            {/* Center: Assignee + Verifier */}
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                {/* Assignee — hoặc nút Nhận việc */}
                                {task.assignee ? (
                                    <Tooltip title={`Người thực hiện: ${task.assignee}`}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 11, color: '#999', fontWeight: 500 }}>👤</span>
                                            <Avatar
                                                size={28}
                                                style={{
                                                    backgroundColor: getAvatarColor(task.assignee),
                                                    fontSize: 12,
                                                    fontWeight: 'bold',
                                                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
                                                }}
                                            >
                                                {task.assignee[0]}
                                            </Avatar>
                                        </div>
                                    </Tooltip>
                                ) : (
                                    task.status !== 'completed' && (
                                        <Tooltip title="Chưa ai nhận — bấm để nhận việc">
                                            <Button
                                                type="dashed"
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleClaimTask(task.id);
                                                }}
                                                style={{
                                                    borderColor: '#faad14',
                                                    color: '#faad14',
                                                    borderRadius: 16,
                                                    fontSize: 11,
                                                    fontWeight: 600,
                                                    padding: '0 10px',
                                                    height: 28,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4
                                                }}
                                            >
                                                🙋 Nhận việc
                                            </Button>
                                        </Tooltip>
                                    )
                                )}

                                {/* Verifier (if exists) */}
                                {task.verifier && (
                                    <Tooltip title={`Người xác nhận: ${task.verifier}`}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 11, color: '#999', fontWeight: 500 }}>✓</span>
                                            <Avatar
                                                size={28}
                                                style={{
                                                    backgroundColor: getAvatarColor(task.verifier),
                                                    fontSize: 12,
                                                    fontWeight: 'bold',
                                                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                                                    border: '2px solid #52c41a'
                                                }}
                                            >
                                                {task.verifier[0]}
                                            </Avatar>
                                        </div>
                                    </Tooltip>
                                )}
                            </div>

                            {/* Right: Action Buttons */}
                            <div style={{ display: 'flex', gap: 4 }}>
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<EditOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditTask(task);
                                    }}
                                    style={{
                                        color: '#1890ff',
                                        width: 28,
                                        height: 28,
                                        padding: 0
                                    }}
                                />
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTask(task.id);
                                    }}
                                    style={{
                                        width: 28,
                                        height: 28,
                                        padding: 0
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Kanban Column - TỐI ĐA 3 CỘT HIỂN THỊ
    const KanbanColumn = ({ category }: { category: typeof CATEGORIES[0] }) => {
        const columnTasks = category.key === '__orphan__'
            ? dailyTasks.filter(t => !t.category || !categories.map(c => c.key).includes(t.category))
            : dailyTasks.filter(t => t.category === category.key);
        const completed = columnTasks.filter(t => t.status === 'completed').length;
        const total = columnTasks.length;
        const isOrphanColumn = category.key === '__orphan__';

        return (
            <div
                className="kanban-column-3"
                style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    padding: 16,
                    minWidth: 'calc(33.333% - 12px)',
                    maxWidth: 'calc(33.333% - 12px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                }}
            >
                {/* Column Header với Gradient */}
                <div style={{
                    background: category.gradient,
                    borderRadius: 10,
                    padding: '12px 16px',
                    marginBottom: 16,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    position: 'relative'
                }}>
                    {/* Category Actions - Top Right */}
                    <div style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        display: 'flex',
                        gap: 4
                    }}>
                        {!isOrphanColumn && <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => handleEditCategory(category)}
                            style={{
                                color: '#fff',
                                width: 24,
                                height: 24,
                                padding: 0,
                                opacity: 0.8
                            }}
                            title="Sửa danh mục"
                        />}
                        <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            onClick={() => handleDeleteCategory(category.key)}
                            style={{
                                color: '#fff',
                                width: 24,
                                height: 24,
                                padding: 0,
                                opacity: 0.8
                            }}
                            title="Xóa danh mục"
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 24 }}>{category.icon}</span>
                        <h3 style={{
                            margin: 0,
                            color: '#fff',
                            fontSize: 17,
                            fontWeight: 'bold',
                            textShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            flex: 1,
                            paddingRight: 50
                        }}>
                            {category.key === '__orphan__' ? 'Khác' : category.key}
                        </h3>
                        <Badge
                            count={total}
                            style={{
                                backgroundColor: 'rgba(255,255,255,0.3)',
                                color: '#fff',
                                fontWeight: 'bold'
                            }}
                        />
                    </div>

                    {/* Progress */}
                    <Progress
                        percent={total > 0 ? Math.round((completed / total) * 100) : 0}
                        size="small"
                        strokeColor="#fff"
                        trailColor="rgba(255,255,255,0.3)"
                        strokeWidth={8}
                        showInfo={false}
                    />
                    <div style={{
                        textAlign: 'right',
                        color: 'rgba(255,255,255,0.95)',
                        fontSize: 12,
                        fontWeight: 'bold',
                        marginTop: 4
                    }}>
                        {completed}/{total}
                    </div>
                </div>

                {/* Task Cards */}
                <div style={{
                    maxHeight: 'calc(100vh - 350px)',
                    overflowY: 'auto',
                    paddingRight: 4
                }}>
                    {columnTasks.length > 0 ? (
                        columnTasks.map(task => (
                            <TaskCard key={task.id} task={task} />
                        ))
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="Chưa có công việc"
                            style={{ padding: '40px 0' }}
                        />
                    )}
                </div>

                {/* Add Button */}
                <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => handleAddTask(category.key)}
                    style={{
                        marginTop: 12,
                        borderRadius: 8,
                        height: 36
                    }}
                >
                    Thêm công việc
                </Button>
            </div>
        );
    };

    // Stats (only daily tasks)
    const totalTasks = dailyTasks.length;
    const completedTasks = dailyTasks.filter(t => t.status === 'completed').length;
    const overdueTasks = dailyTasks.filter(t => isOverdue(t)).length;
    const urgentTasks = dailyTasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length;
    const evidenceTasks = dailyTasks.filter(task => getEvidence(task).required && task.status !== 'completed');
    const evidenceToSubmit = evidenceTasks.filter(task => {
        const evidence = getEvidence(task);
        return evidence.status !== 'submitted' && !isOverdue(task);
    });
    const reviewTasks = evidenceTasks.filter(task => getEvidence(task).status === 'submitted' || isOverdue(task));

    const taskMatchesBoardFilter = (task: Task, lane: 'today' | 'evidence' | 'review') => {
        if (boardFilter === 'all') return true;
        if (boardFilter === 'action') return lane === 'today' && task.status !== 'completed';
        if (boardFilter === 'evidence') return lane === 'evidence';
        return lane === 'review';
    };

    const openEvidence = async (task: Task) => {
        const evidence = getEvidence(task);
        let imageUrl = '';
        if (evidence.submittedImage?.storagePath) {
            const result = await window.electronAPI.dailyTasks.getEvidenceImageUrl(task.id);
            if (!result.success || !result.data?.url) {
                message.error(result.error || 'Không thể tải ảnh bằng chứng.');
                return;
            }
            imageUrl = result.data.url;
        }
        Modal.info({
            title: 'Bằng chứng công việc',
            content: evidence.submittedUrl || imageUrl ? (
                <div>
                    <p style={{ marginBottom: 8 }}><strong>{task.title}</strong></p>
                    {evidence.submittedUrl && <a href={evidence.submittedUrl} target="_blank" rel="noreferrer">{evidence.submittedUrl}</a>}
                    {imageUrl && <img src={imageUrl} alt="Bằng chứng" style={{ display: 'block', maxWidth: '100%', maxHeight: 420, marginTop: evidence.submittedUrl ? 12 : 0, borderRadius: 8 }} />}
                    {evidence.submittedAt && <p style={{ marginTop: 12, color: '#64748b' }}>Đã nộp lúc {dayjs(evidence.submittedAt).format('DD/MM/YYYY HH:mm')}</p>}
                </div>
            ) : 'Nhân viên chưa nộp bằng chứng.',
            okText: 'Đóng',
        });
    };

    const OperationalTaskCard = ({ task, lane }: { task: Task; lane: 'today' | 'evidence' | 'review' }) => {
        const evidence = getEvidence(task);
        const overdue = isOverdue(task);
        const isEvidenceTask = evidence.required;
        const evidenceMethod = evidence.method || 'both';
        const evidenceMethodMeta = evidenceMethod === 'link'
            ? { label: 'Link', icon: <LinkOutlined />, color: '#2563eb' }
            : evidenceMethod === 'image'
                ? { label: 'Ảnh tải lên', icon: <PictureOutlined />, color: '#7c3aed' }
                : { label: 'Link + ảnh', icon: <UploadOutlined />, color: '#0f766e' };
        /*
        const statusText = evidence.status === 'submitted' ? 'Chờ duyệt' : overdue ? `Quá hạn ${formatTimeDiff(Math.abs(dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm').diff(dayjs(), 'minute')))}` : `Hạn ${task.dueTime}`;
        */
        const overdueMinutes = Math.abs(dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm').diff(dayjs(), 'minute'));
        const statusText = evidence.status === 'submitted'
            ? 'Chờ duyệt'
            : overdue
                ? `Quá hạn ${formatTimeDiff(overdueMinutes)}`
                : `Hạn ${task.dueTime}`;
        const penalty = formatPenaltyAmount(evidence.penaltyAmount);
        const penaltyGraceRemaining = Math.max(0, 20 - overdueMinutes);
        const evidencePenaltyText = lane === 'review'
            ? (penaltyGraceRemaining > 0
                ? `Ân hạn còn ${penaltyGraceRemaining} phút để bổ sung`
                : task.evidencePenaltyRecorded
                    ? `Đã ghi nhận phạt ${penalty}đ`
                    : 'Đang ghi nhận phạt...')
            : `Phạt ${penalty}đ nếu không nộp sau 20 phút`;
        const categoryName = String(task.category || '').toLowerCase();
        const categoryColor = categoryName.includes('vệ sinh')
            ? '#059669'
            : categoryName.includes('sàn') || categoryName.includes('tmđt')
                ? '#2563eb'
                : categoryName.includes('bán hàng')
                    ? '#7c3aed'
                    : categoryName.includes('báo cáo')
                        ? '#0891b2'
                        : '#64748b';

        return (
            <div style={{
                background: '#fff',
                border: `1px solid ${lane === 'review' ? '#fecaca' : '#dbe3ec'}`,
                borderLeft: `4px solid ${lane === 'review' ? '#ef4444' : isEvidenceTask ? '#f59e0b' : '#dbe3ec'}`,
                borderRadius: 8,
                padding: '14px 16px',
                marginBottom: 10,
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ marginTop: 2 }}>
                        <CompletionButton task={task} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.45, textDecoration: task.status === 'completed' ? 'line-through' : 'none', color: '#172033' }}>
                                {task.title}
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <Tag style={{ margin: 0, whiteSpace: 'nowrap', color: '#fff', background: categoryColor, borderColor: categoryColor }}>{task.category}</Tag>
                                {isEvidenceTask && <Tag icon={<UploadOutlined />} style={{ margin: 0, whiteSpace: 'nowrap', color: '#fff', background: '#ee4d2d', borderColor: '#ee4d2d', fontWeight: 600 }}>Cần bằng chứng</Tag>}
                                {isEvidenceTask && <Tag icon={evidenceMethodMeta.icon} style={{ margin: 0, whiteSpace: 'nowrap', color: '#fff', background: evidenceMethodMeta.color, borderColor: evidenceMethodMeta.color }}>{evidenceMethodMeta.label}</Tag>}
                            </div>
                        </div>
                        {task.description && <div style={{ color: '#64748b', fontSize: 13, marginTop: 9, lineHeight: 1.55 }}>{task.description}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: task.assignee ? '#475569' : '#94a3b8', fontSize: 13, marginTop: 10 }}>
                            <UserOutlined />
                            <span>{task.assignee ? `Người thực hiện: ${task.assignee}` : 'Chưa cố định người thực hiện'}</span>
                        </div>
                        {task.area && <div style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>{task.area}</div>}
                        {isEvidenceTask ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 11, fontSize: 13 }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: lane === 'review' || overdue ? '#dc2626' : evidence.status === 'submitted' ? '#d97706' : '#475569', fontWeight: 600 }}>
                                    <ClockCircleOutlined /> {statusText}
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: lane === 'review' ? '#dc2626' : '#9a5b13' }}>
                                    <WarningOutlined /> {evidencePenaltyText}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, flexWrap: 'wrap', marginTop: 11, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                                    {evidence.status === 'submitted' && <Button size="small" icon={<EyeOutlined />} onClick={() => openEvidence(task)}>Xem bằng chứng</Button>}
                                    {lane === 'evidence' && <Button size="small" type="primary" icon={<UploadOutlined />} onClick={() => handleSubmitEvidence(task)} style={{ background: '#16a34a', borderColor: '#16a34a' }}>Nộp bằng chứng</Button>}
                                    {lane === 'review' && evidence.status !== 'submitted' && <Button size="small" icon={<UploadOutlined />} onClick={() => handleSubmitEvidence(task)}>Nộp bổ sung</Button>}
                                    {lane === 'review' && evidence.status === 'submitted' && isAdmin && <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => handleReviewEvidence(task, true)} style={{ background: '#16a34a', borderColor: '#16a34a' }}>Duyệt</Button>}
                                    {lane === 'review' && isAdmin && <Button size="small" danger onClick={() => handleReviewEvidence(task, false)}>Từ chối</Button>}
                                    {isAdmin && <Button type="text" icon={<EditOutlined />} onClick={() => handleEditTask(task)} aria-label="Sửa công việc" />}
                                    {isAdmin && <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTask(task.id)} aria-label="Xóa công việc" />}
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, color: '#64748b', fontSize: 13 }}>
                                <span><ClockCircleOutlined /> {task.dueTime}</span>
                                {isAdmin && <Space size={2}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEditTask(task)} /><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTask(task.id)} /></Space>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const OperationalColumn = ({ title, count, color, icon, tasks: laneTasks, lane }: { title: string; count: number; color: string; icon: ReactNode; tasks: Task[]; lane: 'today' | 'evidence' | 'review' }) => {
        if (count < 0) return null;
        const sortByDeadline = (left: Task, right: Task) =>
            dayjs(`${left.dueDate} ${left.dueTime}`).valueOf() - dayjs(`${right.dueDate} ${right.dueTime}`).valueOf();
        const filteredTasks = laneTasks.filter(task => taskMatchesBoardFilter(task, lane));
        const visibleTasks = [
            ...filteredTasks.filter(task => getEvidence(task).required).sort(sortByDeadline),
            ...filteredTasks.filter(task => !getEvidence(task).required).sort(sortByDeadline),
        ];

        return <section style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 10, padding: 16, minWidth: 320, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 6, background: color, color: '#fff', fontSize: 20 }}>{icon}</span>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#1e293b', flex: 1 }}>{title}</h2>
                <Badge count={count} style={{ backgroundColor: `${color}22`, color, boxShadow: 'none', fontWeight: 700 }} />
                <Tooltip title="Tùy chọn cột"><Button type="text" icon={<MoreOutlined />} /></Tooltip>
            </div>
            <div style={{ minHeight: 430 }}>
                {visibleTasks.map(task => <OperationalTaskCard key={task.id} task={task} lane={lane} />)}
                {visibleTasks.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có công việc" style={{ paddingTop: 80 }} />}
            </div>
            <div style={{ textAlign: 'center', color: '#64748b', border: '1px solid #dbe3ec', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
                {count} công việc
            </div>
        </section>;
    };

    return (
        <div style={{ padding: 24, backgroundColor: '#f0f2f5', minHeight: '100vh' }}>
            <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12, borderRadius: 10, padding: '8px 14px' }}
                description={
                    <span>
                        Nếu một ngày làm việc không có bất kỳ lịch sử xử lý công việc hằng ngày nào, hệ thống sẽ tự động phạt{' '}
                        <strong>{DAILY_REPORT_MISSING_FINE_OFFICIAL.toLocaleString('vi-VN')}đ / nhân viên chính thức</strong>
                        {' '}trong Bảng công. Áp dụng từ ngày{' '}
                        <strong>{dayjs(DAILY_REPORT_POLICY_START_DATE).format('DD/MM/YYYY')}</strong>.
                        {' '}Chủ nhật và ngày lễ không tính.
                    </span>
                }
            />

            {/* Header Stats */}
            <Card style={{
                marginBottom: 24,
                borderRadius: 12,
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 'bold' }}>
                            📋 Công việc hàng ngày
                        </h1>
                        <p style={{ margin: '8px 0 0', color: '#666', fontSize: 14 }}>
                            {dayjs().format('dddd, DD/MM/YYYY')}
                        </p>
                    </div>

                    <Space size={24}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#52c41a' }}>
                                {completedTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Hoàn thành</div>
                        </div>

                        <Divider type="vertical" style={{ height: 50 }} />

                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#ff4d4f' }}>
                                {overdueTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Quá hạn</div>
                        </div>

                        <Divider type="vertical" style={{ height: 50 }} />

                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 32, fontWeight: 'bold', color: '#fa8c16' }}>
                                🔥 {urgentTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Khẩn cấp</div>
                        </div>

                        <Divider type="vertical" style={{ height: 50 }} />

                        <div style={{ textAlign: 'center' }}>
                            <Progress
                                type="circle"
                                percent={Math.round((completedTasks / totalTasks) * 100)}
                                width={60}
                                strokeWidth={8}
                                strokeColor={{
                                    '0%': '#108ee9',
                                    '100%': '#87d068',
                                }}
                            />
                            <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Tiến độ</div>
                        </div>
                    </Space>

                    {isAdmin && <Button
                        type="primary"
                        size="large"
                        icon={<PlusOutlined />}
                        onClick={() => handleAddTask()}
                        style={{
                            height: 44,
                            fontSize: 15,
                            fontWeight: 'bold',
                            borderRadius: 10,
                            boxShadow: '0 4px 12px rgba(24, 144, 255, 0.3)'
                        }}
                    >
                        Thêm công việc
                    </Button>}
                </div>
            </Card>

            {/* Tab Switcher */}
            <div style={{ marginBottom: 24 }}>
                <Radio.Group
                    value={activeTab}
                    onChange={(e) => setActiveTab(e.target.value)}
                    size="large"
                    style={{
                        background: '#fff',
                        padding: 8,
                        borderRadius: 12,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                    }}
                >
                    <Radio.Button
                        value="tasks"
                        style={{
                            height: 44,
                            lineHeight: '44px',
                            paddingLeft: 24,
                            paddingRight: 24,
                            fontSize: 15,
                            fontWeight: 600,
                            borderRadius: 8
                        }}
                    >
                        📋 Công việc ({dailyTasks.filter(t => t.status !== 'completed').length})
                    </Radio.Button>
                    <Radio.Button
                        value="assignments"
                        style={{
                            height: 44,
                            lineHeight: '44px',
                            paddingLeft: 24,
                            paddingRight: 24,
                            fontSize: 15,
                            fontWeight: 600,
                            borderRadius: 8,
                            marginLeft: 8
                        }}
                    >
                        📌 Bàn giao {overdueAssignments.length > 0 ? <Badge count={overdueAssignments.length} offset={[8, -4]} /> : `(${pendingAssignments.length})`}
                    </Radio.Button>
                    <Radio.Button
                        value="history"
                        style={{
                            height: 44,
                            lineHeight: '44px',
                            paddingLeft: 24,
                            paddingRight: 24,
                            fontSize: 15,
                            fontWeight: 600,
                            borderRadius: 8,
                            marginLeft: 8
                        }}
                    >
                        📜 Lịch sử ({history.length})
                    </Radio.Button>
                </Radio.Group>
            </div>

            {/* === ASSIGNMENT TAB === */}
            {activeTab === 'assignments' && (
                <div>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 13, color: '#555' }}>
                                <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{pendingAssignments.length}</span> đang thực hiện
                            </span>
                            {overdueAssignments.length > 0 && (
                                <span style={{
                                    background: '#fff1f0', color: '#ff4d4f',
                                    border: '1px solid #ffccc7', borderRadius: 20,
                                    padding: '2px 10px', fontSize: 12, fontWeight: 700
                                }}>
                                    ⛔ {overdueAssignments.length} quá hạn
                                </span>
                            )}
                        </div>
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAssignment}
                            style={{ fontWeight: 600, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none' }}>
                            + Giao việc mới
                        </Button>
                    </div>

                    {/* Assignment Cards */}
                    {assignmentTasks.length === 0 ? (
                        <Card style={{ borderRadius: 14, textAlign: 'center', padding: 40 }}>
                            <Empty description="Chưa có công việc bàn giao nào" />
                            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddAssignment} style={{ marginTop: 16 }}>Giao việc đầu tiên</Button>
                        </Card>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {assignmentTasks
                                .sort((a, b) => {
                                    const order: any = { overdue: 0, warning: 1, normal: 2, done: 3 };
                                    return (order[getDeadlineStatus(a).status] || 2) - (order[getDeadlineStatus(b).status] || 2);
                                })
                                .map(task => {
                                    const ds = getDeadlineStatus(task);
                                    const notes = parseNotes(task.note);
                                    const isCompleted = task.status === 'completed';
                                    return (
                                        <div key={task.id} style={{
                                            borderRadius: 12,
                                            background: isCompleted ? '#f6ffed' : '#fff',
                                            border: `1px solid ${isCompleted ? '#b7eb8f' : ds.status === 'overdue' ? '#ffccc7' : ds.status === 'warning' ? '#ffe7ba' : '#e8e8e8'}`,
                                            borderLeft: `4px solid ${ds.color}`,
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                                            overflow: 'hidden',
                                        }}>
                                            {/* Main row */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                                                {/* Status icon */}
                                                <span style={{ fontSize: 18, flexShrink: 0 }}>{ds.icon}</span>

                                                {/* Title + meta */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                                        <span style={{
                                                            fontSize: 15, fontWeight: 700,
                                                            color: isCompleted ? '#999' : '#1a1a2e',
                                                            textDecoration: isCompleted ? 'line-through' : 'none',
                                                        }}>{task.title}</span>
                                                        <Tag color={task.priority === 'urgent' ? 'red' : task.priority === 'high' ? 'orange' : task.priority === 'low' ? 'default' : 'blue'}
                                                            style={{ margin: 0, fontSize: 11 }}>
                                                            {task.priority === 'urgent' ? '🔥 Khẩn' : task.priority === 'high' ? '⚡ Cao' : task.priority === 'low' ? '💤 Thấp' : 'BT'}
                                                        </Tag>
                                                        {task.category && task.category !== 'Bàn giao' && (
                                                            <Tag style={{ margin: 0, fontSize: 11 }}>{task.category}</Tag>
                                                        )}
                                                    </div>
                                                    {task.description && (
                                                        <div style={{ fontSize: 12, color: '#888', marginTop: 3, lineHeight: 1.4 }}>{task.description}</div>
                                                    )}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6 }}>
                                                        <span style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <UserOutlined style={{ fontSize: 11 }} />
                                                            <strong>{task.assignee}</strong>
                                                        </span>
                                                        <span style={{ fontSize: 12, color: ds.color, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                                            <ClockCircleOutlined style={{ fontSize: 11 }} />
                                                            {task.dueDate} {task.dueTime}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Right: countdown + actions */}
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                                                    <div style={{
                                                        padding: '3px 10px', borderRadius: 20,
                                                        background: ds.color, color: '#fff',
                                                        fontSize: 11, fontWeight: 700,
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {ds.label}
                                                    </div>
                                                    <Space size={2}>
                                                        {/* Nút "Đang làm" - chỉ hiện khi ≤10p và chưa acknowledged */}
                                                        {!isCompleted && (() => {
                                                            const deadline = dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm');
                                                            const remaining = deadline.diff(dayjs(), 'minute');
                                                            return remaining <= 10 && remaining >= 0 && !acknowledgedTasks.has(task.id);
                                                        })() && (
                                                                <Button type="primary" size="small" onClick={() => handleAcknowledgeTask(task.id)}
                                                                    style={{
                                                                        borderRadius: 6, background: '#fa8c16', border: 'none',
                                                                        fontWeight: 700, fontSize: 12,
                                                                        animation: 'pulse 1s infinite',
                                                                    }}>
                                                                    🔔 Đang làm
                                                                </Button>
                                                            )}
                                                        {!isCompleted && (
                                                            <Button type="primary" size="small" onClick={() => handleCompleteAssignment(task.id)}
                                                                style={{ borderRadius: 6, background: '#52c41a', border: 'none', fontWeight: 600, fontSize: 12 }}>
                                                                ✅ Xong
                                                            </Button>
                                                        )}
                                                        {isAdmin && (
                                                            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEditAssignment(task)}
                                                                style={{ color: '#1890ff', padding: '0 4px' }} />
                                                        )}
                                                        {isAdmin && (
                                                            <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteAssignment(task.id)}
                                                                style={{ padding: '0 4px' }} />
                                                        )}
                                                    </Space>
                                                </div>
                                            </div>

                                            {/* Notes section */}
                                            <div style={{
                                                borderTop: '1px solid #f0f0f0',
                                                padding: '8px 16px 10px',
                                                background: 'rgba(0,0,0,0.01)',
                                            }}>
                                                {notes.length > 0 && (
                                                    <div style={{ marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {notes.map((log, idx) => (
                                                            <div key={idx} style={{
                                                                display: 'flex', gap: 8, alignItems: 'flex-start',
                                                                fontSize: 12, color: '#444',
                                                            }}>
                                                                {log.timestamp && (
                                                                    <span style={{
                                                                        flexShrink: 0, background: '#e6f4ff', color: '#1677ff',
                                                                        borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600
                                                                    }}>{log.timestamp}</span>
                                                                )}
                                                                <span style={{ lineHeight: 1.5 }}>{log.note}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {showNoteInput[task.id] ? (
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <Input
                                                            placeholder="Nhập ghi chú..."
                                                            value={quickNotes[task.id] || ''}
                                                            onChange={e => setQuickNotes(prev => ({ ...prev, [task.id]: e.target.value }))}
                                                            onPressEnter={() => handleQuickAddNote(task)}
                                                            autoFocus
                                                            size="small"
                                                            style={{ fontSize: 12 }}
                                                        />
                                                        <Button type="primary" size="small" onClick={() => handleQuickAddNote(task)}>Lưu</Button>
                                                        <Button size="small" onClick={() => setShowNoteInput(prev => ({ ...prev, [task.id]: false }))}>Hủy</Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        type="text" size="small"
                                                        icon={<PlusOutlined />}
                                                        onClick={() => setShowNoteInput(prev => ({ ...prev, [task.id]: true }))}
                                                        style={{ color: '#888', fontSize: 12, padding: '0 4px', height: 24 }}
                                                    >
                                                        Thêm ghi chú
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}

                    {/* Assignment Modal */}
                    <Modal
                        title={editingAssignment ? '✏️ Sửa công việc bàn giao' : '📌 Giao việc mới'}
                        open={assignmentModalVisible}
                        onOk={handleSaveAssignment}
                        onCancel={() => { setAssignmentModalVisible(false); assignmentForm.resetFields(); }}
                        okText={editingAssignment ? 'Cập nhật' : 'Giao việc'}
                        cancelText="Hủy"
                        width={520}
                    >
                        <Form form={assignmentForm} layout="vertical" size="large">
                            <Form.Item name="title" label="Tên công việc" rules={[{ required: true, message: 'Nhập tên công việc!' }]}>
                                <Input placeholder="VD: Lắp camera cho kho A" />
                            </Form.Item>
                            <Form.Item name="description" label="Mô tả chi tiết">
                                <TextArea rows={3} placeholder="Chi tiết công việc cần làm..." />
                            </Form.Item>
                            <div style={{ display: 'flex', gap: 16 }}>
                                <Form.Item name="assignee" label="Giao cho" rules={[{ required: true, message: 'Chọn người!' }]} style={{ flex: 1 }}>
                                    <Select placeholder="Chọn nhân viên">
                                        {assigneeList.map(name => (
                                            <Option key={name} value={name}>
                                                <Avatar size="small" style={{ backgroundColor: getAvatarColor(name), marginRight: 8 }}>{name[0]}</Avatar>
                                                {name}
                                            </Option>
                                        ))}
                                    </Select>
                                </Form.Item>
                                <Form.Item name="priority" label="Mức ưu tiên" style={{ flex: 1 }}>
                                    <Select>
                                        <Option value="low">💤 Thấp</Option>
                                        <Option value="normal">📋 Bình thường</Option>
                                        <Option value="high">⚡ Cao</Option>
                                        <Option value="urgent">🔥 Khẩn cấp</Option>
                                    </Select>
                                </Form.Item>
                            </div>
                            <Form.Item name="deadline" label="⏰ Thời hạn hoàn thành" rules={[{ required: true, message: 'Chọn deadline!' }]}>
                                <DatePicker showTime format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} placeholder="Chọn ngày giờ deadline" />
                            </Form.Item>
                            <Form.Item name="note" label="📝 Ghi chú">
                                <TextArea rows={2} placeholder="Ghi chú thêm (tùy chọn)..." />
                            </Form.Item>
                        </Form>
                    </Modal>
                </div>
            )}

            {/* Tasks View */}
            {false && activeTab === 'tasks' && (
                <>
                    {/* Kanban Board - SCROLL NGANG - TỐI ĐA 3 CỘT */}
                    <div style={{
                        display: 'flex',
                        gap: 16,
                        overflowX: 'auto',
                        paddingBottom: 16,
                        scrollSnapType: 'x mandatory'
                    }}
                        className="kanban-board-horizontal"
                    >
                        {categories.map(category => (
                            <KanbanColumn key={category.key} category={category} />
                        ))}

                        {/* Cột "Khác" — hiển thị task mồ côi không thuộc danh mục nào */}
                        {(() => {
                            const categoryKeys = categories.map(c => c.key);
                            const orphanTasks = dailyTasks.filter(t => !t.category || !categoryKeys.includes(t.category));
                            if (orphanTasks.length === 0) return null;
                            return (
                                <KanbanColumn
                                    key="__orphan__"
                                    category={{
                                        key: '__orphan__',
                                        icon: '📂',
                                        color: '#8c8c8c',
                                        gradient: 'linear-gradient(135deg, #636e72, #b2bec3)'
                                    } as any}
                                />
                            );
                        })()}

                        {/* Add New Category Button */}
                        <div
                            className="kanban-column-3"
                            style={{
                                backgroundColor: '#fafafa',
                                borderRadius: 12,
                                padding: 16,
                                minWidth: 'calc(33.333% - 12px)',
                                maxWidth: 'calc(33.333% - 12px)',
                                border: '2px dashed #d9d9d9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease'
                            }}
                            onClick={() => {
                                setEditingCategory(null);
                                categoryForm.resetFields();
                                // Random gradient
                                const randomGradient = GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)];
                                categoryForm.setFieldsValue({ gradient: randomGradient });
                                setCategoryModalVisible(true);
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#f0f0f0';
                                e.currentTarget.style.borderColor = '#1890ff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#fafafa';
                                e.currentTarget.style.borderColor = '#d9d9d9';
                            }}
                        >
                            <div style={{ textAlign: 'center' }}>
                                <PlusOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 12 }} />
                                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#666' }}>
                                    Thêm danh mục mới
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'tasks' && (
                <>
                    <div style={{
                        display: 'flex', gap: 6, padding: 8, marginBottom: 18, background: '#fff',
                        border: '1px solid #dbe3ec', borderRadius: 8, overflowX: 'auto'
                    }}>
                        {[
                            ['all', 'Tất cả'],
                            ['action', 'Cần xử lý'],
                            ['evidence', 'Cần bằng chứng'],
                            ['overdue', 'Quá hạn'],
                        ].map(([key, label]) => (
                            <Button key={key} type="text" onClick={() => setBoardFilter(key as typeof boardFilter)} style={{
                                height: 40, padding: '0 20px', borderRadius: 4, fontWeight: 650,
                                color: boardFilter === key ? '#15803d' : '#475569',
                                borderBottom: boardFilter === key ? '2px solid #16a34a' : '2px solid transparent',
                            }}>{label}</Button>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 16 }}>
                        <OperationalColumn
                            title="VIỆC HÔM NAY"
                            count={dailyTasks.filter(task => !isOverdue(task)).length}
                            color="#1677ff"
                            icon={<FileTextOutlined />}
                            tasks={dailyTasks.filter(task => !isOverdue(task))}
                            lane="today"
                        />
                        <OperationalColumn
                            title="CẦN NỘP BẰNG CHỨNG"
                            count={-1}
                            color="#f59e0b"
                            icon={<UploadOutlined />}
                            tasks={evidenceToSubmit}
                            lane="evidence"
                        />
                        <OperationalColumn
                            title="QUÁ HẠN / CẦN DUYỆT"
                            count={dailyTasks.filter(task => isOverdue(task)).length}
                            color="#dc2626"
                            icon={<WarningOutlined />}
                            tasks={dailyTasks.filter(task => isOverdue(task))}
                            lane="review"
                        />
                    </div>
                </>
            )}

            {/* History Calendar View */}
            {activeTab === 'history' && (
                <HistoryCalendar tasks={tasks} history={history} />
            )}

            {/* Category Modal */}
            <Modal
                title={editingCategory ? 'Sửa danh mục' : 'Thêm danh mục mới'}
                open={categoryModalVisible}
                onOk={handleSaveCategory}
                onCancel={() => {
                    setCategoryModalVisible(false);
                    categoryForm.resetFields();
                    setEditingCategory(null);
                }}
                okText="Lưu"
                cancelText="Hủy"
                width={650}
                afterOpenChange={(open) => {
                    if (open && !editingCategory) {
                        // Auto-generate icon and gradient for new category
                        const EMOJI_LIST = ['🛒', '📦', '💬', '🧹', '📊', '🔧', '💼', '📞', '🚚', '💰', '📝', '🎯', '⚙️', '📈', '🏪', '🎁', '📱', '🖥️', '🔔', '⭐'];
                        const randomEmoji = EMOJI_LIST[Math.floor(Math.random() * EMOJI_LIST.length)];
                        const randomGradient = GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)];

                        categoryForm.setFieldsValue({
                            icon: randomEmoji,
                            gradient: randomGradient,
                            color: '#1890ff'
                        });
                    }
                }}
            >
                <Form form={categoryForm} layout="vertical">
                    <Form.Item
                        name="key"
                        label="Tên danh mục"
                        rules={[{ required: true, message: 'Vui lòng nhập tên!' }]}
                    >
                        <Input placeholder="VD: Sàn TMDT" />
                    </Form.Item>

                    {false && <><div style={{
                        border: '1px solid #fed7aa',
                        background: '#fff7ed',
                        borderRadius: 8,
                        padding: '12px 14px',
                        marginBottom: 16,
                    }}>
                        <Form.Item name="evidenceRequired" noStyle>
                            <Radio.Group disabled={!isAdmin} optionType="button" buttonStyle="solid">
                                <Radio.Button value={false}>Việc thường</Radio.Button>
                                <Radio.Button value={true}>Yêu cầu bằng chứng</Radio.Button>
                            </Radio.Group>
                        </Form.Item>
                        <span style={{ marginLeft: 10, fontWeight: 600, color: '#9a3412' }}>
                            Yêu cầu nộp bằng chứng trước khi xác nhận hoàn thành
                        </span>
                        {!isAdmin && <div style={{ marginTop: 6, fontSize: 12, color: '#9a3412' }}>Chỉ admin được thay đổi loại hoàn thành và mức phạt.</div>}
                        <Form.Item noStyle shouldUpdate={(prev, current) => prev.evidenceRequired !== current.evidenceRequired}>
                            {({ getFieldValue }) => getFieldValue('evidenceRequired') ? (
                                <Form.Item name="penaltyAmount" label="Mức phạt khi trễ / không nộp (đ)" style={{ margin: '12px 0 0' }}>
                                    <InputNumber
                                        min={0}
                                        precision={0}
                                        controls={false}
                                        suffix="đ"
                                        disabled={!isAdmin}
                                        style={{ width: '100%' }}
                                        formatter={formatPenaltyAmount}
                                        parser={(value) => String(value || '').replace(/[^\d]/g, '')}
                                    />
                                </Form.Item>
                            ) : null}
                        </Form.Item>
                    </div></>}

                    {/* Hidden fields - auto-generated */}
                    <Form.Item name="icon" hidden>
                        <Input />
                    </Form.Item>

                    <Form.Item name="color" hidden>
                        <Input />
                    </Form.Item>

                    <Form.Item name="gradient" hidden>
                        <Input />
                    </Form.Item>

                    <div style={{
                        marginTop: 12,
                        padding: 16,
                        borderRadius: 12,
                        background: categoryForm.getFieldValue('gradient') || GRADIENT_PRESETS[0],
                        color: '#fff',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        fontSize: 18,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}>
                        Preview: {categoryForm.getFieldValue('icon')} {categoryForm.getFieldValue('key') || 'Tên danh mục'}
                    </div>
                </Form>
            </Modal>

            {/* Task Modal - SIMPLIFIED */}
            <Modal
                title={editingTask ? 'Sửa công việc' : '✨ Thêm công việc mới'}
                open={taskModalVisible}
                onOk={handleSaveTask}
                onCancel={() => {
                    setTaskModalVisible(false);
                    taskForm.resetFields();
                    setEditingTask(null);
                }}
                width={550}
                okText="💾 Lưu"
                cancelText="Hủy"
                okButtonProps={{ size: 'large', style: { minWidth: 100 } }}
                cancelButtonProps={{ size: 'large' }}
            >
                <Form form={taskForm} layout="vertical">
                    {/* Tên công việc - BẮT BUỘC */}
                    <Form.Item
                        name="title"
                        label={<span style={{ fontSize: 15, fontWeight: 600 }}>📝 Tên công việc</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập tên công việc!' }]}
                    >
                        <Input
                            placeholder="VD: Check phản hồi Shopee"
                            size="large"
                            style={{ fontSize: 15 }}
                        />
                    </Form.Item>

                    {/* Mô tả */}
                    <Form.Item
                        name="description"
                        label={<span style={{ fontSize: 14, fontWeight: 500 }}>💬 Mô tả</span>}
                    >
                        <TextArea
                            rows={3}
                            placeholder="Mô tả chi tiết công việc..."
                            style={{ fontSize: 14 }}
                        />
                    </Form.Item>

                    {/* Người thực hiện - TÙY CHỌN (có thể nhận việc sau) */}
                    <Form.Item
                        name="evidenceRequired"
                        label={<span style={{ fontSize: 14, fontWeight: 700 }}>Cách xác nhận hoàn thành</span>}
                        rules={[{ required: true }]}
                    >
                        <Select
                            size="large"
                            disabled={!isAdmin}
                            options={[
                                { value: false, label: 'Việc thường - cần người xác nhận' },
                                { value: true, label: 'Yêu cầu bằng chứng' },
                            ]}
                        />
                    </Form.Item>
                    {!isAdmin && <div style={{ marginTop: -12, marginBottom: 16, fontSize: 12, color: '#64748b' }}>Chỉ admin được đổi loại hoàn thành.</div>}
                    <Form.Item noStyle shouldUpdate={(prev, current) => prev.evidenceRequired !== current.evidenceRequired}>
                        {({ getFieldValue }) => getFieldValue('evidenceRequired') ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(104px, 0.75fr) minmax(120px, 0.9fr)', gap: 10, padding: 12, marginBottom: 16, border: '1px solid #fed7aa', borderRadius: 8, background: '#fffaf5' }}>
                                <Form.Item name="evidenceMethod" label="Bằng chứng" style={{ marginBottom: 0 }}>
                                    <Select size="middle" disabled={!isAdmin} options={[
                                        { value: 'link', label: 'Chỉ link' },
                                        { value: 'image', label: 'Chỉ ảnh' },
                                        { value: 'both', label: 'Link và ảnh' },
                                    ]} />
                                </Form.Item>
                                <Form.Item name="evidenceDeadlineTime" label="Hạn chót" rules={[{ required: true, message: 'Chọn giờ hạn chót.' }]} style={{ marginBottom: 0 }}>
                                    <Select size="middle" disabled={!isAdmin} showSearch optionFilterProp="label" options={EVIDENCE_DEADLINE_OPTIONS} />
                                </Form.Item>
                                <Form.Item name="penaltyAmount" label="Phạt (đ)" style={{ marginBottom: 0 }}>
                                    <InputNumber min={0} precision={0} controls={false} suffix="đ" disabled={!isAdmin} style={{ width: '100%' }} formatter={formatPenaltyAmount} parser={(value) => String(value || '').replace(/[^\d]/g, '')} />
                                </Form.Item>
                                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#c2410c' }}>Ân hạn thêm 20 phút sau giờ hạn trước khi ghi nhận phạt.</div>
                            </div>
                        ) : null}
                    </Form.Item>

                    <Form.Item name="assigneeFixed" valuePropName="checked" style={{ marginBottom: 8 }}>
                        <Checkbox onChange={(event) => {
                            setAssigneeFixed(event.target.checked);
                            if (!event.target.checked) taskForm.setFieldsValue({ assignee: '' });
                        }}>
                            Cố định người thực hiện
                        </Checkbox>
                    </Form.Item>
                    <div style={{ marginBottom: 10, fontSize: 12, color: '#64748b' }}>
                        {assigneeFixed ? 'Chỉ người được chọn có thể thực hiện công việc này.' : 'Để trống: nhân viên phù hợp có thể nhận việc sau.'}
                    </div>
                    <Form.Item
                        name="assignee"
                        label={<span style={{ fontSize: 14, fontWeight: 600 }}>👤 Người thực hiện <span style={{ fontSize: 12, fontWeight: 400, color: '#999' }}>(có thể để trống — nhận việc sau)</span></span>}
                        style={{ marginBottom: 16 }}
                    >
                        <Select
                            size="large"
                            placeholder="Để trống = ai rảnh nhận việc"
                            optionLabelProp="label"
                            virtual={false}
                            showSearch
                            allowClear
                            dropdownStyle={{ zIndex: 2000 }}
                            filterOption={(input, option) =>
                                (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                            }
                            onSearch={() => { }}
                            onChange={(value) => {
                                // Nếu người dùng gõ tên mới (không có trong danh sách)
                                if (value && !assigneeList.includes(value)) {
                                    const updated = [...assigneeList, value];
                                    saveAssigneeList(updated);
                                    message.success(`✅ Đã thêm "${value}" vào danh sách!`);
                                }
                            }}
                        >
                            {assigneeList.map((name, index) => {
                                const colors = ['#1890ff', '#52c41a', '#eb2f96', '#722ed1', '#fa8c16', '#13c2c2'];
                                const color = colors[index % colors.length];

                                return (
                                    <Option key={name} value={name} label={name}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Avatar size="small" style={{ backgroundColor: color, marginRight: 8 }}>
                                                    {name[0]}
                                                </Avatar>
                                                {name}
                                            </div>
                                            <Button
                                                type="text"
                                                size="small"
                                                danger
                                                icon={<DeleteOutlined />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    Modal.confirm({
                                                        title: 'Xóa người thực hiện?',
                                                        content: `Bạn có chắc muốn xóa "${name}" khỏi danh sách?`,
                                                        okText: 'Xóa',
                                                        okType: 'danger',
                                                        cancelText: 'Hủy',
                                                        onOk: () => {
                                                            const updated = assigneeList.filter(p => p !== name);
                                                            saveAssigneeList(updated);
                                                            message.success('Đã xóa!');
                                                        },
                                                    });
                                                }}
                                                style={{ padding: '0 4px' }}
                                            />
                                        </div>
                                    </Option>
                                );
                            })}
                        </Select>
                    </Form.Item>

                    {/* Thêm người mới - Toggle inline Input */}
                    {!showAddAssignee ? (
                        <Button
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={() => setShowAddAssignee(true)}
                            block
                            size="small"
                            style={{
                                marginBottom: 16,
                                borderRadius: 8,
                                borderColor: '#52c41a',
                                color: '#52c41a'
                            }}
                        >
                            Thêm người thực hiện mới
                        </Button>
                    ) : (
                        <div style={{ marginBottom: 16 }}>
                            <Form.Item
                                label={<span style={{ fontSize: 13, fontWeight: 500 }}>✏️ Nhập tên người mới</span>}
                                style={{ marginBottom: 8 }}
                            >
                                <Input
                                    placeholder="VD: Nguyễn Văn A"
                                    size="large"
                                    autoFocus
                                    value={newAssigneeName}
                                    onChange={(e) => setNewAssigneeName(e.target.value)}
                                    onPressEnter={() => {
                                        const name = newAssigneeName.trim();
                                        if (!name) return;
                                        if (assigneeList.includes(name)) {
                                            message.warning('Người này đã tồn tại!');
                                            return;
                                        }
                                        const updated = [...assigneeList, name];
                                        saveAssigneeList(updated);
                                        taskForm.setFieldsValue({ assignee: name });
                                        setNewAssigneeName('');
                                        setShowAddAssignee(false);
                                        message.success(`✅ Đã thêm "${name}"!`);
                                    }}
                                    style={{ fontSize: 15 }}
                                />
                            </Form.Item>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <Button
                                    type="primary"
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={() => {
                                        const name = newAssigneeName.trim();
                                        if (!name) {
                                            message.warning('Vui lòng nhập tên!');
                                            return;
                                        }
                                        if (assigneeList.includes(name)) {
                                            message.warning('Người này đã tồn tại!');
                                            return;
                                        }
                                        const updated = [...assigneeList, name];
                                        saveAssigneeList(updated);
                                        taskForm.setFieldsValue({ assignee: name });
                                        setNewAssigneeName('');
                                        setShowAddAssignee(false);
                                        message.success(`✅ Đã thêm "${name}"!`);
                                    }}
                                    style={{ borderRadius: 6 }}
                                >
                                    Thêm
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setShowAddAssignee(false);
                                        setNewAssigneeName('');
                                    }}
                                    style={{ borderRadius: 6 }}
                                >
                                    Hủy
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Hidden fields - auto-generated */}
                    <Form.Item name="category" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="priority" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="dueDate" hidden>
                        <Input />
                    </Form.Item>
                    <Form.Item name="status" hidden>
                        <Input />
                    </Form.Item>

                    {/* Info box */}
                    <div style={{
                        background: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 50%, #e6f7ff 100%)',
                        border: '1px solid #91d5ff',
                        borderRadius: 8,
                        padding: 12,
                        marginTop: 16
                    }}>
                        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
                            <div><strong>ℹ️ Thông tin tự động:</strong></div>
                            <div style={{ marginTop: 4 }}>
                                • 📋 Mức ưu tiên: <strong>Bình thường</strong><br />
                                • ⏰ Thời hạn: <strong>{taskForm.getFieldValue('evidenceRequired') ? 'Theo hạn chót bằng chứng' : '20:00 hôm nay'}</strong><br />
                                • 📂 Danh mục: <strong>{taskForm.getFieldValue('category') || 'Tự động'}</strong>
                            </div>
                        </div>
                    </div>
                </Form>
            </Modal>

            {/* Alert Popups góc phải dưới */}
            <AlertPopup popups={alertPopups} onDismiss={dismissAlertPopup} />
        </div>
    );
};

// 📅 HISTORY CALENDAR COMPONENT - PREMIUM STYLE 
const HistoryCalendar = ({ tasks, history }: { tasks: Task[], history: any[] }) => {
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [currentMonth, setCurrentMonth] = useState(dayjs());
    const [hoveredDate, setHoveredDate] = useState<string | null>(null);

    // Lấy TẤT CẢ công việc trong ngày (để hiển thị trong modal chi tiết)
    const getAllTasksForDate = (date: dayjs.Dayjs) => {
        const dateStr = date.format('YYYY-MM-DD');
        const isToday = date.isSame(dayjs(), 'day');
        return tasks.filter(task => {
            // Daily tasks: hiển ở ngày hôm nay (vì lặp hàng ngày)
            if (!task.type || task.type === 'daily') {
                return isToday;
            }
            // Assignment tasks: so sánh theo dueDate thực tế
            if (task.dueDate) {
                return task.dueDate === dateStr;
            }
            return false;
        });
    };

    // Lấy chỉ công việc ĐÃ HOÀN THÀNH (để highlight calendar)
    const getCompletedTasksForDate = (date: dayjs.Dayjs) => {
        return getAllTasksForDate(date).filter(task => task.status === 'completed');
    };

    const getHistoryForDate = (date: dayjs.Dayjs) => {
        const dateStr = date.format('YYYY-MM-DD');
        const entriesOnDate = history.filter(h => {
            if (!h.timestamp) return false;
            return dayjs(h.timestamp).format('YYYY-MM-DD') === dateStr;
        });

        // Older data may contain both the confirmation event and the next-day
        // reset event for one completion. Keep the user confirmation only.
        const preferredCompletion = new Map<string, any>();
        entriesOnDate.forEach(entry => {
            if (entry.action !== 'completed' && entry.action !== 'daily_reset') return;

            const taskKey = entry.taskId ? String(entry.taskId) : String(entry.taskTitle || '').trim().toLowerCase();
            if (!taskKey) return;

            const existing = preferredCompletion.get(taskKey);
            if (!existing || (existing.action === 'daily_reset' && entry.action === 'completed')) {
                preferredCompletion.set(taskKey, entry);
            }
        });

        return entriesOnDate.filter(entry => {
            if (entry.action !== 'completed' && entry.action !== 'daily_reset') return true;
            const taskKey = entry.taskId ? String(entry.taskId) : String(entry.taskTitle || '').trim().toLowerCase();
            return taskKey ? preferredCompletion.get(taskKey) === entry : true;
        });
    };

    const getHistoryDescription = (entry: any) => {
        if (entry.action === 'completed' || entry.action === 'daily_reset') {
            return `✅ Đã hoàn thành: "${entry.taskTitle}"`;
        }
        if (entry.action === 'pending') {
            return `↩️ Đã mở lại: "${entry.taskTitle}"`;
        }
        return entry.description;
    };

    // Tạo danh sách ngày trong tháng
    const generateCalendarDays = () => {
        const startOfMonth = currentMonth.startOf('month');
        const endOfMonth = currentMonth.endOf('month');
        const startDate = startOfMonth.startOf('week');
        const endDate = endOfMonth.endOf('week');

        const days: dayjs.Dayjs[] = [];
        let currentDate = startDate;

        while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
            days.push(currentDate);
            currentDate = currentDate.add(1, 'day');
        }

        return days;
    };

    const calendarDays = generateCalendarDays();

    // Premium Calendar Day Card with Glassmorphism
    const CalendarDayCard = ({ date }: { date: dayjs.Dayjs }) => {
        const allTasksOnDay = getAllTasksForDate(date);
        const completedTasksOnDay = getCompletedTasksForDate(date);
        const historyOnDay = getHistoryForDate(date);
        const isCurrentMonth = date.month() === currentMonth.month();
        const isToday = date.isSame(dayjs(), 'day');
        const holidayName = getFixedVietnamHolidayName(date);
        const isRestDay = isDailyReportRestDay(date);
        const completedCount = completedTasksOnDay.length;
        const totalCount = allTasksOnDay.length;
        const hasActivity = allTasksOnDay.length > 0 || historyOnDay.length > 0;
        const dateStr = date.format('YYYY-MM-DD');
        const isHovered = hoveredDate === dateStr;
        const pendingCount = allTasksOnDay.filter(t => t.status === 'pending').length;
        const isPastWorkingDay = isCurrentMonth && isPastDailyReportWorkingDay(date);
        const isMissingDailyReport = isPastWorkingDay && historyOnDay.length === 0;
        const isInteractive = hasActivity || isMissingDailyReport;

        // Tính completion percentage
        const completionPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

        // Background gradient dựa trên activity
        const getCardBackground = () => {
            if (isToday) {
                // Hôm nay - Purple vibrant
                return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            }
            if (isMissingDailyReport) {
                return 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)';
            }
            // ⚠️ PRIORITY: Ngày có công việc CHƯA HOÀN THÀNH - ĐỎ GRADIENT ĐẸP
            if (pendingCount > 0) {
                return 'linear-gradient(135deg, #ee0979 0%, #ff6a00 100%)';
            }
            // 100% hoàn thành - Xanh lá gradient
            if (completionPercent === 100 && hasActivity) {
                return 'linear-gradient(135deg, #56ab2f 0%, #a8e063 100%)';
            }
            // Có activity nhưng không có pending - Xanh dương pastel
            if (hasActivity) {
                return 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
            }
            return isRestDay ? 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)' : '#ffffff';
        };

        return (
            <div
                onClick={() => isInteractive && setSelectedDate(dateStr)}
                onMouseEnter={() => setHoveredDate(dateStr)}
                onMouseLeave={() => setHoveredDate(null)}
                style={{
                    position: 'relative',
                    background: getCardBackground(),
                    border: isToday
                        ? '3px solid #667eea'
                        : isMissingDailyReport
                            ? '2px solid rgba(207, 19, 34, 0.45)'
                            : hasActivity
                                ? '2px solid rgba(102, 126, 234, 0.2)'
                                : '1px solid rgba(0,0,0,0.06)',
                    borderRadius: 20,
                    padding: '16px',
                    minHeight: 140,
                    cursor: isInteractive ? 'pointer' : 'default',
                    opacity: isCurrentMonth ? 1 : 0.35,
                    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isHovered && isInteractive ? 'translateY(-4px) scale(1.02)' : 'translateY(0) scale(1)',
                    boxShadow: isHovered && isInteractive
                        ? '0 20px 40px rgba(0,0,0,0.15)'
                        : isToday
                            ? '0 12px 32px rgba(102, 126, 234, 0.4)'
                            : isMissingDailyReport
                                ? '0 10px 28px rgba(207, 19, 34, 0.28)'
                                : pendingCount > 0
                                    ? '0 8px 24px rgba(238, 9, 121, 0.3)'
                                    : hasActivity
                                        ? '0 8px 24px rgba(0,0,0,0.1)'
                                        : '0 2px 8px rgba(0,0,0,0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}
            >
                {/* Animated Background Glow for Today */}
                {isToday && (
                    <div style={{
                        position: 'absolute',
                        top: '-50%',
                        left: '-50%',
                        width: '200%',
                        height: '200%',
                        background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
                        animation: 'pulse 3s ease-in-out infinite',
                        pointerEvents: 'none'
                    }} />
                )}

                {/* Date Number with Gradient Text for Today */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                    position: 'relative',
                    zIndex: 1
                }}>
                    <div style={{
                        fontSize: isToday ? 28 : 22,
                        fontWeight: isToday ? 900 : 700,
                        color: isToday || isMissingDailyReport ? '#fff' : isCurrentMonth ? '#1f1f1f' : '#999',
                        textShadow: isToday || isMissingDailyReport ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
                        letterSpacing: '-0.5px'
                    }}>
                        {date.date()}
                    </div>
                    {isToday && (
                        <div style={{
                            background: 'rgba(255,255,255,0.9)',
                            borderRadius: '50%',
                            width: 8,
                            height: 8,
                            boxShadow: '0 0 0 4px rgba(255,255,255,0.3)',
                            animation: 'pulse 2s ease-in-out infinite'
                        }} />
                    )}
                </div>

                {/* Lunar/Weekday info */}
                <div style={{
                    fontSize: 11,
                    color: isToday || isMissingDailyReport ? 'rgba(255,255,255,0.85)' : '#999',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                }}>
                    {date.format('ddd')}
                </div>

                {isMissingDailyReport && (
                    <div style={{
                        marginTop: allTasksOnDay.length > 0 ? 10 : 'auto',
                        fontSize: 11,
                        color: '#fff',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '7px 9px',
                        background: 'rgba(255,255,255,0.18)',
                        border: '1px solid rgba(255,255,255,0.28)',
                        borderRadius: 10,
                        position: 'relative',
                        zIndex: 1,
                        boxShadow: '0 6px 14px rgba(0,0,0,0.12)'
                    }}>
                        <WarningOutlined style={{ fontSize: 13 }} />
                        <span>Chưa ghi nhận</span>
                    </div>
                )}

                {!isMissingDailyReport && isRestDay && !hasActivity && (
                    <div style={{
                        marginTop: 'auto',
                        fontSize: 11,
                        color: '#8c8c8c',
                        fontWeight: 700,
                        padding: '6px 9px',
                        background: 'rgba(0,0,0,0.04)',
                        borderRadius: 8,
                        width: 'fit-content'
                    }}>
                        {holidayName || 'Chủ nhật'}
                    </div>
                )}

                {/* Tasks Summary with Premium Design */}
                {allTasksOnDay.length > 0 && (
                    <div style={{
                        marginTop: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        position: 'relative',
                        zIndex: 1
                    }}>
                        {/* Circular Progress Indicator */}
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            height: 8,
                            backgroundColor: isToday || isMissingDailyReport ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.06)',
                            borderRadius: 20,
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                height: '100%',
                                width: `${completionPercent}%`,
                                background: completionPercent === 100
                                    ? 'linear-gradient(90deg, #11998e 0%, #38ef7d 100%)'
                                    : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                                borderRadius: 20,
                                transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: '0 0 10px rgba(102, 126, 234, 0.5)'
                            }} />
                        </div>

                        {/* Task Stats */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: 12,
                            fontWeight: 700
                        }}>
                            <span style={{
                                color: isToday || isMissingDailyReport ? 'rgba(255,255,255,0.95)' : '#444',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                            }}>
                                <span style={{ fontSize: 14 }}>📋</span> {totalCount}
                            </span>
                            <span style={{
                                color: isToday || isMissingDailyReport ? '#fff' : completionPercent === 100 ? '#11998e' : '#fa8c16',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3
                            }}>
                                {completionPercent === 100 ? '✨' : '⏳'} {completedCount}/{totalCount}
                            </span>
                        </div>

                        {/* Premium Priority Badges */}
                        <div style={{
                            display: 'flex',
                            gap: 4,
                            flexWrap: 'wrap'
                        }}>
                            {allTasksOnDay.some(t => t.priority === 'urgent') && (
                                <div style={{
                                    background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)',
                                    color: '#fff',
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: '3px 8px',
                                    borderRadius: 12,
                                    boxShadow: '0 2px 8px rgba(255,107,107,0.4)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.3px'
                                }}>
                                    🔥 Khẩn
                                </div>
                            )}
                            {allTasksOnDay.some(t => t.priority === 'high') && (
                                <div style={{
                                    background: 'linear-gradient(135deg, #ffa726 0%, #fb8c00 100%)',
                                    color: '#fff',
                                    fontSize: 9,
                                    fontWeight: 800,
                                    padding: '3px 8px',
                                    borderRadius: 12,
                                    boxShadow: '0 2px 8px rgba(255,167,38,0.4)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.3px'
                                }}>
                                    ⚡ Cao
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* History indicator - Premium Style */}
                {historyOnDay.length > 0 && allTasksOnDay.length === 0 && (
                    <div style={{
                        marginTop: 'auto',
                        fontSize: 11,
                        color: isToday ? 'rgba(255,255,255,0.9)' : '#999',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 10px',
                        background: isToday ? 'rgba(255,255,255,0.15)' : 'rgba(102,126,234,0.08)',
                        borderRadius: 8,
                        backdropFilter: 'blur(8px)'
                    }}>
                        <span style={{ fontSize: 13 }}>📜</span>
                        {historyOnDay.length} hoạt động
                    </div>
                )}

                {/* Hover Indicator */}
                {isHovered && isInteractive && (
                    <div style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 6,
                        height: 6,
                        background: isMissingDailyReport ? '#fff' : '#667eea',
                        borderRadius: '50%',
                        boxShadow: isMissingDailyReport ? '0 0 0 3px rgba(255,255,255,0.24)' : '0 0 0 3px rgba(102,126,234,0.2)',
                        animation: 'pulse 1s ease-in-out infinite'
                    }} />
                )}
            </div>
        );
    };

    return (
        <div>
            {/* Premium Month Navigator with Glassmorphism */}
            <Card style={{
                marginBottom: 24,
                borderRadius: 24,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                border: 'none',
                boxShadow: '0 20px 60px rgba(102, 126, 234, 0.4)',
                overflow: 'hidden'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '20px 8px'
                }}>
                    <Button
                        size="large"
                        onClick={() => setCurrentMonth(currentMonth.subtract(1, 'month'))}
                        icon={<span style={{ fontSize: 18 }}>←</span>}
                        style={{
                            borderRadius: 16,
                            background: 'rgba(255,255,255,0.15)',
                            border: '2px solid rgba(255,255,255,0.25)',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 15,
                            height: 50,
                            paddingLeft: 20,
                            paddingRight: 20,
                            backdropFilter: 'blur(10px)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
                            e.currentTarget.style.transform = 'translateX(-6px) scale(1.05)';
                            e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                            e.currentTarget.style.transform = 'translateX(0) scale(1)';
                            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                        }}
                    >
                        Tháng trước
                    </Button>

                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4
                    }}>
                        <div style={{
                            fontSize: 36,
                            fontWeight: 900,
                            color: '#fff',
                            textShadow: '0 4px 16px rgba(0,0,0,0.25)',
                            letterSpacing: '-1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            lineHeight: 1
                        }}>
                            <span style={{ fontSize: 40 }}>📆</span>
                            tháng {currentMonth.format('M/YYYY')}
                        </div>
                        <div style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'rgba(255,255,255,0.85)',
                            textTransform: 'uppercase',
                            letterSpacing: '2px',
                            background: 'rgba(255,255,255,0.1)',
                            padding: '4px 16px',
                            borderRadius: 20,
                            backdropFilter: 'blur(5px)'
                        }}>
                            Lịch sử công việc
                        </div>
                    </div>

                    <Button
                        size="large"
                        onClick={() => setCurrentMonth(currentMonth.add(1, 'month'))}
                        icon={<span style={{ fontSize: 18 }}>→</span>}
                        iconPosition="end"
                        style={{
                            borderRadius: 16,
                            background: 'rgba(255,255,255,0.15)',
                            border: '2px solid rgba(255,255,255,0.25)',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 15,
                            height: 50,
                            paddingLeft: 20,
                            paddingRight: 20,
                            backdropFilter: 'blur(10px)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.25)';
                            e.currentTarget.style.transform = 'translateX(6px) scale(1.05)';
                            e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                            e.currentTarget.style.transform = 'translateX(0) scale(1)';
                            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                        }}
                    >
                        Tháng sau
                    </Button>
                </div>
            </Card>

            {/* Premium Calendar Grid */}
            <Card style={{
                borderRadius: 24,
                border: 'none',
                boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
                background: '#fff',
                overflow: 'hidden'
            }}>
                {/* Premium Weekday Headers */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: 12,
                    marginBottom: 20,
                    padding: '16px 12px',
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.15)'
                }}>
                    {['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'].map((day, index) => (
                        <div key={index} style={{
                            textAlign: 'center',
                            fontWeight: 700,
                            fontSize: 13,
                            color: '#fff',
                            textTransform: 'uppercase',
                            letterSpacing: '1px',
                            textShadow: '0 2px 4px rgba(0,0,0,0.15)',
                            padding: '8px 4px',
                            background: index === 0 || index === 6
                                ? 'rgba(255,255,255,0.15)'
                                : 'transparent',
                            borderRadius: 8
                        }}>
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Days Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: 14,
                    padding: '8px 0'
                }}>
                    {calendarDays.map((date, index) => (
                        <CalendarDayCard key={index} date={date} />
                    ))}
                </div>
            </Card>

            {/* Premium Detail Modal */}
            <Modal
                title={
                    <div style={{
                        fontSize: 22,
                        fontWeight: 900,
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        letterSpacing: '-0.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12
                    }}>
                        <span style={{
                            fontSize: 28,
                            background: 'none',
                            WebkitTextFillColor: 'initial'
                        }}>📅</span>
                        {selectedDate ? dayjs(selectedDate).format('DD/MM/YYYY (dddd)') : ''}
                    </div>
                }
                open={!!selectedDate}
                onCancel={() => setSelectedDate(null)}
                footer={null}
                width={900}
                style={{ top: 40 }}
                styles={{
                    mask: { backdropFilter: 'blur(8px)' }
                }}
            >
                {selectedDate && (
                    <div style={{
                        background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 20%, #f5f7fa 100%)',
                        padding: 24,
                        borderRadius: 16,
                        margin: '-24px -24px 0 -24px'
                    }}>
                        {(() => {
                            const selectedDay = dayjs(selectedDate);
                            const tasksOnDay = getAllTasksForDate(selectedDay);
                            const historyOnDay = getHistoryForDate(selectedDay);
                            const selectedIsMissingDailyReport =
                                selectedDay.month() === currentMonth.month() &&
                                isPastDailyReportWorkingDay(selectedDay) &&
                                historyOnDay.length === 0;

                            return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                                    {selectedIsMissingDailyReport && (tasksOnDay.length > 0 || historyOnDay.length > 0) && (
                                        <div style={{
                                            background: '#fff1f0',
                                            border: '1px solid #ffccc7',
                                            borderRadius: 14,
                                            padding: '14px 16px',
                                            color: '#cf1322',
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 10
                                        }}>
                                            <WarningOutlined />
                                            <span>Ngày làm việc đã qua nhưng chưa ghi nhận công việc hằng ngày.</span>
                                        </div>
                                    )}

                                    {/* Summary Stats */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3, 1fr)',
                                        gap: 16
                                    }}>
                                        <div style={{
                                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                            padding: 20,
                                            borderRadius: 16,
                                            color: '#fff',
                                            boxShadow: '0 8px 24px rgba(102, 126, 234, 0.3)'
                                        }}>
                                            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Tổng số</div>
                                            <div style={{ fontSize: 32, fontWeight: 900 }}>{tasksOnDay.length}</div>
                                            <div style={{ fontSize: 13, opacity: 0.85 }}>công việc</div>
                                        </div>
                                        <div style={{
                                            background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
                                            padding: 20,
                                            borderRadius: 16,
                                            color: '#fff',
                                            boxShadow: '0 8px 24px rgba(17, 153, 142, 0.3)'
                                        }}>
                                            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Hoàn thành</div>
                                            <div style={{ fontSize: 32, fontWeight: 900 }}>{tasksOnDay.filter(t => t.status === 'completed').length}</div>
                                            <div style={{ fontSize: 13, opacity: 0.85 }}>✨ nhiệm vụ</div>
                                        </div>
                                        <div style={{
                                            background: 'linear-gradient(135deg, #fc5c7d 0%, #6a82fb 100%)',
                                            padding: 20,
                                            borderRadius: 16,
                                            color: '#fff',
                                            boxShadow: '0 8px 24px rgba(252, 92, 125, 0.3)'
                                        }}>
                                            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Chưa làm</div>
                                            <div style={{ fontSize: 32, fontWeight: 900 }}>{tasksOnDay.filter(t => t.status === 'pending').length}</div>
                                            <div style={{ fontSize: 13, opacity: 0.85 }}>⏳ chờ xử lý</div>
                                        </div>
                                    </div>

                                    {/* Tasks Section */}
                                    {tasksOnDay.length > 0 && (
                                        <div style={{
                                            background: selectedIsMissingDailyReport ? '#fff1f0' : '#fff',
                                            border: selectedIsMissingDailyReport ? '1px solid #ffccc7' : 'none',
                                            borderRadius: 20,
                                            padding: 24,
                                            boxShadow: selectedIsMissingDailyReport
                                                ? '0 8px 24px rgba(207,19,34,0.12)'
                                                : '0 8px 24px rgba(0,0,0,0.08)'
                                        }}>
                                            <h3 style={{
                                                marginBottom: 20,
                                                fontSize: 18,
                                                fontWeight: 800,
                                                color: '#2c3e50',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 10
                                            }}>
                                                <span style={{ fontSize: 24 }}>📋</span>
                                                Công việc ({tasksOnDay.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                                {tasksOnDay.map(task => (
                                                    <div key={task.id} style={{
                                                        padding: 20,
                                                        background: task.status === 'completed'
                                                            ? 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)'
                                                            : 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
                                                        border: 'none',
                                                        borderRadius: 16,
                                                        boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                                                        transition: 'all 0.3s ease',
                                                        cursor: 'pointer'
                                                    }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.transform = 'translateY(-4px)';
                                                            e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.15)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.transform = 'translateY(0)';
                                                            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)';
                                                        }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{
                                                                    fontSize: 16,
                                                                    fontWeight: 700,
                                                                    marginBottom: 10,
                                                                    color: '#2c3e50',
                                                                    textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 8
                                                                }}>
                                                                    <span style={{ fontSize: 20 }}>
                                                                        {task.status === 'completed' ? '✅' : '⏳'}
                                                                    </span>
                                                                    {task.title}
                                                                </div>
                                                                {task.description && (
                                                                    <div style={{ fontSize: 14, color: '#555', marginBottom: 12, lineHeight: 1.6 }}>
                                                                        {task.description}
                                                                    </div>
                                                                )}
                                                                <Space size={10} wrap>
                                                                    <div style={{
                                                                        background: 'rgba(102, 126, 234, 0.15)',
                                                                        color: '#667eea',
                                                                        padding: '4px 12px',
                                                                        borderRadius: 20,
                                                                        fontSize: 12,
                                                                        fontWeight: 700
                                                                    }}>
                                                                        {task.category}
                                                                    </div>
                                                                    <div style={{
                                                                        background: task.priority === 'urgent' ? 'rgba(255, 77, 79, 0.15)' :
                                                                            task.priority === 'high' ? 'rgba(250, 140, 22, 0.15)' :
                                                                                task.priority === 'normal' ? 'rgba(24, 144, 255, 0.15)' : 'rgba(140,140,140,0.15)',
                                                                        color: task.priority === 'urgent' ? '#ff4d4f' :
                                                                            task.priority === 'high' ? '#fa8c16' :
                                                                                task.priority === 'normal' ? '#1890ff' : '#8c8c8c',
                                                                        padding: '4px 12px',
                                                                        borderRadius: 20,
                                                                        fontSize: 12,
                                                                        fontWeight: 700
                                                                    }}>
                                                                        {task.priority === 'urgent' ? '🔥 Khẩn cấp' :
                                                                            task.priority === 'high' ? '⚡ Cao' :
                                                                                task.priority === 'normal' ? '📋 Bình thường' : '💤 Thấp'}
                                                                    </div>
                                                                    <div style={{
                                                                        background: 'rgba(0,0,0,0.06)',
                                                                        color: '#555',
                                                                        padding: '4px 12px',
                                                                        borderRadius: 20,
                                                                        fontSize: 12,
                                                                        fontWeight: 600,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 6
                                                                    }}>
                                                                        <UserOutlined style={{ fontSize: 11 }} />
                                                                        {task.assignee}
                                                                    </div>
                                                                    <div style={{
                                                                        background: 'rgba(0,0,0,0.06)',
                                                                        color: '#555',
                                                                        padding: '4px 12px',
                                                                        borderRadius: 20,
                                                                        fontSize: 12,
                                                                        fontWeight: 600,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 6
                                                                    }}>
                                                                        <ClockCircleOutlined style={{ fontSize: 11 }} />
                                                                        {task.dueTime}
                                                                    </div>
                                                                </Space>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* History Section */}
                                    {historyOnDay.length > 0 && (
                                        <div style={{
                                            background: '#fff',
                                            borderRadius: 20,
                                            padding: 24,
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
                                        }}>
                                            <h3 style={{
                                                marginBottom: 20,
                                                fontSize: 18,
                                                fontWeight: 800,
                                                color: '#2c3e50',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 10
                                            }}>
                                                <span style={{ fontSize: 24 }}>📜</span>
                                                Lịch sử hoạt động ({historyOnDay.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                {historyOnDay.map((h, idx) => (
                                                    <div key={idx} style={{
                                                        padding: 16,
                                                        background: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%)',
                                                        border: 'none',
                                                        borderRadius: 12,
                                                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#2c3e50' }}>
                                                                    {getHistoryDescription(h)}
                                                                </div>
                                                                <Space size={8} wrap>
                                                                    <span style={{ fontSize: 12, color: '#666', fontWeight: 500 }}>
                                                                        🕐 {dayjs(h.timestamp).format('HH:mm:ss')}
                                                                    </span>
                                                                    <span style={{ fontSize: 12, color: '#999' }}>•</span>
                                                                    <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
                                                                        👤 Thực hiện: {h.assignee}
                                                                    </span>
                                                                    {h.verifier && (
                                                                        <>
                                                                            <span style={{ fontSize: 12, color: '#999' }}>•</span>
                                                                            <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>
                                                                                ✅ Xác nhận: {h.verifier}
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </Space>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Missing Daily Report State */}
                                    {tasksOnDay.length === 0 && historyOnDay.length === 0 && selectedIsMissingDailyReport && (
                                        <div style={{
                                            background: '#fff1f0',
                                            border: '1px solid #ffccc7',
                                            borderRadius: 20,
                                            padding: 60,
                                            textAlign: 'center',
                                            boxShadow: '0 8px 24px rgba(207,19,34,0.12)'
                                        }}>
                                            <div style={{ fontSize: 64, marginBottom: 16, color: '#cf1322' }}>
                                                <WarningOutlined />
                                            </div>
                                            <div style={{ fontSize: 18, fontWeight: 700, color: '#cf1322', marginBottom: 8 }}>
                                                Chưa ghi nhận công việc hằng ngày
                                            </div>
                                            <div style={{ fontSize: 14, color: '#8c8c8c' }}>
                                                Ngày làm việc đã qua nhưng chưa có lịch sử hoàn thành công việc.
                                            </div>
                                        </div>
                                    )}

                                    {/* Empty State */}
                                    {tasksOnDay.length === 0 && historyOnDay.length === 0 && !selectedIsMissingDailyReport && (
                                        <div style={{
                                            background: '#fff',
                                            borderRadius: 20,
                                            padding: 60,
                                            textAlign: 'center',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.08)'
                                        }}>
                                            <div style={{ fontSize: 64, marginBottom: 16 }}>📭</div>
                                            <div style={{ fontSize: 18, fontWeight: 700, color: '#666', marginBottom: 8 }}>
                                                Không có hoạt động
                                            </div>
                                            <div style={{ fontSize: 14, color: '#999' }}>
                                                Chưa có công việc hoặc lịch sử nào trong ngày này
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}
            </Modal>

        </div>
    );
};

export default DailyTasks;

