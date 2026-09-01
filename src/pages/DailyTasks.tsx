import { useState, useEffect, useCallback, useDeferredValue, useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
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
    Dropdown,
    Modal,
    Form,
    Input,
    InputNumber,
    message,
    DatePicker,
    Calendar,
    TimePicker,
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
    SearchOutlined,
    PictureOutlined,
    EyeOutlined,
    SafetyCertificateOutlined,
    MoreOutlined,
    FlagOutlined,
    MessageOutlined,
    SendOutlined,
    HistoryOutlined,
    InfoCircleOutlined,
    LeftOutlined,
    RightOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
    getFixedVietnamHolidayName,
    isDailyReportRestDay,
    isPastDailyReportWorkingDay,
} from '../lib/workCalendar';
import './DailyTasks.css';
import AlertPopup, { AlertPopupItem } from '../components/AlertPopup';

const AssignmentDeadlinePicker = ({
    value,
    onChange,
}: {
    value?: dayjs.Dayjs;
    onChange?: (value: dayjs.Dayjs) => void;
}) => {
    const currentValue = value?.isValid() ? value : dayjs().hour(19).minute(0).second(0).millisecond(0);

    const handleDateChange = (date: dayjs.Dayjs | null) => {
        if (!date) return;
        onChange?.(
            date
                .hour(currentValue.hour())
                .minute(currentValue.minute())
                .second(0)
                .millisecond(0)
        );
    };

    const handleTimeChange = (time: dayjs.Dayjs | null) => {
        if (!time) return;
        onChange?.(
            currentValue
                .hour(time.hour())
                .minute(time.minute())
                .second(0)
                .millisecond(0)
        );
    };

    return (
        <div className="assignment-deadline-picker">
            <label>
                <span>Ngày hoàn thành</span>
                <DatePicker
                    value={currentValue}
                    format="DD/MM/YYYY"
                    allowClear={false}
                    inputReadOnly
                    onChange={handleDateChange}
                    placeholder="Chọn ngày"
                />
            </label>
            <label>
                <span>Giờ hoàn thành</span>
                <TimePicker
                    value={currentValue}
                    format="HH:mm"
                    allowClear={false}
                    inputReadOnly
                    needConfirm={false}
                    minuteStep={1}
                    onChange={handleTimeChange}
                    placeholder="Chọn giờ"
                />
            </label>
        </div>
    );
};


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
    createdAt?: string;
    status: 'pending' | 'completed';
    tags?: string[];
    description?: string;
    note?: string;
    type?: 'daily' | 'assignment';
    attachments?: unknown;
    penaltyDueKey?: string;
    evidencePenaltyRecorded?: boolean;
    evidencePenaltyCount?: number;
}

interface EvidenceImage {
    name: string;
    mimeType: string;
    storage?: 'r2';
    r2Key?: string;
    storagePath?: string;
    driveUrl?: string;
    hash: string;
}

interface EvidenceMeta {
    required?: boolean;
    method?: 'link' | 'image' | 'both';
    status?: 'pending' | 'submitted' | 'approved' | 'rejected';
    penaltyAmount?: number;
    submittedAt?: string;
    submittedBy?: string;
    submittedUrl?: string;
    submittedImage?: EvidenceImage;
    submittedImages?: EvidenceImage[];
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

const getEvidence = (task: Task): EvidenceMeta => {
    const evidence = parseAttachments(task.attachments).evidence || {};
    // Handover tasks are proof-required by policy. Keep the renderer safe when
    // an older client returns an assignment without the newer evidence block.
    if (task.type === 'assignment' && task.status !== 'completed') {
        return {
            ...evidence,
            required: true,
            method: evidence.method || 'image',
            status: evidence.status || 'pending',
            penaltyAmount: evidence.penaltyAmount || getAssignmentDeadlinePenalty(task),
        };
    }
    return evidence;
};

const mergeHistoryEvidence = (taskEvidence: EvidenceMeta, eventEvidence?: EvidenceMeta): EvidenceMeta => {
    if (!eventEvidence) return taskEvidence;
    const eventImages = eventEvidence.submittedImages?.length
        ? eventEvidence.submittedImages
        : eventEvidence.submittedImage ? [eventEvidence.submittedImage] : [];
    const taskImages = taskEvidence.submittedImages?.length
        ? taskEvidence.submittedImages
        : taskEvidence.submittedImage ? [taskEvidence.submittedImage] : [];
    const submittedImages = eventImages.length > 0 ? eventImages : taskImages;
    return {
        ...taskEvidence,
        ...eventEvidence,
        submittedImage: undefined,
        submittedImages,
    };
};

const DEFAULT_EVIDENCE_PENALTY = 30000;
const DEADLINE_OVERDUE_FINE_OFFICIAL = 50000;
const getAssignmentDeadlinePenalty = (task: Task): number => {
    const value = Number(parseAttachments(task.attachments).assignment?.deadlinePenaltyAmount);
    return Number.isFinite(value) && value >= 0 ? value : DEADLINE_OVERDUE_FINE_OFFICIAL;
};
const getNextAssignmentEvidencePenalty = (task: Task) => {
    if (task.type !== 'assignment' || !getEvidence(task).required || task.status === 'completed') return null;
    const penaltyCount = Number(task.evidencePenaltyCount || 0);
    if (penaltyCount < 1) return null;

    const nextCycle = penaltyCount + 1;
    const dueAt = dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm');
    if (!dueAt.isValid()) return null;
    const createdAt = task.createdAt ? dayjs(task.createdAt) : null;
    const scheduleAnchor = createdAt?.isValid() && createdAt.isAfter(dueAt)
        ? createdAt.hour(dueAt.hour()).minute(dueAt.minute()).second(dueAt.second()).millisecond(0)
        : dueAt;

    return {
        cycle: nextCycle,
        deadline: scheduleAnchor.add(penaltyCount, 'day'),
        amount: getAssignmentDeadlinePenalty(task) * nextCycle,
    };
};
const getAssignmentRecipients = (task: Task): string[] => {
    const recipients = parseAttachments(task.attachments).assignment?.assignees;
    return Array.isArray(recipients) && recipients.length > 0
        ? [...new Set(recipients.map((name: unknown) => String(name || '').trim()).filter(Boolean))]
        : [task.assignee].filter(Boolean);
};
const DAILY_EVIDENCE_DEADLINE = '23:59';

const normalizePenaltyAmount = (value: unknown): number => {
    const raw = typeof value === 'string' ? value.replace(/[^\d]/g, '') : value;
    const amount = Number(raw);
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : DEFAULT_EVIDENCE_PENALTY;
};

const formatPenaltyAmount = (value: string | number | undefined): string => {
    if (value === undefined || value === null || value === '') return '';
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(normalizePenaltyAmount(value));
};

const getDailyRotationAnchor = () => dayjs().format('YYYY-MM-DD');

const TARGET_EVIDENCE_IMAGE_BYTES = 200 * 1024;
const MAX_EVIDENCE_IMAGE_BYTES = 500 * 1024;
const MAX_EVIDENCE_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_EVIDENCE_IMAGES = 5;

const getEvidenceImageMimeType = (file: File): string | null => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file.type;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    return null;
};

const getDriveImageUrl = (url: string) => {
    const fileId = url.match(/[-\w]{25,}/)?.[0];
    // Drive's download endpoint sends Content-Disposition: attachment in
    // Electron. The thumbnail endpoint returns image content for <img>.
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w2000` : url;
};

const compressEvidenceImage = async (file: File): Promise<File> => {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('Không thể đọc ảnh.'));
            element.src = sourceUrl;
        });
        let width = Math.min(image.naturalWidth, 1920);
        let height = Math.round(image.naturalHeight * (width / image.naturalWidth));
        let fallback: Blob | null = null;

        // Continue reducing extreme screenshots/photos instead of rejecting
        // them while a usable proof image can still be produced.
        while (width >= 160 && height >= 120) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Không thể xử lý ảnh trên thiết bị này.');
            context.drawImage(image, 0, 0, width, height);
            for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.34, 0.25]) {
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
                if (blob && blob.size <= TARGET_EVIDENCE_IMAGE_BYTES) {
                    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
                }
                if (blob && blob.size < MAX_EVIDENCE_IMAGE_BYTES && (!fallback || blob.size < fallback.size)) fallback = blob;
            }
            width = Math.round(width * 0.7);
            height = Math.round(height * 0.7);
        }
        if (fallback) {
            return new File([fallback], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
        }
        throw new Error('Không thể nén ảnh xuống dưới 500 KB. Hãy chọn ảnh rõ nét hơn hoặc cắt bớt ảnh.');
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
    // Tài khoản test có vai trò quản lý mở rộng để kiểm thử toàn bộ luồng công việc.
    const isTestOperator = Boolean(user?.isTestAccount);
    const canReviewEvidence = user?.role === 'admin' || user?.role === 'manager' || isTestOperator;
    const isAssignmentRecipient = useCallback((task: Task) => {
        if (isTestOperator) return true;
        const currentUserNames = [user?.username, user?.fullName]
            .map(name => String(name || '').trim().toLowerCase())
            .filter(Boolean);
        return getAssignmentRecipients(task).some(assignee =>
            currentUserNames.includes(String(assignee || '').trim().toLowerCase())
        );
    }, [isTestOperator, user?.fullName, user?.username]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [categories, setCategories] = useState(CATEGORIES);
    const [editingCategory, setEditingCategory] = useState<any>(null);
    const [categoryModalVisible, setCategoryModalVisible] = useState(false);
    const [categoryForm] = Form.useForm();

    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [taskModalVisible, setTaskModalVisible] = useState(false);
    const [taskForm] = Form.useForm();
    const [assignmentMode, setAssignmentMode] = useState<'fixed' | 'daily'>('fixed');
    const [loading, setLoading] = useState(false);
    const [isSavingTask, setIsSavingTask] = useState(false);
    const taskSaveInFlightRef = useRef(false);

    // Quick note state for assignment cards
    const [quickNotes, setQuickNotes] = useState<Record<number, string>>({});
    const [showNoteInput, setShowNoteInput] = useState<Record<number, boolean>>({});

    // Assignee management
    const [assigneeList, setAssigneeList] = useState<string[]>([]);
    const [rotationAssigneeList, setRotationAssigneeList] = useState<string[]>([]);
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
                        .filter((u: any) =>
                            u?.username &&
                            u.username !== 'admin' &&
                            u.isActive !== false &&
                            u.operationalAssignee !== false
                        )
                        .map((u: any) => String(u.username).trim())
                        .filter(Boolean)
                        .sort((a: string, b: string) => a.localeCompare(b, 'vi'));
                    setAssigneeList(usernames);
                    const attendanceResult = await window.electronAPI.appConfig.get('attendanceData');
                    const officialUsernames = Array.isArray(attendanceResult.data?.employees)
                        ? attendanceResult.data.employees
                            .filter((employee: any) => employee?.type === 'Official')
                            .map((employee: any) => String(employee.username || '').trim())
                            .filter(Boolean)
                        : [];
                    setRotationAssigneeList(officialUsernames.filter((username: string) => usernames.includes(username)));
                } else {
                    const defaults = ['Khánh', 'Toàn', 'Phượng'];
                    setAssigneeList([]);
                    setRotationAssigneeList([]);
                    
                }

                // Load categories from DB
                const catResult = await window.electronAPI.appConfig.get('dailyTasksCategories');
                if (catResult.success && catResult.data) {
                    setCategories(catResult.data);
                } else {
                    // Lưu default categories vào DB lần đầu
                    const saveResult = await window.electronAPI.dailyTasks.saveCategories(CATEGORIES, null);
                    if (!saveResult?.success) {
                        console.warn('Không thể lưu danh mục mặc định:', saveResult?.error);
                    }
                }
            } catch (error) {
                console.error('Error loading config:', error);
            }
        })();
    }, []);

    const saveAssigneeList = async (requestedList: string[]) => {
        const usersResult = await window.electronAPI.users.getAll();
        if (!usersResult.success || !usersResult.data) {
            throw new Error(usersResult.error || 'Không thể tải danh sách nhân viên.');
        }
        const usernames = usersResult.data
            .filter((u: any) =>
                u?.username &&
                u.username !== 'admin' &&
                u.isActive !== false &&
                u.operationalAssignee !== false
            )
            .map((u: any) => String(u.username).trim())
            .filter(Boolean)
            .sort((a: string, b: string) => a.localeCompare(b, 'vi'));
        const invalidName = requestedList.find(name => !usernames.includes(name));
        if (invalidName) {
            throw new Error(`"${invalidName}" chưa có tài khoản nhân viên hoạt động. Hãy tạo tài khoản trước.`);
        }
        const omittedUser = usernames.find(name => !requestedList.includes(name));
        if (omittedUser) {
            throw new Error(`Không thể xóa "${omittedUser}" tại đây. Hãy cập nhật trạng thái tài khoản nhân viên.`);
        }
        setAssigneeList(usernames);
        return usernames;
    };

    const trySaveAssigneeList = async (requestedList: string[]) => {
        try {
            await saveAssigneeList(requestedList);
            return true;
        } catch (error: any) {
            message.error(error?.message || 'Không thể cập nhật danh sách người thực hiện.');
            return false;
        }
    };

    const saveCategories = async (cats: typeof CATEGORIES) => {
        const result = await window.electronAPI.dailyTasks.saveCategories(cats, categories);
        if (!result?.success) throw new Error(result?.error || 'Không thể lưu danh mục công việc.');
        setCategories(result.data || cats);
        return result.data || cats;
    };

    // History state
    const [activeTab, setActiveTab] = useState<'tasks' | 'triage' | 'assignments' | 'history'>('triage');
    const [boardFilter, setBoardFilter] = useState<'all' | 'action' | 'evidence' | 'overdue'>('all');
    const [taskSearch, setTaskSearch] = useState('');
    const [taskSort, setTaskSort] = useState<'priority' | 'deadline'>('priority');
    const [deadlineViewFilter, setDeadlineViewFilter] = useState<'pending' | 'completed' | 'all'>('pending');
    const [handoverSearch, setHandoverSearch] = useState('');
    const [handoverStatusFilter, setHandoverStatusFilter] = useState<'pending' | 'overdue' | 'warning' | 'completed'>('pending');
    const [history, setHistory] = useState<any[]>([]);
    const [historySnapshots, setHistorySnapshots] = useState<Record<string, { tasks?: any[] }>>({});
    const [selectedWorkDate, setSelectedWorkDate] = useState(dayjs());
    const [workDatePickerOpen, setWorkDatePickerOpen] = useState(false);

    useEffect(() => {
        const openAssignments = () => setActiveTab('assignments');
        if (window.sessionStorage.getItem('dailyTasks.openTab') === 'assignments') {
            window.sessionStorage.removeItem('dailyTasks.openTab');
            openAssignments();
        }
        window.addEventListener('daily-tasks:open-assignments', openAssignments);
        return () => window.removeEventListener('daily-tasks:open-assignments', openAssignments);
    }, []);
    useEffect(() => {
        if (activeTab === 'history' || activeTab === 'triage' || !selectedWorkDate.isSame(dayjs(), 'day')) {
            void loadHistory();
        }
    }, [activeTab, selectedWorkDate]);

    const [showTaskActionGuide, setShowTaskActionGuide] = useState(false);
    const hasShownRowActionHintRef = useRef(false);
    const evidenceImageUrlCacheRef = useRef(new Map<string, { url: string; expiresAt: number }>());

    const dismissTaskActionGuide = () => {
        setShowTaskActionGuide(false);
    };

    const handleTaskRowClick = (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, input, textarea, .ant-select, .ant-dropdown')) return;
        if (hasShownRowActionHintRef.current) return;

        hasShownRowActionHintRef.current = true;
        setShowTaskActionGuide(true);
    };

    // === ASSIGNMENT TASKS ===
    const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
    const [editingAssignment, setEditingAssignment] = useState<Task | null>(null);
    const [assignmentForm] = Form.useForm();
    const [assignmentNoteExpanded, setAssignmentNoteExpanded] = useState(false);
    const [selectedAssignmentAssignees, setSelectedAssignmentAssignees] = useState<string[]>([]);
    const [isSavingAssignment, setIsSavingAssignment] = useState(false);
    const assignmentSaveInFlightRef = useRef(false);
    const [, forceUpdate] = useState(0); // for countdown re-render
    const updateAssignmentAssignees = (nextAssignees: string[]) => {
        setSelectedAssignmentAssignees(nextAssignees);
        assignmentForm.setFieldsValue({ assignees: nextAssignees });
        forceUpdate(value => value + 1);
    };
    const toggleAssignmentAssignee = (name: string) => {
        updateAssignmentAssignees(
            selectedAssignmentAssignees.includes(name)
                ? selectedAssignmentAssignees.filter((item: string) => item !== name)
                : [...selectedAssignmentAssignees, name]
        );
    };
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
        // Show task cards first; reset/history work can finish in the background.
        void loadTasks();
        let maintenanceRefreshTimer: number | undefined;
        const resetForCurrentDay = async () => {
            // 🔄 Reset daily tasks nếu sang ngày mới
            try {
                const resetResult = await window.electronAPI.dailyTasks.resetDaily();
                if (!resetResult.success) {
                    message.error(resetResult.error || 'Không thể reset công việc sang ngày mới.');
                    return;
                }
                const dayChanged = Boolean(resetResult.success && resetResult.data?.dayChanged);
                if (dayChanged) {
                    setSelectedWorkDate(current =>
                        current.isSame(dayjs().subtract(1, 'day'), 'day')
                            ? dayjs().startOf('day')
                            : current
                    );
                }
                if (resetResult.success && (dayChanged || resetResult.data?.reset || resetResult.data?.deadlineNormalized)) {
                    await loadTasks();
                }
                if (resetResult.success) {
                    if (maintenanceRefreshTimer !== undefined) window.clearTimeout(maintenanceRefreshTimer);
                    maintenanceRefreshTimer = window.setTimeout(() => {
                        void applyEvidencePenalties();
                    }, 4000);
                }
                if (resetResult.success && resetResult.data?.reset) {
                    message.info({
                        content: `🔄 Sang ngày mới! Đã reset ${resetResult.data.resetCount} công việc về chưa hoàn thành.`,
                        duration: 4
                    });
                }
            } catch (err) {
                console.log('Daily reset skipped:', err);
            }
        };

        void resetForCurrentDay();

        let midnightTimer: number | undefined;
        const scheduleMidnightReset = () => {
            const nextDay = dayjs().add(1, 'day').startOf('day').add(1, 'second');
            midnightTimer = window.setTimeout(async () => {
                setSelectedWorkDate(current =>
                    current.isSame(dayjs().subtract(1, 'day'), 'day')
                        ? dayjs().startOf('day')
                        : current
                );
                await resetForCurrentDay();
                scheduleMidnightReset();
            }, Math.max(1000, nextDay.diff(dayjs())));
        };
        scheduleMidnightReset();

        return () => {
            if (midnightTimer !== undefined) window.clearTimeout(midnightTimer);
            if (maintenanceRefreshTimer !== undefined) window.clearTimeout(maintenanceRefreshTimer);
        };
    }, []);

    const applyEvidencePenalties = async () => {
        try {
            const penaltiesResult = await window.electronAPI.dailyTasks.listEvidencePenalties();
            const penaltiesByTaskDeadline = new Map<string, any[]>();
            (penaltiesResult?.success && Array.isArray(penaltiesResult.data) ? penaltiesResult.data : [])
                .forEach((penalty: any) => {
                    const key = `${penalty.taskId}:${penalty.dueAt}`;
                    penaltiesByTaskDeadline.set(key, [...(penaltiesByTaskDeadline.get(key) || []), penalty]);
                });

            setTasks(prev => prev.map(task => {
                const penalties = penaltiesByTaskDeadline.get(`${task.id}:${task.penaltyDueKey}`) || [];
                return {
                    ...task,
                    evidencePenaltyRecorded: penalties.length > 0,
                    evidencePenaltyCount: Math.max(0, ...penalties.map((penalty: any) => Number(penalty.cycle) || 1)),
                };
            }));
        } catch (error) {
            console.error('Error loading evidence penalties:', error);
        }
    };

    const loadTasks = async () => {
        try {
            setLoading(true);
            // Reset and reconciliation run independently on page entry. Task
            // cards should not wait for the full maintenance scan.
            const result = await window.electronAPI.dailyTasks.list({ maintenance: false });
            if (result.success && result.data) {
                setTasks(result.data.map((t: any) => ({
                    ...t,
                    evidencePenaltyRecorded: false,
                    evidencePenaltyCount: 0,
                    tags: t.tags ? JSON.parse(t.tags) : [],
                    attachments: parseAttachments(t.attachments),
                    // Daily tasks keep the same ID across days, so retain the
                    // original deadline for matching only that day's penalty.
                    penaltyDueKey: new Date(t.dueDate).toISOString(),
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
        // Penalty badges are supplemental. Do not hold back the task cards.
        void applyEvidencePenalties();
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

            const pendingAssignments = tasks.filter(task =>
                task.type === 'assignment' && task.status !== 'completed' && isAssignmentRecipient(task)
            );
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
    }, [tasks, acknowledgedTasks, addAlertPopup, isAssignmentRecipient]);

    // === CONTINUOUS ALARM: còi hú + beep liên tục mỗi 5 giây khi ≤ 10 phút ===
    useEffect(() => {
        const alarmInterval = setInterval(() => {
            const now = dayjs();
            const urgentTasks = tasks.filter(t => {
                if (t.type !== 'assignment' || t.status === 'completed') return false;
                if (!isAssignmentRecipient(t)) return false;
                if (acknowledgedTasks.has(t.id)) return false;
                const deadline = dayjs(`${t.dueDate} ${t.dueTime}`, 'YYYY-MM-DD HH:mm');
                const diff = deadline.diff(now, 'minute');
                return diff >= 0 && diff <= 10;
            });
            if (urgentTasks.length > 0) playUrgentBeeps(5);
        }, 5000);
        return () => clearInterval(alarmInterval);
    }, [tasks, acknowledgedTasks, isAssignmentRecipient]);

    // Request notification permission on mount
    useEffect(() => {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Assignment task handlers
    const handleAddAssignment = () => {
        setEditingAssignment(null);
        setAssignmentNoteExpanded(false);
        setSelectedAssignmentAssignees([]);
        assignmentForm.resetFields();
        assignmentForm.setFieldsValue({
            priority: 'normal',
            deadline: dayjs().hour(19).minute(0).second(0).millisecond(0),
            deadlinePenaltyAmount: DEADLINE_OVERDUE_FINE_OFFICIAL,
            evidenceRequired: true,
            evidencePenaltyAmount: DEFAULT_EVIDENCE_PENALTY,
            recurrenceDays: 0,
            assignees: [],
        });
        setAssignmentModalVisible(true);
    };

    const handleEditAssignment = (task: Task) => {
        setEditingAssignment(task);
        setAssignmentNoteExpanded(Boolean(task.note));
        const assignmentRecipients = parseAttachments(task.attachments).assignment?.assignees;
        setSelectedAssignmentAssignees(Array.isArray(assignmentRecipients) && assignmentRecipients.length > 0
            ? assignmentRecipients
            : [task.assignee].filter(Boolean));
        assignmentForm.setFieldsValue({
            title: task.title,
            description: task.description,
            assignee: task.assignee,
            priority: task.priority,
            deadline: dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm'),
            deadlinePenaltyAmount: getAssignmentDeadlinePenalty(task),
            evidenceRequired: getEvidence(task).required || false,
            evidencePenaltyAmount: normalizePenaltyAmount(getEvidence(task).penaltyAmount),
            recurrenceDays: Number(parseAttachments(task.attachments).assignment?.recurrenceDays) || 0,
            note: task.note || '',
        });
        setAssignmentModalVisible(true);
    };

    const handleSaveAssignment = async () => {
        if (assignmentSaveInFlightRef.current) return;
        assignmentSaveInFlightRef.current = true;
        setIsSavingAssignment(true);
        try {
            const values = await assignmentForm.validateFields();
            const assignees = Array.from(new Set(selectedAssignmentAssignees));
            if (assignees.length === 0) {
                message.error('Chọn ít nhất một người thực hiện.');
                return;
            }
            const invalidAssignees = assignees.filter((assignee: string) => !assigneeList.includes(assignee));
            if (invalidAssignees.length > 0) {
                message.error(`Người nhận không hợp lệ hoặc chưa active: ${invalidAssignees.join(', ')}`);
                return;
            }
            const existingAttachments = editingAssignment ? parseAttachments(editingAssignment.attachments) : {};
            const existingEvidence = existingAttachments.evidence || {};
            const assignmentPenaltyAmount = normalizePenaltyAmount(values.deadlinePenaltyAmount);
            const recurrenceDays = Math.max(0, Math.min(365, Math.floor(Number(values.recurrenceDays) || 0)));
            const taskData: any = {
                title: values.title,
                description: values.description || '',
                priority: values.priority,
                dueDate: values.deadline.toISOString(),
                type: 'assignment',
                category: 'Bàn giao',
                note: values.note || '',
                attachments: {
                    ...existingAttachments,
                    assignment: {
                        ...existingAttachments.assignment,
                        fixedAssignee: true,
                        assignees,
                        // Bàn giao yêu cầu bằng chứng uses this one base fine
                        // for the first miss and each subsequent escalation.
                        deadlinePenaltyAmount: assignmentPenaltyAmount,
                        evidencePenaltyAmount: assignmentPenaltyAmount,
                        recurrenceDays,
                    },
                    evidence: {
                        ...existingEvidence,
                        required: true,
                        method: 'image',
                        status: existingEvidence.status || 'pending',
                        penaltyAmount: assignmentPenaltyAmount,
                    },
                },
            };

            let result;
            if (editingAssignment) {
                result = await window.electronAPI.dailyTasks.update(editingAssignment.id, { ...taskData, assignee: assignees[0] });
                if (result.success) message.success('Đã cập nhật!');
            } else {
                const createAssignments = window.electronAPI.dailyTasks.createAssignments;
                if (typeof createAssignments === 'function') {
                    result = await createAssignments({ ...taskData, status: 'pending' }, assignees);
                } else {
                    // The Electron preload updates only after an app restart. Keep the
                    // current window usable while preserving all-or-nothing creation.
                    const groupId = `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                    const groupedTaskData = {
                        ...taskData,
                        status: 'pending',
                        attachments: {
                            ...taskData.attachments,
                            assignment: {
                                ...taskData.attachments.assignment,
                                groupId,
                                assignees,
                            },
                        },
                    };
                    result = await window.electronAPI.dailyTasks.create({
                        ...groupedTaskData,
                        assignee: assignees[0],
                    });
                }
                if (result.success) message.success(`Đã giao việc cho ${assignees.length} người.`);
            }
            if (!result.success) throw new Error(result.error || 'Không thể lưu bàn giao.');
            setAssignmentModalVisible(false);
            assignmentForm.resetFields();
            setEditingAssignment(null);
            setSelectedAssignmentAssignees([]);
            loadTasks();
        } catch (error: any) {
            message.error('Lỗi: ' + (error.message || ''));
        } finally {
            assignmentSaveInFlightRef.current = false;
            setIsSavingAssignment(false);
        }
    };

    const handleCompleteAssignment = async (taskId: number) => {
        try {
            const task = tasks.find(item => item.id === taskId);
            const evidence = task ? getEvidence(task) : {};
            if (task && evidence.required && evidence.status !== 'approved') {
                if (evidence.status === 'submitted') {
                    message.info('Bằng chứng đã nộp, đang chờ quản lý duyệt.');
                } else {
                    handleSubmitEvidence(task);
                }
                return;
            }
            if (!isAdmin) {
                const request = await window.electronAPI.dailyTasks.requestAssignmentCompletion(taskId);
                if (!request.success) throw new Error(request.error || 'Không thể báo hoàn thành bàn giao.');
                message.success('Đã báo hoàn thành. Đang chờ quản lý xác nhận.');
                window.dispatchEvent(new CustomEvent('task-changed'));
                loadTasks();
                return;
            }
            const result = await window.electronAPI.dailyTasks.completeAssignment(taskId);
            if (!result.success) throw new Error(result.error || 'Không thể hoàn thành bàn giao.');
            message.success('✅ Đã hoàn thành!');
            window.dispatchEvent(new CustomEvent('task-changed'));
            loadTasks();
        } catch (e: any) {
            message.error('Lỗi: ' + e.message);
        }
    };

    const handleDeleteAssignment = (taskId: number) => {
        Modal.confirm({
            title: 'Xóa vĩnh viễn công việc bàn giao?',
            content: 'Công việc bàn giao và các dữ liệu phạt phát sinh riêng từ công việc này sẽ bị xóa. Bạn có thể tạo lại công việc sau, nhưng thao tác này không thể hoàn tác.',
            okText: 'Xóa vĩnh viễn', okType: 'danger', cancelText: 'Hủy',
            onOk: async () => {
                const result = await window.electronAPI.dailyTasks.deleteAssignment(taskId);
                if (!result?.success) {
                    message.warning(result?.error || 'Không thể xóa công việc bàn giao.');
                    return;
                }
                message.success('Đã xóa vĩnh viễn công việc bàn giao.');
                window.dispatchEvent(new CustomEvent('task-changed'));
                await loadTasks();
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
                    const result = await window.electronAPI.dailyTasks.addNote(task.id, newLog.note);
                    if (!result?.success) throw new Error(result?.error || 'Không thể lưu ghi chú.');
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
            const result = await window.electronAPI.dailyTasks.addNote(task.id, newLog.note);
            if (!result?.success) throw new Error(result?.error || 'Không thể lưu ghi chú.');
            message.success('Đã thêm ghi chú!');
            setQuickNotes(prev => ({ ...prev, [task.id]: '' }));
            setShowNoteInput(prev => ({ ...prev, [task.id]: false }));
            loadTasks();
        } catch (e: any) {
            message.error('Lỗi: ' + e.message);
        }
    };

    // Filter tasks by type
    const isSelectedRestDay = isDailyReportRestDay(selectedWorkDate);
    const dailyTasks = isSelectedRestDay ? [] : tasks.filter(t => !t.type || t.type === 'daily');
    const assignmentTasks = tasks.filter(t => t.type === 'assignment').filter((task, _index, all) => {
        const groupId = parseAttachments(task.attachments).assignment?.groupId;
        if (!groupId) return true;
        const groupedTasks = all.filter(item => parseAttachments(item.attachments).assignment?.groupId === groupId);
        return (groupedTasks.find(item => item.status !== 'completed') || groupedTasks[0]) === task;
    });
    const pendingAssignments = assignmentTasks.filter(t => t.status !== 'completed');
    const overdueAssignments = assignmentTasks.filter(t => getDeadlineStatus(t).status === 'overdue');

    const loadHistory = async () => {
        try {
            const selectedDateKey = selectedWorkDate.format('YYYY-MM-DD');
            const [historyResult, snapshotResult] = await Promise.all([
                window.electronAPI.appConfig.get('dailyTasksHistory'),
                window.electronAPI.appConfig.get(`dailyTasksSnapshot:${selectedDateKey}`),
            ]);
            if (historyResult.success && Array.isArray(historyResult.data)) {
                setHistory(historyResult.data);
            }
            if (snapshotResult.success) {
                setHistorySnapshots(previous => ({
                    ...previous,
                    [selectedDateKey]: snapshotResult.data || {},
                }));
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
                        if (activeTab === 'history' || activeTab === 'triage') await loadHistory();

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
                        const result = await window.electronAPI.dailyTasks.reopen(taskId);
                        if (!result.success) throw new Error(result.error || 'Không thể mở lại công việc.');
                        setTasks(prev => prev.map(t =>
                            t.id === taskId
                                ? { ...t, ...result.data, status: 'pending', attachments: parseAttachments(result.data?.attachments) }
                                : t
                        ));
                        message.success({
                            content: '⚠️ Đã hủy hoàn thành!',
                            duration: 2
                        });
                        if (activeTab === 'history' || activeTab === 'triage') await loadHistory();
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
                            const result = await window.electronAPI.dailyTasks.delete(task.id);
                            if (!result?.success) throw new Error(result?.error || `Không thể xóa công việc #${task.id}.`);
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
                        const result = await window.electronAPI.dailyTasks.delete(task.id);
                        if (!result?.success) throw new Error(result?.error || `Không thể xóa công việc #${task.id}.`);
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
        setAssignmentMode('fixed');
        taskForm.resetFields();

        // ⚡ Set data TRƯỚC
        taskForm.setFieldsValue({
            priority: 'normal',
            category: categoryKey || categories[0]?.key || 'Sàn TMDT',
            status: 'pending',
            evidenceRequired: false,
            assignmentMode: 'fixed',
            rotationAssignees: [],
            penaltyAmount: DEFAULT_EVIDENCE_PENALTY,
            evidenceDeadlineTime: DAILY_EVIDENCE_DEADLINE,
            dueDate: dayjs().endOf('day')
        });

        // ✅ Mở modal SAU
        setTaskModalVisible(true);
    };

    // Edit task
    const handleEditTask = (task: Task) => {
        setEditingTask(task);
        const assignment = parseAttachments(task.attachments).assignment || {};
        const rotationAssignees = Array.isArray(assignment.dailyRotation?.assignees)
            ? assignment.dailyRotation.assignees
            : Array.isArray(assignment.weeklyRotation?.assignees)
                ? assignment.weeklyRotation.assignees
            : [];
        const mode: 'fixed' | 'daily' = rotationAssignees.length > 0 ? 'daily' : 'fixed';
        setAssignmentMode(mode);
        taskForm.setFieldsValue({
            ...task,
            dueDate: dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm'),
            tags: task.tags ? task.tags.join(', ') : '',
            evidenceRequired: getEvidence(task).required || false,
            assignmentMode: mode,
            rotationAssignees,
            penaltyAmount: normalizePenaltyAmount(getEvidence(task).penaltyAmount),
            evidenceDeadlineTime: DAILY_EVIDENCE_DEADLINE,
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
                    } else {
                        throw new Error(result.error || 'Không thể xóa công việc.');
                    }
                } catch (error: any) {
                    message.error('Lỗi: ' + (error.message || 'Unknown error'));
                }
            }
        });
    };

    // Save task
    const handleSaveTask = async () => {
        if (taskSaveInFlightRef.current) return;
        taskSaveInFlightRef.current = true;
        setIsSavingTask(true);

        try {
            const values = await taskForm.validateFields();

            const existingAttachments = editingTask ? parseAttachments(editingTask.attachments) : {};
            const existingEvidence = editingTask ? getEvidence(editingTask) : {};
            const existingAssignment = existingAttachments.assignment || {};
            // Only administrators decide how a task is completed and whether a penalty applies.
            const requiresEvidence = isAdmin ? Boolean(values.evidenceRequired) : Boolean(existingEvidence.required);
            const selectedAssignmentMode: 'fixed' | 'daily' = values.assignmentMode === 'daily' ? 'daily' : 'fixed';
            const rotationAssignees = Array.isArray(values.rotationAssignees) ? values.rotationAssignees : [];
            if (selectedAssignmentMode === 'fixed' && !values.assignee) {
                message.error('Vui lòng chọn người thực hiện.');
                return;
            }
            const hasEvidenceAssignee = selectedAssignmentMode === 'daily'
                ? rotationAssignees.length >= 2
                : selectedAssignmentMode === 'fixed' && Boolean(values.assignee);
            if (requiresEvidence && !hasEvidenceAssignee) {
                message.error('Công việc yêu cầu bằng chứng phải cố định người thực hiện để hệ thống phạt đúng người.');
                return;
            }
            // Every daily task closes at the end of its selected date. The
            // Electron handler enforces the same rule for older clients.
            const dueAt = dayjs(values.dueDate).endOf('day');
            const taskData = {
                title: values.title,
                description: values.description || '',
                category: values.category,
                assignee: selectedAssignmentMode === 'fixed'
                    ? values.assignee || ''
                    : selectedAssignmentMode === 'daily' ? rotationAssignees[0] || '' : '',
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
                        ...existingAssignment,
                        fixedAssignee: selectedAssignmentMode === 'fixed',
                        dailyRotation: selectedAssignmentMode === 'daily' ? {
                            assignees: rotationAssignees,
                            anchorDate: existingAssignment.dailyRotation?.anchorDate || getDailyRotationAnchor(),
                        } : undefined,
                        weeklyRotation: undefined,
                    },
                    evidence: requiresEvidence ? {
                        ...existingEvidence,
                        required: true,
                        method: 'image',
                        submittedUrl: undefined,
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
            } else {
                result = await window.electronAPI.dailyTasks.create(taskData);
            }

            if (!result.success) throw new Error(result.error || 'Không thể lưu công việc.');

            message.success(editingTask ? 'Đã cập nhật task!' : 'Đã thêm task mới!');
            setTaskModalVisible(false);
            taskForm.resetFields();
            setEditingTask(null);
            await loadTasks();
        } catch (error: any) {
            message.error('Lỗi: ' + (error.message || 'Unknown error'));
        } finally {
            taskSaveInFlightRef.current = false;
            setIsSavingTask(false);
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
        } catch (error: any) {
            console.error('Validation error:', error);
            message.error(error?.message || 'Không thể lưu danh mục.');
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
        // Daily work is due at the end of its date. Do not turn 23:59 into
        // 23:59:00 here, otherwise the UI marks it overdue one minute early.
        const dueTime = dayjs(task.dueDate).endOf('day');
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

    const handleSubmitEvidence = (task: Task) => {
        let selectedImages: File[] = [];

        Modal.confirm({
            title: 'Nộp bằng chứng',
            icon: <UploadOutlined style={{ color: '#16a34a' }} />,
            content: (
                <div>
                    <p style={{ marginBottom: 12, color: '#475569' }}><strong>{task.title}</strong></p>
                    <div>
                        <Upload
                            accept="image/png,image/jpeg,image/webp"
                            multiple
                            maxCount={MAX_EVIDENCE_IMAGES}
                            beforeUpload={(file) => {
                                if (selectedImages.length >= MAX_EVIDENCE_IMAGES) {
                                    message.warning(`Chỉ được chọn tối đa ${MAX_EVIDENCE_IMAGES} ảnh.`);
                                    return Upload.LIST_IGNORE;
                                }
                                selectedImages = [...selectedImages, file as unknown as File];
                                return false;
                            }}
                            onRemove={(file) => {
                                selectedImages = selectedImages.filter(image => (image as any).uid !== file.uid);
                                return true;
                            }}
                        >
                            <Button icon={<UploadOutlined />}>Chọn ảnh từ máy</Button>
                        </Upload>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                            Tối đa {MAX_EVIDENCE_IMAGES} ảnh JPG, PNG hoặc WebP. Ảnh gốc tối đa 15 MB, ưu tiên nén khoảng 100–200 KB và luôn dưới 500 KB trước khi tải lên R2.
                        </div>
                    </div>
                </div>
            ),
            okText: 'Gửi bằng chứng', cancelText: 'Hủy',
            onOk: async () => {
                if (selectedImages.length === 0) {
                    message.warning('Vui lòng chọn ảnh bằng chứng từ máy.');
                    return Promise.reject();
                }
                const invalidImage = selectedImages.find(image => !getEvidenceImageMimeType(image) || image.size > MAX_EVIDENCE_SOURCE_BYTES);
                if (invalidImage) {
                    message.warning(`Ảnh "${invalidImage.name}" phải là JPG, PNG hoặc WebP và không vượt quá 15 MB.`);
                    return Promise.reject();
                }
                try {
                    const sourceBytes = selectedImages.reduce((total, image) => total + image.size, 0);
                    const images = [];
                    for (let index = 0; index < selectedImages.length; index += 1) {
                        const selectedImage = selectedImages[index];
                        message.loading({ key: 'evidence-upload', content: `Đang nén ảnh ${index + 1}/${selectedImages.length}...`, duration: 0 });
                        const compressedImage = await compressEvidenceImage(selectedImage);
                        if (compressedImage.size >= MAX_EVIDENCE_IMAGE_BYTES) {
                            throw new Error(`Ảnh "${selectedImage.name}" sau nén vượt quá 500 KB.`);
                        }
                        const data = await new Promise<string>((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(String(reader.result));
                            reader.onerror = () => reject(new Error('Không thể đọc ảnh.'));
                            reader.readAsDataURL(compressedImage);
                        });
                        images.push({ name: compressedImage.name, mimeType: compressedImage.type, data, size: compressedImage.size });
                    }
                    message.loading({ key: 'evidence-upload', content: 'Đang tải bằng chứng lên hệ thống...', duration: 0 });
                    const result = await window.electronAPI.dailyTasks.submitEvidence({
                        taskId: task.id,
                        images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data })),
                    });
                    if (!result.success) {
                        if (result.reauthRequired) {
                            Modal.error({
                                title: 'Cần kết nối lại Google Drive',
                                content: result.error || 'Phiên Google Drive trên máy này đã hết hạn. Vui lòng liên hệ admin để kết nối lại rồi gửi bằng chứng.',
                                okText: 'Đã hiểu',
                            });
                        }
                        const submitError: any = new Error(result.error || 'Không thể lưu bằng chứng');
                        submitError.alreadyPresented = Boolean(result.reauthRequired);
                        throw submitError;
                    }
                    await loadTasks();
                    if (activeTab === 'history' || activeTab === 'triage') await loadHistory();
                    const uploadedBytes = images.reduce((total, image) => total + image.size, 0);
                    message.success({
                        key: 'evidence-upload',
                        content: `Đã nộp ${images.length} ảnh (${(sourceBytes / 1024 / 1024).toFixed(1)} MB → ${(uploadedBytes / 1024).toFixed(0)} KB) và tự động hoàn thành công việc.`,
                        duration: 5,
                    });
                } catch (error: any) {
                    if (error?.alreadyPresented) {
                        message.destroy('evidence-upload');
                    } else {
                        message.error({ key: 'evidence-upload', content: error.message || 'Không thể gửi bằng chứng.', duration: 5 });
                    }
                    return Promise.reject(error);
                }
            }
        });
    };

    const handleReviewEvidence = async (task: Task, approved: boolean) => {
        try {
            const result = await window.electronAPI.dailyTasks.reviewEvidence(task.id, approved);
            if (!result.success) throw new Error(result.error || 'Không thể duyệt bằng chứng.');
            await loadTasks();
            if (activeTab === 'history' || activeTab === 'triage') await loadHistory();
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
                                {/* Tasks must be assigned by an administrator. */}
                                {task.assignee && (
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

    const openEvidence = async (task: Task, evidenceOverride?: EvidenceMeta) => {
        const evidence = evidenceOverride || getEvidence(task);
        const submittedImages = evidence.submittedImages?.length
            ? evidence.submittedImages
            : evidence.submittedImage ? [evidence.submittedImage] : [];

        const imageKey = (image: EvidenceImage) => image.r2Key || image.storagePath || image.driveUrl || image.hash || image.name || '';
        const getCachedImageUrl = (key: string) => {
            const cached = evidenceImageUrlCacheRef.current.get(key);
            if (!cached) return '';
            if (cached.expiresAt <= Date.now()) {
                evidenceImageUrlCacheRef.current.delete(key);
                return '';
            }
            return cached.url;
        };
        const cacheImageUrl = (key: string, url: string) => {
            const cache = evidenceImageUrlCacheRef.current;
            cache.delete(key);
            // Drive previews are data URLs and do not expire; Supabase URLs do.
            cache.set(key, {
                url,
                expiresAt: Date.now() + (url.startsWith('data:') ? 30 : 4) * 60 * 1000,
            });
            while (cache.size > 50) {
                const oldestKey = cache.keys().next().value;
                if (!oldestKey) break;
                cache.delete(oldestKey);
            }
        };
        const renderEvidence = (
            images: Array<EvidenceImage & { url: string }>,
            loading: boolean,
            errors: string[] = [],
        ) => (
            <div>
                <p style={{ marginBottom: 8 }}><strong>{task.title}</strong></p>
                {images.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                        {images.map((image, index) => (
                            <a key={imageKey(image) || String(index)} href={image.url} target="_blank" rel="noreferrer" title={image.name}>
                                <img
                                    src={image.url}
                                    alt={`Bằng chứng ${index + 1}`}
                                    loading="eager"
                                    fetchPriority="high"
                                    decoding="async"
                                    onError={() => message.warning(`Không thể hiển thị ảnh: ${image.name || `Bằng chứng ${index + 1}`}`)}
                                    style={{ display: 'block', width: '100%', height: 520, objectFit: 'contain', borderRadius: 8, background: '#f8fafc' }}
                                />
                            </a>
                        ))}
                    </div>
                )}
                {loading && (
                    <div style={{ minHeight: images.length ? 44 : 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                        Đang tải ảnh bằng chứng…
                    </div>
                )}
                {!loading && errors.length > 0 && (
                    <div style={{ minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
                        {errors.length === submittedImages.length
                            ? errors[0] || 'Không thể tải ảnh bằng chứng.'
                            : `${errors.length} ảnh không thể tải. Vui lòng thử lại.`}
                    </div>
                )}
                {!loading && submittedImages.length === 0 && 'Nhân viên chưa nộp bằng chứng.'}
                {evidence.submittedAt && <p style={{ marginTop: 12, color: '#64748b' }}>Đã nộp lúc {dayjs(evidence.submittedAt).format('DD/MM/YYYY HH:mm')}</p>}
            </div>
        );

        const cachedImages = submittedImages.flatMap(image => {
            const url = getCachedImageUrl(imageKey(image));
            return url ? [{ ...image, url }] : [];
        });
        const loadedByKey = new Map(cachedImages.map(image => [imageKey(image), image]));
        const failedByKey = new Map<string, string>();
        let modalActive = true;
        const updateModal = (loading: boolean) => {
            if (!modalActive) return;
            const images = submittedImages.flatMap(image => {
                const loaded = loadedByKey.get(imageKey(image));
                return loaded ? [loaded] : [];
            });
            modal.update({
                content: renderEvidence(images, loading, Array.from(failedByKey.values())),
            });
        };
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const unsubscribeDriveProgress = window.electronAPI.dailyTasks.onDriveEvidenceImageLoaded(({ requestId: responseId, result }) => {
            if (responseId !== requestId || !modalActive) return;
            const image = submittedImages.find(item => item.driveUrl === result.driveUrl);
            if (!image) return;
            const key = imageKey(image);
            if (result.success && result.data?.url) {
                cacheImageUrl(key, result.data.url);
                loadedByKey.set(key, { ...image, url: result.data.url });
                failedByKey.delete(key);
            } else {
                failedByKey.set(key, result.error || 'Không thể tải ảnh bằng chứng.');
            }
            updateModal(loadedByKey.size + failedByKey.size < submittedImages.length);
        });
        const modal = Modal.info({
            title: 'Bằng chứng công việc',
            width: 980,
            content: renderEvidence(cachedImages, cachedImages.length < submittedImages.length),
            okText: 'Đóng',
            afterClose: () => {
                modalActive = false;
                unsubscribeDriveProgress();
            },
        });
        if (submittedImages.length === 0 || cachedImages.length === submittedImages.length) return;

        const missingImages = submittedImages.filter(image => !getCachedImageUrl(imageKey(image)));
        const r2Images = missingImages.filter(image => Boolean(image.r2Key));
        const driveImages = missingImages.filter(image => !image.r2Key && Boolean(image.driveUrl));
        const legacyImages = missingImages.filter(image => !image.r2Key && !image.driveUrl && Boolean(image.storagePath));
        const driveRequest = driveImages.length > 0
            ? window.electronAPI.dailyTasks.getDriveEvidenceImageUrls(
                task.id,
                driveImages.map(image => ({ driveUrl: image.driveUrl!, mimeType: image.mimeType })),
                requestId,
            )
            : Promise.resolve(null);
        const r2Request = r2Images.length > 0
            ? window.electronAPI.dailyTasks.getR2EvidenceImageUrls(
                task.id,
                r2Images.map(image => ({ r2Key: image.r2Key!, mimeType: image.mimeType })),
            )
            : Promise.resolve(null);
        const legacyRequests = legacyImages.map(async image => {
            const key = imageKey(image);
            const result = await window.electronAPI.dailyTasks.getEvidenceImageUrl(task.id, image.storagePath);
            if (result.success && result.data?.url) {
                cacheImageUrl(key, result.data.url);
                loadedByKey.set(key, { ...image, url: result.data.url });
            } else {
                failedByKey.set(key, result.error || 'Không thể tải ảnh bằng chứng.');
            }
            updateModal(loadedByKey.size + failedByKey.size < submittedImages.length);
        });
        const [driveResult, r2Result] = await Promise.all([
            driveRequest,
            r2Request,
            Promise.allSettled(legacyRequests),
        ]);
        if (r2Result?.success && r2Result.data?.results) {
            r2Result.data.results.forEach(result => {
                const image = r2Images.find(item => item.r2Key === result.r2Key);
                if (!image) return;
                const key = imageKey(image);
                if (result.success && result.data?.url) {
                    cacheImageUrl(key, result.data.url);
                    loadedByKey.set(key, { ...image, url: result.data.url });
                    failedByKey.delete(key);
                } else {
                    failedByKey.set(key, result.error || 'Không thể tải ảnh bằng chứng từ R2.');
                }
            });
        } else if (r2Result && !r2Result.success) {
            r2Images.forEach(image => failedByKey.set(
                imageKey(image),
                r2Result.error || 'Không thể tải ảnh bằng chứng từ R2.',
            ));
        }
        if (driveResult?.success && driveResult.data?.results) {
            driveResult.data.results.forEach(result => {
                const image = driveImages.find(item => item.driveUrl === result.driveUrl);
                if (!image) return;
                const key = imageKey(image);
                if (result.success && result.data?.url) {
                    cacheImageUrl(key, result.data.url);
                    loadedByKey.set(key, { ...image, url: result.data.url });
                    failedByKey.delete(key);
                } else {
                    failedByKey.set(key, result.error || 'Không thể tải ảnh bằng chứng.');
                }
            });
        } else if (driveResult && !driveResult.success) {
            driveImages.forEach(image => failedByKey.set(
                imageKey(image),
                driveResult.error || 'Không thể tải ảnh bằng chứng.',
            ));
        }
        updateModal(false);
        if (loadedByKey.size === 0 && failedByKey.size > 0) {
            message.error(Array.from(failedByKey.values())[0] || 'Không thể tải ảnh bằng chứng.');
        }
    };

    const OperationalTaskCard = ({ task, lane }: { task: Task; lane: 'today' | 'evidence' | 'review' }) => {
        const evidence = getEvidence(task);
        const overdue = isOverdue(task);
        const isEvidenceTask = evidence.required;
        const evidenceMethodMeta = { label: 'Ảnh tải lên', icon: <PictureOutlined />, color: '#7c3aed' };
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
                                    {lane === 'review' && evidence.status === 'submitted' && canReviewEvidence && <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => handleReviewEvidence(task, true)} style={{ background: '#16a34a', borderColor: '#16a34a' }}>Duyệt</Button>}
                                    {lane === 'review' && evidence.status === 'submitted' && canReviewEvidence && <Button size="small" danger onClick={() => handleReviewEvidence(task, false)}>Từ chối</Button>}
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

    const HandoverTaskCard = ({ task }: { task: Task }) => {
        const deadline = getDeadlineStatus(task);
        const notes = parseNotes(task.note);
        const completed = task.status === 'completed';
        const completionRequest = parseAttachments(task.attachments).assignment?.completionRequestedAt;
        const canComplete = isAdmin || (isAssignmentRecipient(task) && !completionRequest);
        const latestNote = notes.length > 0 ? notes[notes.length - 1] : null;
        const stateColor = completed ? '#16a34a' : deadline.status === 'overdue' ? '#ef4444' : deadline.status === 'warning' ? '#d97706' : '#7c3aed';
        const stateBg = completed ? '#ecfdf5' : deadline.status === 'overdue' ? '#fff1f2' : deadline.status === 'warning' ? '#fffbeb' : '#f5f3ff';
        const stateBorder = completed ? '#bbf7d0' : deadline.status === 'overdue' ? '#fecdd3' : deadline.status === 'warning' ? '#fde68a' : '#ddd6fe';
        const stateLabel = completed ? 'Đã hoàn thành' : deadline.label;

        return (
            <div style={{
                background: '#fff',
                border: `1px solid ${stateBorder}`,
                borderLeft: `4px solid ${stateColor}`,
                borderRadius: 8,
                padding: 14,
                marginTop: 10,
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
            }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        color: stateColor,
                        background: stateBg,
                        border: `1px solid ${stateBorder}`,
                    }}>
                        <CheckCircleOutlined />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 15,
                                    fontWeight: 750,
                                    lineHeight: 1.35,
                                    color: completed ? '#64748b' : '#0f172a',
                                    textDecoration: completed ? 'line-through' : 'none',
                                }}>
                                    {task.title}
                                </div>
                                {task.description && <div style={{ color: '#64748b', fontSize: 13, marginTop: 5, lineHeight: 1.45 }}>{task.description}</div>}
                            </div>
                            <Tag style={{
                                margin: 0,
                                color: stateColor,
                                background: stateBg,
                                borderColor: stateBorder,
                                fontWeight: 700,
                                borderRadius: 999,
                                paddingInline: 10,
                                whiteSpace: 'nowrap',
                            }}>
                                {stateLabel}
                            </Tag>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: '#334155',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: 999,
                                padding: '3px 9px',
                            }}>
                                <UserOutlined style={{ fontSize: 12 }} /> {getAssignmentRecipients(task).join(', ') || 'Chưa phân công'}
                            </span>
                            <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: completed ? '#64748b' : stateColor,
                                background: stateBg,
                                border: `1px solid ${stateBorder}`,
                                borderRadius: 999,
                                padding: '3px 9px',
                                fontWeight: 650,
                            }}>
                                <ClockCircleOutlined style={{ fontSize: 12 }} /> {deadline.label}
                            </span>
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            marginTop: 12,
                            paddingTop: 10,
                            borderTop: '1px solid #eef2f7',
                        }}>
                            <div style={{
                                minWidth: 0,
                                color: latestNote ? '#475569' : '#94a3b8',
                                fontSize: 12,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {latestNote ? `Ghi chú: ${latestNote.note}` : 'Chưa có ghi chú'}
                            </div>
                            <Space size={2} style={{ flexShrink: 0 }}>
                                {!completed && canComplete && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleCompleteAssignment(task.id)} style={{ background: '#16a34a', borderColor: '#16a34a', borderRadius: 6, fontWeight: 650 }}>{isAdmin ? 'Hoàn thành' : 'Báo hoàn thành'}</Button>}
                                <Button size="small" type="text" onClick={() => handleNoteAssignment(task)} style={{ fontWeight: 600 }}>Ghi chú</Button>
                                {isAdmin && <Tooltip title="Sửa bàn giao"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEditAssignment(task)} aria-label="Sửa bàn giao" /></Tooltip>}
                                {isAdmin && <Tooltip title="Xóa bàn giao"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteAssignment(task.id)} aria-label="Xóa bàn giao" /></Tooltip>}
                            </Space>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const OperationalColumn = ({ title, count, color, icon, tasks: laneTasks, lane, handoverTasks = [] }: { title: string; count: number; color: string; icon: ReactNode; tasks: Task[]; lane: 'today' | 'evidence' | 'review'; handoverTasks?: Task[] }) => {
        if (count < 0) return null;
        const sortByDeadline = (left: Task, right: Task) =>
            dayjs(`${left.dueDate} ${left.dueTime}`).valueOf() - dayjs(`${right.dueDate} ${right.dueTime}`).valueOf();
        const filteredTasks = laneTasks.filter(task => taskMatchesBoardFilter(task, lane));
        const visibleTasks = [
            ...filteredTasks.filter(task => getEvidence(task).required).sort(sortByDeadline),
            ...filteredTasks.filter(task => !getEvidence(task).required).sort(sortByDeadline),
        ];
        const visibleHandovers = handoverTasks
            .filter(task => {
                const deadline = getDeadlineStatus(task);
                if (boardFilter === 'all') return true;
                if (boardFilter === 'action') return task.status !== 'completed' && deadline.status !== 'overdue';
                return boardFilter === 'overdue' && deadline.status === 'overdue';
            })
            .sort(sortByDeadline);
        const isHandoverColumn = handoverTasks.length > 0 && laneTasks.length === 0;

        if (isHandoverColumn) {
            const getStateMeta = (task: Task) => {
                const deadline = getDeadlineStatus(task);
                if (task.status === 'completed') {
                    return { key: 'completed', label: 'Đã hoàn thành', color: '#16a34a', bg: '#ecfdf5', border: '#bbf7d0' };
                }
                if (deadline.status === 'overdue') {
                    return { key: 'overdue', label: deadline.label, color: '#ef4444', bg: '#fff1f2', border: '#fecdd3' };
                }
                if (deadline.status === 'warning') {
                    return { key: 'warning', label: deadline.label, color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
                }
                return { key: 'normal', label: deadline.label, color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' };
            };
            const normalizedSearch = handoverSearch.trim().toLowerCase();
            const handoverRows = handoverTasks
                .filter(task => {
                    const meta = getStateMeta(task);
                    if (handoverStatusFilter === 'pending' && task.status === 'completed') return false;
                    if (handoverStatusFilter !== 'pending' && meta.key !== handoverStatusFilter) return false;
                    if (!normalizedSearch) return true;
                    return [task.title, task.description, task.assignee, task.note]
                        .filter(Boolean)
                        .some(value => String(value).toLowerCase().includes(normalizedSearch));
                })
                .sort(sortByDeadline);
            const statusCounts = handoverTasks.reduce((acc, task) => {
                const meta = getStateMeta(task);
                acc[meta.key] = (acc[meta.key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            const pendingHandoverCount = handoverTasks.filter(task => task.status !== 'completed').length;

            return <section style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 10, padding: 16, minWidth: 760, flex: 1, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                    <span style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 8, background: '#f5f3ff', color, fontSize: 20, border: '1px solid #ddd6fe' }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{title}</h2>
                        <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Danh sách bàn giao</div>
                    </div>
                    <Input
                        allowClear
                        prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                        placeholder="Tìm kiếm công việc bàn giao..."
                        value={handoverSearch}
                        onChange={event => setHandoverSearch(event.target.value)}
                        style={{ width: 320, borderRadius: 6 }}
                    />
                    <Select
                        value={handoverStatusFilter}
                        onChange={value => setHandoverStatusFilter(value)}
                        style={{ width: 170 }}
                        options={[
                            { value: 'pending', label: `Công việc chờ (${pendingHandoverCount})` },
                            { value: 'overdue', label: `Quá hạn (${statusCounts.overdue || 0})` },
                            { value: 'warning', label: `Sắp đến hạn (${statusCounts.warning || 0})` },
                            { value: 'completed', label: `Đã hoàn thành (${statusCounts.completed || 0})` },
                        ]}
                    />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[
                        ['pending', 'Công việc chờ', pendingHandoverCount],
                        ['overdue', 'Quá hạn', statusCounts.overdue || 0],
                        ['warning', 'Sắp đến hạn', statusCounts.warning || 0],
                        ['completed', 'Đã hoàn thành', statusCounts.completed || 0],
                    ].map(([key, label, itemCount]) => (
                        <Button
                            key={String(key)}
                            size="small"
                            onClick={() => setHandoverStatusFilter(key as typeof handoverStatusFilter)}
                            style={{
                                height: 32,
                                borderRadius: 6,
                                fontWeight: 700,
                                color: handoverStatusFilter === key ? '#059669' : '#475569',
                                borderColor: handoverStatusFilter === key ? '#86efac' : '#dbe3ec',
                                background: handoverStatusFilter === key ? '#ecfdf5' : '#fff',
                            }}
                        >
                            {label} <Badge count={itemCount as number} style={{ marginLeft: 6, backgroundColor: '#f1f5f9', color: '#475569', boxShadow: 'none' }} />
                        </Button>
                    ))}
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(280px, 1.35fr) minmax(130px, 0.55fr) minmax(160px, 0.7fr) minmax(220px, 1fr) minmax(140px, 0.55fr)',
                        gap: 12,
                        alignItems: 'center',
                        padding: '11px 14px',
                        background: '#f8fafc',
                        color: '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                    }}>
                        <div>Công việc bàn giao</div>
                        <div>Người phụ trách</div>
                        <div>Hạn hoàn thành</div>
                        <div>Ghi chú mới nhất</div>
                        <div style={{ textAlign: 'right' }}>Thao tác</div>
                    </div>
                    {handoverRows.map(task => {
                        const meta = getStateMeta(task);
                        const notes = parseNotes(task.note);
                        const latestNote = notes.length > 0 ? notes[notes.length - 1] : null;
                        const completed = task.status === 'completed';
                        const completionRequest = parseAttachments(task.attachments).assignment?.completionRequestedAt;
                        const canComplete = isAdmin || (isAssignmentRecipient(task) && !completionRequest);
                        return (
                            <div key={task.id} style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(280px, 1.35fr) minmax(130px, 0.55fr) minmax(160px, 0.7fr) minmax(220px, 1fr) minmax(140px, 0.55fr)',
                                gap: 12,
                                alignItems: 'center',
                                minHeight: 66,
                                padding: '12px 14px',
                                borderTop: '1px solid #eef2f7',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                    <span style={{ width: 4, alignSelf: 'stretch', minHeight: 36, borderRadius: 999, background: meta.color }} />
                                    <span style={{ color: meta.color, fontSize: 17, display: 'inline-flex' }}>
                                        {completed ? <CheckCircleFilled /> : <CheckCircleOutlined />}
                                    </span>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ color: completed ? '#64748b' : '#0f172a', fontWeight: 750, fontSize: 14, lineHeight: 1.35, textDecoration: completed ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {task.title}
                                        </div>
                                        {task.description && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</div>}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <Avatar size={24} style={{ flexShrink: 0, backgroundColor: getAvatarColor(task.assignee || '?'), fontSize: 11, fontWeight: 700 }}>
                                        {(task.assignee || '?').slice(0, 1).toUpperCase()}
                                    </Avatar>
                                    <span style={{ color: '#334155', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.assignee || 'Chưa phân công'}</span>
                                </div>
                                <div>
                                    <div style={{ color: '#334155', fontSize: 13, fontWeight: 650 }}>
                                        {dayjs(`${task.dueDate} ${task.dueTime}`, 'YYYY-MM-DD HH:mm').format('DD/MM/YYYY HH:mm')}
                                    </div>
                                    <Tag style={{ marginTop: 4, color: meta.color, background: meta.bg, borderColor: meta.border, borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                                        {meta.label}
                                    </Tag>
                                </div>
                                <div style={{ color: latestNote ? '#475569' : '#94a3b8', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {latestNote ? latestNote.note : '-'}
                                </div>
                                <Space size={4} style={{ justifyContent: 'flex-end', width: '100%' }}>
                                    <Button size="small" onClick={() => handleNoteAssignment(task)} style={{ borderRadius: 6, fontWeight: 600 }}>
                                        Ghi chú
                                    </Button>
                                    {!completed && canComplete && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleCompleteAssignment(task.id)} style={{ background: '#16a34a', borderColor: '#16a34a', borderRadius: 6 }} />}
                                    {isAdmin && <Tooltip title="Sửa bàn giao"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => handleEditAssignment(task)} aria-label="Sửa bàn giao" /></Tooltip>}
                                    {isAdmin && <Tooltip title="Xóa bàn giao"><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteAssignment(task.id)} aria-label="Xóa bàn giao" /></Tooltip>}
                                </Space>
                            </div>
                        );
                    })}
                    {handoverRows.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có công việc bàn giao" style={{ padding: 56 }} />}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', fontSize: 13, marginTop: 12 }}>
                    <span>Hiển thị {handoverRows.length} / {handoverTasks.length} công việc</span>
                    <span style={{ color: '#059669', fontWeight: 700 }}>{pendingAssignments.length} đang chờ hoàn thành</span>
                </div>
            </section>;
        }

        return <section style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 10, padding: 16, minWidth: 320, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 6, background: isHandoverColumn ? '#f5f3ff' : color, color: isHandoverColumn ? color : '#fff', fontSize: 20, border: isHandoverColumn ? '1px solid #ddd6fe' : 'none' }}>{icon}</span>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#1e293b', flex: 1 }}>{title}</h2>
                <Badge count={count} style={{ backgroundColor: `${color}22`, color, boxShadow: 'none', fontWeight: 700 }} />
                <Tooltip title="Tùy chọn cột"><Button type="text" icon={<MoreOutlined />} /></Tooltip>
            </div>
            <div style={{ minHeight: 430 }}>
                {visibleTasks.map(task => <OperationalTaskCard key={task.id} task={task} lane={lane} />)}
                {visibleHandovers.length > 0 && <div style={{ marginTop: visibleTasks.length ? 16 : 0, paddingTop: visibleTasks.length ? 12 : 0, borderTop: visibleTasks.length ? '1px solid #e2e8f0' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                        <div style={{ color: '#475569', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.3 }}>Danh sách bàn giao</div>
                        <div style={{ color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 750 }}>{visibleHandovers.length} việc</div>
                    </div>
                    {visibleHandovers.map(task => <HandoverTaskCard key={task.id} task={task} />)}
                </div>}
                {visibleTasks.length === 0 && visibleHandovers.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có công việc" style={{ paddingTop: 80 }} />}
            </div>
            <div style={{ textAlign: 'center', color: isHandoverColumn ? '#6d28d9' : '#64748b', background: isHandoverColumn ? '#faf5ff' : '#fff', border: `1px solid ${isHandoverColumn ? '#ede9fe' : '#dbe3ec'}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: isHandoverColumn ? 650 : 400 }}>
                {handoverTasks.length > 0 ? handoverTasks.length : count} công việc
            </div>
        </section>;
    };

    const PriorityWorkspace = ({ scope }: { scope: 'all' | 'daily' | 'deadline' }) => {
        const selectedDateKey = selectedWorkDate.format('YYYY-MM-DD');
        const isCurrentWorkDate = selectedWorkDate.isSame(dayjs(), 'day');
        const snapshotTasks = historySnapshots[selectedDateKey]?.tasks;
        const selectedDailyTasks = isCurrentWorkDate
            ? dailyTasks
            : Array.isArray(snapshotTasks)
                ? snapshotTasks.map((task: any) => ({
                    ...task,
                    type: task.type || 'daily',
                    priority: task.priority || 'normal',
                    dueTime: task.dueTime || dayjs(task.dueDate).format('HH:mm'),
                    dueDate: task.dueDate || selectedDateKey,
                    tags: Array.isArray(task.tags) ? task.tags : [],
                    attachments: parseAttachments(task.attachments),
                } as Task))
                : [];
        const selectedAssignments = isCurrentWorkDate
            ? assignmentTasks
            : assignmentTasks.filter(task => dayjs(task.dueDate).format('YYYY-MM-DD') === selectedDateKey);
        const completedDeadlineCount = selectedAssignments.filter(task => task.status === 'completed').length;
        const visibleDeadlineTasks = deadlineViewFilter === 'all'
            ? selectedAssignments
            : selectedAssignments.filter(task => deadlineViewFilter === 'completed' ? task.status === 'completed' : task.status !== 'completed');
        const unfilteredSourceTasks = scope === 'daily' ? selectedDailyTasks : scope === 'deadline' ? visibleDeadlineTasks : [...selectedDailyTasks, ...selectedAssignments];
        const normalizedTaskSearch = taskSearch.trim().toLocaleLowerCase('vi');
        const sourceTasks = unfilteredSourceTasks.filter(task => {
            if (normalizedTaskSearch && ![task.title, task.assignee, task.category]
                .some(value => String(value || '').toLocaleLowerCase('vi').includes(normalizedTaskSearch))) return false;
            if (boardFilter === 'all') return true;
            if (boardFilter === 'action') return task.status !== 'completed';
            if (boardFilter === 'evidence') {
                const evidence = getEvidence(task);
                return task.status !== 'completed' && evidence.required && evidence.status !== 'approved';
            }
            return task.status !== 'completed' && (task.type === 'assignment' ? getDeadlineStatus(task).status === 'overdue' : isOverdue(task));
        }).sort((left, right) => {
            if (taskSort === 'deadline') {
                const leftDeadline = dayjs(`${left.dueDate || selectedDateKey} ${left.dueTime || '23:59'}`);
                const rightDeadline = dayjs(`${right.dueDate || selectedDateKey} ${right.dueTime || '23:59'}`);
                return leftDeadline.valueOf() - rightDeadline.valueOf();
            }
            const priorityOrder: Record<Task['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 };
            return priorityOrder[left.priority] - priorityOrder[right.priority];
        });
        const pendingTasks = sourceTasks.filter(task => task.status !== 'completed');
        const completedDailyTasks = scope === 'daily' ? sourceTasks.filter(task => task.status === 'completed') : [];
        const completedDeadlineTasks = scope === 'deadline' ? sourceTasks.filter(task => task.status === 'completed') : [];
        const isTaskOverdue = (task: Task) => !isCurrentWorkDate ? false : task.type === 'assignment' ? getDeadlineStatus(task).status === 'overdue' : isOverdue(task);
        const getDailyDeadlineText = (task: Task) => {
            if (!isCurrentWorkDate) return `Hạn ${task.dueTime || DAILY_EVIDENCE_DEADLINE}`;
            const remainingMinutes = dayjs(task.dueDate).endOf('day').diff(dayjs(), 'minute');
            return remainingMinutes < 0
                ? `Quá hạn ${formatTimeDiff(Math.abs(remainingMinutes))}`
                : `Còn ${formatTimeDiff(remainingMinutes)}`;
        };
        const evidenceSoon = (task: Task) => task.type !== 'assignment' && getEvidence(task).required && !isTaskOverdue(task);
        const groups = [
            { key: 'overdue', label: 'Quá hạn', color: '#dc2626', tasks: pendingTasks.filter(isTaskOverdue) },
            { key: 'evidence', label: 'Bằng chứng sắp đến hạn', color: '#d97706', tasks: pendingTasks.filter(evidenceSoon) },
            { key: 'normal', label: 'Bình thường', color: '#64748b', tasks: pendingTasks.filter(task => !isTaskOverdue(task) && !evidenceSoon(task)) },
            ...(completedDailyTasks.length > 0 ? [{ key: 'completed-daily', label: 'Đã hoàn thành', color: '#16a34a', tasks: completedDailyTasks }] : []),
            ...(completedDeadlineTasks.length > 0 ? [{ key: 'completed', label: 'Đã hoàn thành', color: '#16a34a', tasks: completedDeadlineTasks }] : []),
        ].filter(group => group.tasks.length > 0);
        const getOpenRecurrenceInfo = (task: Task) => {
            if (task.type !== 'assignment') return null;
            const assignment = parseAttachments(task.attachments).assignment || {};
            const recurrenceDays = Number(assignment.recurrenceDays) || 0;
            if (recurrenceDays < 1) return null;
            const rootId = String(assignment.recurrenceRootId || task.id);
            const sequence = Number(assignment.recurrenceSequence) || 1;
            const openChain = pendingTasks.filter(candidate => {
                if (candidate.type !== 'assignment') return false;
                const candidateAssignment = parseAttachments(candidate.attachments).assignment || {};
                if ((Number(candidateAssignment.recurrenceDays) || 0) < 1) return false;
                return String(candidateAssignment.recurrenceRootId || candidate.id) === rootId;
            });
            if (openChain.length < 2) return null;
            const latestSequence = Math.max(...openChain.map(candidate => {
                const candidateAssignment = parseAttachments(candidate.attachments).assignment || {};
                return Number(candidateAssignment.recurrenceSequence) || 1;
            }));
            return {
                sequence,
                isCurrent: sequence === latestSequence,
            };
        };
        const hasConcurrentRecurrences = pendingTasks.some(task => Boolean(getOpenRecurrenceInfo(task)));
        const sidebarTaskById = new Map([...selectedDailyTasks, ...selectedAssignments].map(task => [Number(task.id), task]));
        const sidebarEvents = history
            .filter(entry => entry?.timestamp && dayjs(entry.timestamp).format('YYYY-MM-DD') === selectedDateKey)
            .sort((left, right) => dayjs(right.timestamp).valueOf() - dayjs(left.timestamp).valueOf());
        const sidebarEventsByTask = new Map<number, any[]>();
        sidebarEvents.forEach(entry => {
            const taskId = Number(entry.taskId);
            if (!Number.isFinite(taskId)) return;
            sidebarEventsByTask.set(taskId, [...(sidebarEventsByTask.get(taskId) || []), entry]);
        });
        const sidebarHistoryRows = Array.from(sidebarEventsByTask.entries()).map(([taskId, events]) => {
            const latestEvent = events[0];
            const evidenceEvent = events.find(entry => entry?.evidence);
            const task = sidebarTaskById.get(taskId);
            const evidence = mergeHistoryEvidence(task ? getEvidence(task) : {}, evidenceEvent?.evidence);
            const images = evidence.submittedImages?.length
                ? evidence.submittedImages
                : evidence.submittedImage ? [evidence.submittedImage] : [];
            const completed = ['completed', 'daily_reset', 'evidence_approved'].includes(latestEvent.action);
            return {
                taskId,
                task: task || ({
                    id: taskId,
                    title: latestEvent.taskTitle || 'Công việc không tên',
                    category: latestEvent.category || 'Hàng ngày',
                    assignee: latestEvent.assignee || '',
                    verifier: latestEvent.verifier || '',
                    priority: 'normal',
                    dueTime: '',
                    dueDate: selectedDateKey,
                    status: completed ? 'completed' : 'pending',
                    type: 'daily',
                } as Task),
                title: task?.title || latestEvent.taskTitle || 'Công việc không tên',
                assignee: latestEvent.assignee || task?.assignee || 'Chưa phân công',
                time: dayjs(latestEvent.timestamp).format('HH:mm'),
                completed,
                evidence,
                imageCount: images.length,
            };
        }).slice(0, 12);

        const renderRow = (task: Task, color: string) => {
            const evidence = getEvidence(task);
            const isAssignment = task.type === 'assignment';
            const completionRequest = parseAttachments(task.attachments).assignment?.completionRequestedAt;
            const canCompleteAssignment = isAssignment && task.status !== 'completed' && isAdmin;
            const canRequestAssignmentCompletion = isAssignment && task.status !== 'completed' && isAssignmentRecipient(task) && !completionRequest;
            const canSubmitAssignmentEvidence = isAssignment && (isAdmin || isAssignmentRecipient(task));
            const canCompleteDailyTask = !isAssignment && task.status !== 'completed';
            const deadlineText = isAssignment
                ? getDeadlineStatus(task).label
                : getDailyDeadlineText(task);
            const sourceLabel = isAssignment ? 'Bàn giao' : 'Hàng ngày';
            const needsEvidence = evidence.required && evidence.status !== 'submitted' && evidence.status !== 'approved';
            const hasEvidence = evidence.required && (evidence.status === 'submitted' || evidence.status === 'approved');
            const evidencePenaltyRecorded = Boolean(task.evidencePenaltyRecorded);
            const evidencePenaltyAmount = isAssignment ? getAssignmentDeadlinePenalty(task) : evidence.penaltyAmount;
            const nextAssignmentEvidencePenalty = getNextAssignmentEvidencePenalty(task);
            const recurrenceInfo = getOpenRecurrenceInfo(task);
            const adminActions = isAdmin ? (
                <Dropdown
                    trigger={['click']}
                    placement="bottomRight"
                    menu={{
                        items: [
                            { key: 'edit', icon: <EditOutlined />, label: 'Chỉnh sửa' },
                            { type: 'divider' },
                            { key: 'delete', icon: <DeleteOutlined />, label: 'Xóa công việc', danger: true },
                        ],
                        onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            if (key === 'edit') {
                                if (isAssignment) handleEditAssignment(task);
                                else handleEditTask(task);
                            }
                            if (key === 'delete') {
                                if (isAssignment) handleDeleteAssignment(task.id);
                                else handleDeleteTask(task.id);
                            }
                        },
                    }}
                >
                    <Button
                        className="daily-task-overflow-button"
                        size="small"
                        icon={<MoreOutlined />}
                        aria-label="Mở menu công việc"
                        onClick={event => event.stopPropagation()}
                    />
                </Dropdown>
            ) : null;
            return <div
                key={`${task.type}-${task.id}`}
                className="daily-task-list-row"
                onClick={handleTaskRowClick}
                style={{ '--task-row-accent': color } as CSSProperties}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span className="daily-task-status-indicator" aria-hidden="true">
                        {task.status === 'completed'
                            ? <CheckCircleFilled style={{ color: '#16a34a' }} />
                            : <CheckCircleOutlined style={{ color }} />}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                            <div style={{ color: '#172033', fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {task.title}{recurrenceInfo ? (recurrenceInfo.isCurrent ? ' (mới)' : ' (cũ)') : ''}
                            </div>
                            {recurrenceInfo && (
                                <Tooltip title={recurrenceInfo.isCurrent
                                    ? 'Kỳ mới được hệ thống tự sinh theo lịch lặp.'
                                    : 'Kỳ trước vẫn còn vì chưa được hoàn thành.'}>
                                    <Tag style={{ flexShrink: 0, margin: 0, borderRadius: 999, fontSize: 11, fontWeight: 750, color: recurrenceInfo.isCurrent ? '#047857' : '#b91c1c', background: recurrenceInfo.isCurrent ? '#ecfdf5' : '#fef2f2', borderColor: recurrenceInfo.isCurrent ? '#a7f3d0' : '#fecaca' }}>
                                        {recurrenceInfo.isCurrent ? 'Kỳ hiện tại' : `Kỳ trước #${recurrenceInfo.sequence}`}
                                    </Tag>
                                </Tooltip>
                            )}
                        </div>
                        <div style={{ marginTop: 4, color: '#64748b', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><UserOutlined /> {isAssignment ? getAssignmentRecipients(task).join(', ') : (task.assignee || 'Chưa phân công')}</div>
                    </div>
                </div>
                <Tag style={{ width: 'fit-content', margin: 0, color: isAssignment ? '#2563eb' : '#15803d', background: isAssignment ? '#eff6ff' : '#ecfdf5', borderColor: isAssignment ? '#bfdbfe' : '#bbf7d0', fontWeight: 700 }}>{sourceLabel}</Tag>
                <div className={`daily-task-evidence-summary${evidencePenaltyRecorded ? ' daily-task-evidence-escalation' : ''}`} style={{ color: evidence.required ? '#c2410c' : '#64748b' }}>
                    {evidencePenaltyRecorded ? <>
                        <span className="daily-task-evidence-penalty"><WarningOutlined /> Đã phạt lần {task.evidencePenaltyCount}: {formatPenaltyAmount(evidencePenaltyAmount * Number(task.evidencePenaltyCount || 1))}đ</span>
                        {nextAssignmentEvidencePenalty && (
                            <Tooltip title={`Nếu chưa nộp bằng chứng trước mốc này, hệ thống sẽ ghi phạt lần ${nextAssignmentEvidencePenalty.cycle}.`}>
                                <span className="daily-task-evidence-next"><ClockCircleOutlined /> Tiếp: {nextAssignmentEvidencePenalty.deadline.format('HH:mm DD/MM')} · {formatPenaltyAmount(nextAssignmentEvidencePenalty.amount)}đ</span>
                            </Tooltip>
                        )}
                    </> : <span>{evidence.required
                        ? <><UploadOutlined /> Cần bằng chứng {evidencePenaltyAmount ? `· Phạt ${formatPenaltyAmount(evidencePenaltyAmount)}đ` : ''}</>
                        : isAssignment
                            ? <><WarningOutlined /> Phạt trễ deadline {formatPenaltyAmount(getAssignmentDeadlinePenalty(task))}đ</>
                            : 'Không bắt buộc bằng chứng'}</span>}
                </div>
                {isAssignment ? (
                    <Space size={6} className="daily-task-row-actions">
                        <span className={`daily-task-deadline-pill${color === '#dc2626' ? ' is-overdue' : ''}`}><ClockCircleOutlined /> {deadlineText}</span>
                        {needsEvidence && canSubmitAssignmentEvidence && <Button size="small" type="primary" icon={<UploadOutlined />} onClick={() => handleSubmitEvidence(task)} className="daily-task-primary-action">Nộp bằng chứng</Button>}
                        {hasEvidence && <Button size="small" icon={<EyeOutlined />} onClick={() => openEvidence(task)}>Xem bằng chứng</Button>}
                        {evidence.required && evidence.status === 'submitted' && canReviewEvidence && <Tooltip title="Duyệt bằng chứng"><Button type="text" size="small" icon={<SafetyCertificateOutlined />} onClick={() => handleReviewEvidence(task, true)} style={{ color: '#16a34a' }} /></Tooltip>}
                        <Button size="small" onClick={() => handleNoteAssignment(task)} style={{ borderRadius: 6 }}>Ghi chú</Button>
                        {completionRequest && (
                            <Tooltip title={isAdmin
                                ? `Đã báo hoàn thành: ${parseAttachments(task.attachments).assignment?.completionRequestedBy || 'nhân viên'}`
                                : 'Đã báo hoàn thành, chờ quản lý xác nhận'}>
                                <span className="daily-task-completion-request">Đã báo xong</span>
                            </Tooltip>
                        )}
                        {canRequestAssignmentCompletion && !needsEvidence && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleCompleteAssignment(task.id)} className="daily-task-primary-action">Báo hoàn thành</Button>}
                        {canCompleteAssignment && !needsEvidence && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleCompleteAssignment(task.id)} className="daily-task-primary-action">Xác nhận hoàn thành</Button>}
                        {adminActions}
                    </Space>
                ) : (
                    <Space size={6} className="daily-task-row-actions">
                        <span className={`daily-task-deadline-pill${color === '#dc2626' ? ' is-overdue' : ''}`}><ClockCircleOutlined /> {deadlineText}</span>
                        {canCompleteDailyTask && needsEvidence && <Button size="small" type="primary" icon={<UploadOutlined />} onClick={() => handleSubmitEvidence(task)} className="daily-task-primary-action">Nộp bằng chứng</Button>}
                        {hasEvidence && <Button size="small" icon={<EyeOutlined />} onClick={() => openEvidence(task)}>Xem bằng chứng</Button>}
                        {canCompleteDailyTask && !evidence.required && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleToggleComplete(task.id)} className="daily-task-primary-action">Hoàn thành</Button>}
                        {adminActions}
                    </Space>
                )}
            </div>;
        };

        return <div className="daily-tasks-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 370px', gap: 16, alignItems: 'start' }}>
            <section className="daily-tasks-list-panel" style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 8, overflow: 'hidden' }}>
                <div className="daily-tasks-panel-header" style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div><h2 style={{ margin: 0, color: '#172033', fontSize: 18, fontWeight: 800 }}>{scope === 'all' ? (isCurrentWorkDate ? 'Cần xử lý hôm nay' : `Công việc ngày ${selectedWorkDate.format('DD/MM/YYYY')}`) : scope === 'daily' ? 'Hàng ngày' : 'Bàn giao'}</h2><span style={{ color: '#64748b', fontSize: 13 }}>{scope === 'daily' ? `${completedDailyTasks.length} đã hoàn thành · ${pendingTasks.length} đang mở` : scope === 'deadline' && deadlineViewFilter === 'completed' ? `${completedDeadlineCount} công việc đã hoàn thành` : `${pendingTasks.length} công việc đang mở`}</span></div>
                    {scope === 'deadline' ? (
                        <Space size={6} wrap>
                            <Button size="small" type={deadlineViewFilter === 'pending' ? 'primary' : 'default'} onClick={() => setDeadlineViewFilter('pending')} style={{ borderRadius: 6 }}>Đang mở ({selectedAssignments.length - completedDeadlineCount})</Button>
                            <Button size="small" type={deadlineViewFilter === 'completed' ? 'primary' : 'default'} onClick={() => setDeadlineViewFilter('completed')} style={{ borderRadius: 6 }}>Đã hoàn thành ({completedDeadlineCount})</Button>
                            <Button size="small" type={deadlineViewFilter === 'all' ? 'primary' : 'default'} onClick={() => setDeadlineViewFilter('all')} style={{ borderRadius: 6 }}>Tất cả ({selectedAssignments.length})</Button>
                        </Space>
                    ) : <span className="daily-tasks-panel-status">Ưu tiên theo thời hạn và mức độ</span>}
                </div>
                {showTaskActionGuide && pendingTasks.length > 0 && (
                    <div className="daily-task-action-guide" role="status">
                        <span><CheckCircleOutlined /> Chọn <strong>Hoàn thành</strong> hoặc <strong>Nộp bằng chứng</strong> ở cuối dòng. Bấm vào nội dung công việc sẽ không tự xác nhận.</span>
                        <Button type="text" size="small" onClick={dismissTaskActionGuide}>Đã hiểu</Button>
                    </div>
                )}
                {hasConcurrentRecurrences && (
                    <div style={{ padding: '9px 14px', color: '#1d4ed8', background: '#eff6ff', borderBottom: '1px solid #bfdbfe', fontSize: 12.5, fontWeight: 650 }}>
                        <InfoCircleOutlined /> Công việc lặp lại vẫn tự sinh kỳ mới đúng lịch. Kỳ cũ chưa hoàn thành sẽ tiếp tục hiển thị và tiếp tục bị phạt riêng.
                    </div>
                )}
                <div className="daily-task-list-header"><span>Công việc</span><span>Nguồn</span><span>Bằng chứng / phạt</span><span style={{ textAlign: 'right' }}>Thời hạn & thao tác</span></div>
                {groups.map(group => <div key={group.key}><div style={{ padding: '9px 14px', background: group.key === 'overdue' ? '#fef2f2' : group.key === 'evidence' ? '#fff7ed' : '#f8fafc', color: group.color, fontSize: 13, fontWeight: 800 }}>{group.label} ({group.tasks.length})</div>{group.tasks.map(task => renderRow(task, group.color))}</div>)}
                {groups.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isCurrentWorkDate ? 'Không có công việc cần xử lý' : 'Chưa có dữ liệu công việc cho ngày này'} style={{ padding: 60 }} />}
            </section>
            <aside className="daily-tasks-history-panel" style={{ background: '#fff', border: '1px solid #dbe3ec', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '16px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 17, color: '#172033' }}><HistoryOutlined style={{ color: '#059669' }} /> Lịch sử</h2>
                        <div style={{ marginTop: 3, color: '#64748b', fontSize: 12 }}>{selectedWorkDate.format('DD/MM/YYYY')}</div>
                    </div>
                    <Badge count={sidebarHistoryRows.length} showZero style={{ background: '#dcfce7', color: '#15803d', boxShadow: 'none' }} />
                </div>
                <div style={{ maxHeight: 640, overflowY: 'auto' }}>
                    {sidebarHistoryRows.length > 0 ? sidebarHistoryRows.map(row => (
                        <div key={`history-side-${row.taskId}`} style={{ padding: '13px 16px', borderBottom: '1px solid #eef2f7' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ minWidth: 0, fontWeight: 750, color: '#172033', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.title}>{row.title}</div>
                                <time style={{ color: '#64748b', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{row.time}</time>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                                <Tag color={row.completed ? 'green' : 'orange'} style={{ margin: 0 }}>{row.completed ? 'Hoàn thành' : 'Đang xử lý'}</Tag>
                                <span style={{ color: '#64748b', fontSize: 12 }}><UserOutlined /> {row.assignee}</span>
                            </div>
                            <div style={{ marginTop: 8 }}>
                                {row.imageCount > 0 ? (
                                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openEvidence(row.task, row.evidence)} style={{ padding: 0, height: 24, fontWeight: 700 }}>
                                        Xem {row.imageCount} ảnh bằng chứng
                                    </Button>
                                ) : row.evidence.required ? (
                                    <span style={{ color: '#dc2626', fontSize: 12, fontWeight: 650 }}><WarningOutlined /> Thiếu ảnh bằng chứng · bị phạt sau hạn</span>
                                ) : <span style={{ color: '#94a3b8', fontSize: 12 }}>Công việc không yêu cầu bằng chứng</span>}
                            </div>
                        </div>
                    )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lịch sử trong ngày" style={{ padding: 48 }} />}
                </div>
            </aside>
        </div>;
    };

    return (
        <div className="daily-tasks-page" style={{ padding: 24, backgroundColor: '#f0f2f5', minHeight: '100%' }}>
            {false && <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12, borderRadius: 10, padding: '8px 14px' }}
                description={
                    <span>
                        Mỗi công việc yêu cầu bằng chứng có <strong>mức phạt riêng</strong> hiển thị trên thẻ.
                        {' '}Nhân viên bỏ công việc nào sẽ bị ghi đúng khoản phạt của công việc đó trong Bảng công.
                        {' '}Chủ nhật và ngày lễ không tính.
                    </span>
                }
            />}

            {/* Header Stats */}
            <Card className="daily-tasks-hero" style={{
                marginBottom: 12,
                borderRadius: 8,
                boxShadow: 'none',
                border: '1px solid #e2e8f0'
            }} styles={{ body: { padding: '14px 18px' } }}>
                <div className="daily-tasks-hero-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="daily-tasks-title-tools" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                        <div className="daily-tasks-title-copy">
                            <h1 style={{ margin: 0, color: '#172033', fontSize: 22, fontWeight: 800 }}>Công việc hàng ngày</h1>
                            <p>
                                Quản lý và theo dõi công việc của bạn · {selectedWorkDate.isSame(dayjs(), 'day') ? 'Hôm nay' : selectedWorkDate.format('DD/MM/YYYY')}
                            </p>
                        </div>
                        <div className="daily-tasks-date-nav" style={{ display: 'inline-flex', alignItems: 'center', height: 38, padding: 3, gap: 3, border: '1px solid #dbe3ec', borderRadius: 8, background: '#f8fafc' }}>
                            <Tooltip title="Ngày trước">
                                <Button
                                    type="text"
                                    aria-label="Ngày trước"
                                    icon={<LeftOutlined />}
                                    onClick={() => setSelectedWorkDate(current => current.subtract(1, 'day'))}
                                    style={{ width: 32, height: 30, padding: 0, borderRadius: 6, color: '#475569' }}
                                />
                            </Tooltip>
                            <Button
                                type={selectedWorkDate.isSame(dayjs().subtract(1, 'day'), 'day') ? 'primary' : 'text'}
                                onClick={() => setSelectedWorkDate(dayjs().subtract(1, 'day').startOf('day'))}
                                style={{ height: 30, padding: '0 10px', borderRadius: 6, fontWeight: 700 }}
                            >
                                Hôm qua
                            </Button>
                            <Button
                                type={selectedWorkDate.isSame(dayjs(), 'day') ? 'primary' : 'text'}
                                onClick={() => setSelectedWorkDate(dayjs().startOf('day'))}
                                style={{ height: 30, padding: '0 10px', borderRadius: 6, fontWeight: 700 }}
                            >
                                Hôm nay
                            </Button>
                            <Button
                                type="text"
                                icon={<CalendarOutlined />}
                                onClick={() => setWorkDatePickerOpen(true)}
                                style={{ height: 30, minWidth: 112, padding: '0 10px', borderRadius: 6, color: '#334155', fontWeight: 700 }}
                            >
                                {selectedWorkDate.format('DD/MM/YYYY')}
                            </Button>
                            <Tooltip title="Ngày sau">
                                <Button
                                    type="text"
                                    aria-label="Ngày sau"
                                    icon={<RightOutlined />}
                                    onClick={() => setSelectedWorkDate(current => current.add(1, 'day'))}
                                    style={{ width: 32, height: 30, padding: 0, borderRadius: 6, color: '#475569' }}
                                />
                            </Tooltip>
                        </div>
                    </div>

                    <Space className="daily-tasks-stats" size={18}>
                        <div className="daily-task-stat-card is-success">
                            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#16a34a' }}>
                                {completedTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Hoàn thành</div>
                        </div>

                        <Divider type="vertical" style={{ height: 34 }} />

                        <div className="daily-task-stat-card is-danger">
                            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#dc2626' }}>
                                {overdueTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Quá hạn</div>
                        </div>

                        <Divider type="vertical" style={{ height: 34 }} />

                        <div className="daily-task-stat-card is-warning">
                            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#d97706' }}>
                                {urgentTasks}
                            </div>
                            <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>Khẩn cấp</div>
                        </div>

                        <Divider type="vertical" style={{ height: 34 }} />

                        <div className="daily-task-stat-card is-progress">
                            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#16a34a' }}>
                                {totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}%
                            </div>
                            <Progress
                                percent={totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0}
                                showInfo={false}
                                size="small"
                                strokeColor="#16a34a"
                            />
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Tiến độ hôm nay</div>
                        </div>
                    </Space>

                    {isAdmin && <Button
                        className="daily-tasks-add-button"
                        type="primary"
                        size="large"
                        icon={<PlusOutlined />}
                        onClick={activeTab === 'assignments' ? handleAddAssignment : () => handleAddTask()}
                        style={{
                            height: 40,
                            fontSize: 15,
                            fontWeight: 'bold',
                            borderRadius: 6,
                            boxShadow: 'none'
                        }}
                    >
                        {activeTab === 'assignments' ? 'Giao việc mới' : 'Thêm công việc'}
                    </Button>}
                </div>
            </Card>

            <Modal
                title="Chọn ngày công việc"
                open={workDatePickerOpen}
                footer={null}
                width={380}
                destroyOnHidden
                onCancel={() => setWorkDatePickerOpen(false)}
            >
                <Calendar
                    fullscreen={false}
                    value={selectedWorkDate}
                    onSelect={(value) => {
                        setSelectedWorkDate(value);
                        setWorkDatePickerOpen(false);
                    }}
                />
            </Modal>

            {/* Tab Switcher */}
            <div className="daily-tasks-tabs" style={{ marginBottom: 16 }}>
                <Radio.Group
                    className="daily-tasks-tab-group"
                    value={activeTab}
                    onChange={(e) => {
                        const nextTab = e.target.value as typeof activeTab;
                        setActiveTab(nextTab);
                        if (nextTab === 'assignments') setBoardFilter('all');
                    }}
                    size="large"
                    style={{
                        background: '#fff',
                        padding: 8,
                        borderRadius: 0,
                        boxShadow: 'none',
                        border: '1px solid #e2e8f0'
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
                        Hàng ngày ({dailyTasks.length})
                    </Radio.Button>
                    <Radio.Button
                        value="assignments"
                        style={{
                            height: 40,
                            lineHeight: '44px',
                            paddingLeft: 24,
                            paddingRight: 24,
                            fontSize: 15,
                            fontWeight: 600,
                            borderRadius: 8,
                            marginLeft: 8
                        }}
                    >
                        Bàn giao {pendingAssignments.length > 0 && <Badge count={pendingAssignments.length} offset={[8, -4]} />}
                    </Radio.Button>
                    <Radio.Button
                        value="triage"
                        style={{ height: 44, lineHeight: '44px', paddingLeft: 24, paddingRight: 24, fontSize: 15, fontWeight: 600, borderRadius: 8, marginLeft: 8 }}
                    >
                        Cần xử lý <Badge count={dailyTasks.filter(task => task.status !== 'completed' && (isOverdue(task) || getEvidence(task).required)).length + pendingAssignments.length} offset={[8, -4]} />
                    </Radio.Button>
                    {/* Legacy full history tab removed; the right-side history panel is the current view. */}
                    {false && <Radio.Button
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
                    </Radio.Button>}
                </Radio.Group>
                <div className="daily-tasks-tab-tools">
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="Tìm kiếm công việc..."
                        value={taskSearch}
                        onChange={event => setTaskSearch(event.target.value)}
                        aria-label="Tìm kiếm công việc"
                    />
                    <Select
                        aria-label="Lọc công việc"
                        value={boardFilter}
                        onChange={value => setBoardFilter(value)}
                        options={[
                            { value: 'all', label: 'Tất cả công việc' },
                            { value: 'action', label: 'Cần xử lý' },
                            { value: 'evidence', label: 'Cần bằng chứng' },
                            { value: 'overdue', label: 'Quá hạn' },
                        ]}
                    />
                    <Select
                        aria-label="Sắp xếp công việc"
                        value={taskSort}
                        onChange={value => setTaskSort(value)}
                        options={[
                            { value: 'priority', label: 'Sắp xếp: Ưu tiên' },
                            { value: 'deadline', label: 'Sắp xếp: Thời hạn' },
                        ]}
                    />
                </div>
            </div>

            {/* === ASSIGNMENT TAB === */}
            {false && (
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

            {false && activeTab === 'tasks' && (
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
                            count={reviewTasks.length}
                            color="#dc2626"
                            icon={<WarningOutlined />}
                            tasks={reviewTasks}
                            lane="review"
                        />
                    </div>
                </>
            )}

            {false && activeTab === 'assignments' && (
                <div style={{ display: 'flex', gap: 16, paddingBottom: 16 }}>
                    <OperationalColumn
                        title="BÀN GIAO"
                        count={pendingAssignments.length}
                        color="#7c3aed"
                        icon={<FileTextOutlined />}
                        tasks={[]}
                        lane="today"
                        handoverTasks={assignmentTasks}
                    />
                </div>
            )}

            {activeTab === 'tasks' && <PriorityWorkspace scope="daily" />}
            {activeTab === 'triage' && <PriorityWorkspace scope="all" />}
            {activeTab === 'assignments' && <PriorityWorkspace scope="deadline" />}

            {/* Legacy full history calendar view removed; keep the compact history panel in PriorityWorkspace. */}
            {false && activeTab === 'history' && (
                <HistoryListView
                    selectedDate={selectedWorkDate}
                    tasks={tasks}
                    history={history}
                    snapshots={historySnapshots}
                    onOpenEvidence={openEvidence}
                />
            )}

            <Modal
                title={<div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 0' }}><span style={{ fontSize: 20, fontWeight: 750, color: '#172033' }}>{editingAssignment ? 'Sửa bàn giao' : 'Giao việc mới'}</span><span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>{editingAssignment ? 'Cập nhật nội dung và thời hạn công việc.' : 'Tạo và phân công công việc cho nhân viên thực hiện.'}</span></div>}
                open={assignmentModalVisible}
                onOk={handleSaveAssignment}
                onCancel={() => { setAssignmentModalVisible(false); assignmentForm.resetFields(); setAssignmentNoteExpanded(false); setSelectedAssignmentAssignees([]); }}
                confirmLoading={isSavingAssignment}
                okText={editingAssignment ? 'Cập nhật' : 'Giao việc'}
                cancelText="Hủy"
                okButtonProps={{ icon: <SendOutlined />, style: { borderRadius: 7, height: 40, padding: '0 18px', fontWeight: 700 } }}
                cancelButtonProps={{ style: { borderRadius: 7, height: 40, padding: '0 18px' } }}
                width={680}
                styles={{ body: { paddingTop: 20 }, footer: { marginTop: 22 } }}
            >
                <Form form={assignmentForm} layout="vertical" size="middle">
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(150px, 0.8fr) minmax(150px, 0.8fr)', gap: 14, alignItems: 'start' }}>
                        <Form.Item name="title" label="Tên công việc" rules={[{ required: true, message: 'Nhập tên công việc.' }]}>
                            <Input placeholder="Ví dụ: Lắp camera cho kho A" style={{ height: 42, borderRadius: 7 }} />
                        </Form.Item>
                        <Form.Item name="priority" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><FlagOutlined /> Mức ưu tiên</span>} style={{ marginBottom: 18 }}>
                            <Select style={{ height: 42 }}>
                                <Option value="low">Thấp</Option>
                                <Option value="normal">Bình thường</Option>
                                <Option value="high">Cao</Option>
                                <Option value="urgent">Khẩn cấp</Option>
                            </Select>
                        </Form.Item>
                         <Form.Item name="deadlinePenaltyAmount" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><WarningOutlined style={{ color: '#d97706' }} /> Mức phạt / người</span>} rules={[{ required: true, message: 'Nhập mức phạt mỗi người.' }]} style={{ marginBottom: 18 }}>
                            <InputNumber min={0} precision={0} controls={false} suffix="đ" style={{ width: '100%', height: 42 }} formatter={formatPenaltyAmount} parser={(value) => String(value || '').replace(/[^\d]/g, '')} />
                        </Form.Item>
                    </div>
                    <div style={{ marginTop: -10, marginBottom: 14, color: '#8a5a12', fontSize: 12, lineHeight: 1.45 }}>
                        <WarningOutlined /> Mức phạt áp dụng cho từng người nhận. Bàn giao yêu cầu bằng chứng sẽ phạt ngay tại deadline và tăng theo từng ngày, đúng giờ deadline đã đặt.
                    </div>
                    <Form.Item name="recurrenceDays" label="Tự lặp lại sau (ngày)" extra="0 = không lặp; ví dụ 2 = tự sinh lại sau 2 ngày. Nếu rơi vào Chủ nhật/ngày lễ, tự dời sang ngày làm việc kế tiếp." style={{ marginBottom: 18 }}>
                        <InputNumber min={0} max={365} precision={0} controls style={{ width: 180 }} />
                    </Form.Item>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 12px', border: '1px solid #bbf7d0', borderRadius: 7, background: '#f0fdf4' }}>
                        <Form.Item name="evidenceRequired" hidden initialValue={true}><Input /></Form.Item>
                        <PictureOutlined style={{ color: '#16a34a' }} />
                        <span style={{ color: '#166534', fontWeight: 650 }}>Bàn giao bắt buộc nộp bằng chứng ảnh trước khi hoàn thành</span>
                        <Form.Item noStyle shouldUpdate={(previous, current) => previous.evidenceRequired !== current.evidenceRequired}>
                            {({ getFieldValue }) => false && getFieldValue('evidenceRequired') ? (
                                <Form.Item name="evidencePenaltyAmount" label="Phạt không nộp (đ)" style={{ margin: 0, marginLeft: 'auto', width: 185 }}>
                                    <InputNumber min={0} precision={0} controls={false} suffix="đ" style={{ width: '100%' }} formatter={formatPenaltyAmount} parser={(value) => String(value || '').replace(/[^\d]/g, '')} />
                                </Form.Item>
                            ) : null}
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="Mô tả chi tiết">
                        <TextArea rows={3} placeholder="Chi tiết công việc cần làm..." style={{ borderRadius: 7, resize: 'vertical' }} />
                    </Form.Item>
                    <div style={{ borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', margin: '18px 0', padding: '16px 0 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, color: '#172033' }}><UserOutlined /> Người nhận <span style={{ color: '#ef4444' }}>*</span></span>
                            {!editingAssignment && <span style={{ fontSize: 12, color: '#64748b' }}>{selectedAssignmentAssignees.length > 0 ? `${selectedAssignmentAssignees.length} người được giao` : 'Mỗi người nhận một công việc độc lập.'}</span>}
                        </div>
                        {editingAssignment ? (
                            <>
                                <Form.Item name="assignee" hidden rules={[{ required: true, message: 'Chọn người thực hiện.' }]}><Input /></Form.Item>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 34, alignItems: 'center' }}>
                                    {selectedAssignmentAssignees.map((name: string) => (
                                        <Tag
                                            key={name}
                                            closable
                                            onClose={(event) => {
                                                event.preventDefault();
                                                if (selectedAssignmentAssignees.length === 1) {
                                                    message.warning('Bàn giao phải còn ít nhất một người nhận.');
                                                    return;
                                                }
                                                const nextAssignees = selectedAssignmentAssignees.filter((item: string) => item !== name);
                                                updateAssignmentAssignees(nextAssignees);
                                                assignmentForm.setFieldsValue({ assignee: nextAssignees[0] });
                                            }}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, margin: 0, borderRadius: 7, color: '#065f46', background: '#ecfdf5', borderColor: '#bbf7d0', fontSize: 13, fontWeight: 650 }}
                                        >
                                            <Avatar size={20} style={{ backgroundColor: getAvatarColor(name), fontSize: 10 }}>{name.slice(0, 1).toUpperCase()}</Avatar>{name}
                                        </Tag>
                                    ))}
                                </div>
                                <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>Bấm dấu × để gỡ người nhận khỏi bàn giao. Lịch sử các lần bàn giao đã phát sinh vẫn được giữ lại.</div>
                            </>
                        ) : (
                            <Form.Item style={{ marginBottom: 0 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                                        {assigneeList.map(name => {
                                            const selected = selectedAssignmentAssignees.includes(name);
                                            return (
                                                <div
                                                    key={name}
                                                    role="checkbox"
                                                    aria-checked={selected}
                                                    tabIndex={0}
                                                    onClick={() => toggleAssignmentAssignee(name)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            toggleAssignmentAssignee(name);
                                                        }
                                                    }}
                                                    style={{
                                                        height: 42,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 9,
                                                        padding: '0 10px',
                                                        borderRadius: 7,
                                                        border: `1px solid ${selected ? '#22c55e' : '#dbe3ec'}`,
                                                        background: selected ? '#ecfdf5' : '#fff',
                                                        color: '#172033',
                                                        cursor: 'pointer',
                                                        textAlign: 'left',
                                                    }}
                                                >
                                                    <span
                                                        aria-hidden="true"
                                                        style={{
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: '50%',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            flexShrink: 0,
                                                            border: selected ? '1px solid #16a34a' : '1px solid #cbd5e1',
                                                            background: selected ? '#16a34a' : '#fff',
                                                            color: '#fff',
                                                            fontSize: 11,
                                                            fontWeight: 800,
                                                        }}
                                                    >
                                                        {selected ? '✓' : ''}
                                                    </span>
                                                    <Avatar size={26} style={{ backgroundColor: getAvatarColor(name), fontSize: 11 }}>{name.slice(0, 1).toUpperCase()}</Avatar>
                                                    <span style={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {selectedAssignmentAssignees.length > 0 ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {selectedAssignmentAssignees.map((name: string) => (
                                                <Tag
                                                    key={name}
                                                    closable
                                                    onClose={() => updateAssignmentAssignees(selectedAssignmentAssignees.filter((item: string) => item !== name))}
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, margin: 0, borderRadius: 7, color: '#065f46', background: '#ecfdf5', borderColor: '#bbf7d0', fontSize: 13, fontWeight: 650 }}
                                                >
                                                    {name}
                                                </Tag>
                                            ))}
                                        </div>
                                    ) : (
                                        <span style={{ color: '#94a3b8', fontSize: 13 }}>Chưa chọn người nhận</span>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </div>
                    <Form.Item name="deadline" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><CalendarOutlined /> Thời hạn hoàn thành</span>} rules={[{ required: true, message: 'Chọn thời hạn.' }]}>
                        <AssignmentDeadlinePicker />
                    </Form.Item>
                    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 13 }}>
                        <Button type="text" icon={<MessageOutlined />} onClick={() => setAssignmentNoteExpanded(value => !value)} style={{ padding: 0, color: '#475569', fontWeight: 600 }}>
                            Ghi chú (tùy chọn)
                        </Button>
                        {assignmentNoteExpanded && <Form.Item name="note" style={{ margin: '12px 0 0' }}>
                            <TextArea rows={2} placeholder="Thông tin bổ sung cho người nhận..." style={{ borderRadius: 7, resize: 'vertical' }} />
                        </Form.Item>}
                    </div>
                </Form>
            </Modal>

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
                    if (isSavingTask) return;
                    setTaskModalVisible(false);
                    taskForm.resetFields();
                    setEditingTask(null);
                }}
                confirmLoading={isSavingTask}
                maskClosable={!isSavingTask}
                closable={!isSavingTask}
                width={550}
                okText="💾 Lưu"
                cancelText="Hủy"
                okButtonProps={{ size: 'large', style: { minWidth: 100 }, disabled: isSavingTask }}
                cancelButtonProps={{ size: 'large', disabled: isSavingTask }}
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
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(104px, 0.75fr) minmax(120px, 0.9fr)', gap: 10, padding: 12, marginBottom: 16, border: '1px solid #fed7aa', borderRadius: 8, background: '#fffaf5' }}>
                                <Form.Item name="evidenceDeadlineTime" label="Hạn chót" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
                                    <Select size="middle" disabled options={[{ value: DAILY_EVIDENCE_DEADLINE, label: '23:59 cuối ngày' }]} />
                                </Form.Item>
                                <Form.Item name="penaltyAmount" label="Phạt (đ)" style={{ marginBottom: 0 }}>
                                    <InputNumber min={0} precision={0} controls={false} suffix="đ" disabled={!isAdmin} style={{ width: '100%' }} formatter={formatPenaltyAmount} parser={(value) => String(value || '').replace(/[^\d]/g, '')} />
                                </Form.Item>
                                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#c2410c' }}>Bằng chứng bằng ảnh, tối đa {MAX_EVIDENCE_IMAGES} ảnh mỗi lần nộp. Hệ thống chỉ ghi nhận phạt từ 00:00 ngày kế tiếp.</div>
                            </div>
                        ) : null}
                    </Form.Item>

                    <div style={{ marginBottom: 10, fontSize: 12, color: '#64748b' }}>
                        {assignmentMode === 'fixed' ? 'Chỉ người được chọn có thể thực hiện công việc này.' : 'Hệ thống tự đổi người thực hiện theo danh sách luân phiên mỗi ngày.'}
                    </div>
                    <Form.Item name="assignmentMode" style={{ marginBottom: 10 }}>
                        <Radio.Group
                            onChange={(event) => {
                                const mode = event.target.value as 'fixed' | 'daily';
                                setAssignmentMode(mode);
                                if (mode !== 'fixed') taskForm.setFieldsValue({ assignee: '' });
                            }}
                            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                        >
                            <Radio value="fixed">Cố định một người</Radio>
                            <Radio value="daily">Luân phiên theo ngày</Radio>
                        </Radio.Group>
                    </Form.Item>
                    {assignmentMode === 'daily' && (
                        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #bfdbfe', borderRadius: 8, background: '#f0f9ff' }}>
                            <Form.Item
                                name="rotationAssignees"
                                label={<span style={{ fontSize: 14, fontWeight: 600 }}>Người luân phiên <span style={{ color: '#ff4d4f' }}>*</span></span>}
                                rules={[{ required: true, type: 'array', min: 2, message: 'Chọn ít nhất 2 nhân viên chính thức.' }]}
                                style={{ marginBottom: 8 }}
                            >
                                <Select
                                    mode="multiple"
                                    placeholder="Chọn theo thứ tự: hôm nay, ngày mai..."
                                    options={rotationAssigneeList.map(username => ({ value: username, label: username }))}
                                />
                            </Form.Item>
                            <div style={{ fontSize: 12, color: '#1d4ed8', lineHeight: 1.55 }}>
                                Người đầu tiên làm hôm nay; hệ thống tự đổi người vào mỗi ngày mới. Danh sách chỉ gồm nhân viên chính thức.
                            </div>
                        </div>
                    )}
                    {assignmentMode === 'fixed' && <>
                    <Form.Item
                        name="assignee"
                        label={<span style={{ fontSize: 14, fontWeight: 600 }}>👤 Người thực hiện</span>}
                        rules={[{ required: true, message: 'Chọn người thực hiện.' }]}
                        style={{ marginBottom: 16 }}
                    >
                        <Select
                            size="large"
                            placeholder="Chọn người thực hiện"
                            optionLabelProp="label"
                            virtual={false}
                            showSearch
                            dropdownStyle={{ zIndex: 2000 }}
                            filterOption={(input, option) =>
                                (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                            }
                            onSearch={() => { }}
                            onChange={async (value) => {
                                // Nếu người dùng gõ tên mới (không có trong danh sách)
                                if (value && !assigneeList.includes(value)) {
                                    const updated = [...assigneeList, value];
                                    if (await trySaveAssigneeList(updated)) {
                                        message.success(`✅ Đã thêm "${value}" vào danh sách!`);
                                    }
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
                                                        onOk: async () => {
                                                            const updated = assigneeList.filter(p => p !== name);
                                                            if (await trySaveAssigneeList(updated)) {
                                                                message.success('Đã xóa!');
                                                            }
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
                                    onPressEnter={async () => {
                                        const name = newAssigneeName.trim();
                                        if (!name) return;
                                        if (assigneeList.includes(name)) {
                                            message.warning('Người này đã tồn tại!');
                                            return;
                                        }
                                        const updated = [...assigneeList, name];
                                        if (!(await trySaveAssigneeList(updated))) return;
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
                                    onClick={async () => {
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
                                        if (!(await trySaveAssigneeList(updated))) return;
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
                    </>}

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

type HistoryListStatus = 'completed' | 'pending' | 'submitted' | 'reopened';

const HistoryListView = ({
    selectedDate,
    tasks,
    history,
    snapshots,
    onOpenEvidence,
}: {
    selectedDate: dayjs.Dayjs;
    tasks: Task[];
    history: any[];
    snapshots: Record<string, { tasks?: any[] }>;
    onOpenEvidence: (task: Task, evidence?: EvidenceMeta) => void;
}) => {
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'submitted'>('all');
    const [searchText, setSearchText] = useState('');
    const deferredSearch = useDeferredValue(searchText.trim().toLocaleLowerCase('vi-VN'));
    const dateKey = selectedDate.format('YYYY-MM-DD');
    const isToday = selectedDate.isSame(dayjs(), 'day');

    const normalizeTask = (task: any): Task => ({
        ...task,
        id: Number(task.id),
        title: task.title || 'Công việc không tên',
        category: task.category || '',
        assignee: task.assignee || '',
        verifier: task.verifier || '',
        priority: task.priority || 'normal',
        status: task.status || 'pending',
        dueTime: task.dueTime || (task.dueDate ? dayjs(task.dueDate).format('HH:mm') : ''),
        dueDate: task.dueDate ? dayjs(task.dueDate).format('YYYY-MM-DD') : dateKey,
        tags: Array.isArray(task.tags) ? task.tags : [],
        attachments: parseAttachments(task.attachments),
        type: task.type || 'daily',
    });

    const snapshotTasks = snapshots[dateKey]?.tasks;
    const dailySource = isToday
        ? tasks.filter(task => !task.type || task.type === 'daily')
        : Array.isArray(snapshotTasks) ? snapshotTasks.map(normalizeTask) : [];
    const assignments = tasks
        .filter(task => task.type === 'assignment' && dayjs(task.dueDate).format('YYYY-MM-DD') === dateKey)
        .map(normalizeTask);
    const taskSource = [...dailySource.map(normalizeTask), ...assignments];
    const dateHistory = history
        .filter(entry => entry.timestamp && dayjs(entry.timestamp).format('YYYY-MM-DD') === dateKey)
        .sort((left, right) => dayjs(left.timestamp).valueOf() - dayjs(right.timestamp).valueOf());

    const taskKey = (value: { taskId?: number; id?: number; taskTitle?: string; title?: string }) => {
        const id = value.taskId ?? value.id;
        return id ? `id:${id}` : `title:${String(value.taskTitle || value.title || '').trim().toLocaleLowerCase('vi-VN')}`;
    };
    const eventsByTask = new Map<string, any[]>();
    dateHistory.forEach(entry => {
        const key = taskKey(entry);
        eventsByTask.set(key, [...(eventsByTask.get(key) || []), entry]);
    });
    const tasksByKey = new Map(taskSource.map(task => [taskKey(task), task]));
    const allKeys = new Set([...tasksByKey.keys(), ...eventsByTask.keys()]);

    const rows = Array.from(allKeys).map((key, index) => {
        const task = tasksByKey.get(key);
        const events = eventsByTask.get(key) || [];
        const latestEvent = events[events.length - 1];
        const evidenceEvent = [...events].reverse().find(entry => entry.evidence);
        const taskEvidence = task ? getEvidence(task) : {};
        const evidence: EvidenceMeta = mergeHistoryEvidence(taskEvidence, evidenceEvent?.evidence);
        const latestAction = latestEvent?.action || '';
        let status: HistoryListStatus = 'pending';
        if (latestAction === 'pending' || latestAction === 'evidence_rejected') {
            status = 'reopened';
        } else if (latestAction === 'evidence_submitted' || evidence.status === 'submitted') {
            status = 'submitted';
        } else if (
            task?.status === 'completed'
            || ['completed', 'daily_reset', 'evidence_approved'].includes(latestAction)
            || evidence.status === 'approved'
        ) {
            status = 'completed';
        }

        const id = Number(task?.id || latestEvent?.taskId || -(index + 1));
        const title = task?.title || latestEvent?.taskTitle || 'Công việc không tên';
        const time = latestEvent?.timestamp
            ? dayjs(latestEvent.timestamp).format('HH:mm')
            : task?.dueTime || '--:--';
        const evidenceImages = evidence.submittedImages?.length
            ? evidence.submittedImages
            : evidence.submittedImage ? [evidence.submittedImage] : [];
        const canViewEvidence = id > 0 && evidenceImages.length > 0;
        const rowTask: Task = task || {
            id,
            title,
            category: latestEvent?.category || '',
            assignee: latestEvent?.assignee || '',
            verifier: latestEvent?.verifier || '',
            priority: 'normal',
            dueTime: '',
            dueDate: dateKey,
            status: status === 'completed' ? 'completed' : 'pending',
            type: 'daily',
        };

        return {
            key,
            task: rowTask,
            title,
            category: task?.category || latestEvent?.category || 'Hàng ngày',
            assignee: latestEvent?.assignee || task?.assignee || 'Chưa phân công',
            verifier: latestEvent?.verifier || task?.verifier || 'Chưa xác nhận',
            time,
            status,
            evidence,
            canViewEvidence,
            sortValue: latestEvent?.timestamp
                ? dayjs(latestEvent.timestamp).valueOf()
                : dayjs(`${dateKey} ${task?.dueTime || '23:59'}`, 'YYYY-MM-DD HH:mm').valueOf(),
        };
    }).sort((left, right) => left.sortValue - right.sortValue);

    const counts = {
        total: rows.length,
        completed: rows.filter(row => row.status === 'completed').length,
        submitted: rows.filter(row => row.status === 'submitted').length,
        pending: rows.filter(row => row.status === 'pending' || row.status === 'reopened').length,
    };
    const visibleRows = rows.filter(row => {
        const matchesStatus = statusFilter === 'all'
            || row.status === statusFilter
            || (statusFilter === 'pending' && row.status === 'reopened');
        if (!matchesStatus) return false;
        if (!deferredSearch) return true;
        return [row.title, row.category, row.assignee, row.verifier]
            .some(value => String(value).toLocaleLowerCase('vi-VN').includes(deferredSearch));
    });

    const statusMeta: Record<HistoryListStatus, { label: string; className: string }> = {
        completed: { label: 'Hoàn thành', className: 'is-completed' },
        pending: { label: 'Chưa làm', className: 'is-pending' },
        submitted: { label: 'Chờ duyệt', className: 'is-submitted' },
        reopened: { label: 'Đã mở lại', className: 'is-reopened' },
    };
    const initials = (name: string) => name
        .split(/\s+/)
        .filter(Boolean)
        .slice(-2)
        .map(part => part[0])
        .join('')
        .toUpperCase();

    return (
        <section className="history-list-view">
            <header className="history-list-summary">
                <div>
                    <div className="history-list-eyebrow">Lịch sử công việc</div>
                    <h2>Ngày {selectedDate.format('DD/MM/YYYY')}</h2>
                    <p>{selectedDate.format('dddd')} · Dữ liệu tổng hợp theo trạng thái cuối cùng của từng công việc</p>
                </div>
                <div className="history-list-metrics" aria-label="Thống kê lịch sử">
                    <div><span>Tổng</span><strong>{counts.total}</strong></div>
                    <div><span>Hoàn thành</span><strong className="metric-success">{counts.completed}</strong></div>
                    <div><span>Chưa hoàn thành</span><strong className="metric-danger">{counts.pending + counts.submitted}</strong></div>
                </div>
            </header>

            <div className="history-list-panel">
                <div className="history-list-toolbar">
                    <Radio.Group
                        value={statusFilter}
                        onChange={event => setStatusFilter(event.target.value)}
                        className="history-status-filter"
                    >
                        <Radio.Button value="all">Tất cả <span>{counts.total}</span></Radio.Button>
                        <Radio.Button value="completed">Hoàn thành <span>{counts.completed}</span></Radio.Button>
                        <Radio.Button value="pending">Chưa làm <span>{counts.pending}</span></Radio.Button>
                        <Radio.Button value="submitted">Chờ duyệt <span>{counts.submitted}</span></Radio.Button>
                    </Radio.Group>
                    <Input
                        allowClear
                        value={searchText}
                        onChange={event => setSearchText(event.target.value)}
                        prefix={<SearchOutlined />}
                        placeholder="Tìm công việc, người thực hiện..."
                        className="history-list-search"
                    />
                </div>

                <div className="history-list-table-wrap">
                    <div className="history-list-table">
                        <div className="history-list-row history-list-head">
                            <span>Thời gian</span>
                            <span>Công việc</span>
                            <span>Danh mục</span>
                            <span>Người thực hiện</span>
                            <span>Người xác nhận</span>
                            <span>Trạng thái</span>
                            <span>Bằng chứng</span>
                        </div>
                        {visibleRows.map(row => {
                            const meta = statusMeta[row.status];
                            return (
                                <div className="history-list-row" key={row.key}>
                                    <time>{row.time}</time>
                                    <div className="history-task-title" title={row.title}>{row.title}</div>
                                    <div className="history-category">{row.category}</div>
                                    <div className="history-person">
                                        <Avatar size={30}>{initials(row.assignee)}</Avatar>
                                        <span>{row.assignee}</span>
                                    </div>
                                    <div className="history-person">
                                        <Avatar size={30}>{initials(row.verifier)}</Avatar>
                                        <span>{row.verifier}</span>
                                    </div>
                                    <div><span className={`history-status ${meta.className}`}>{meta.label}</span></div>
                                    <div>
                                        {row.canViewEvidence ? (
                                            <Button
                                                type="link"
                                                size="small"
                                                icon={<EyeOutlined />}
                                                onClick={() => onOpenEvidence(row.task, row.evidence)}
                                                className="history-evidence-link"
                                            >
                                                Xem bằng chứng
                                            </Button>
                                        ) : row.evidence.required ? (
                                            <span className="history-no-evidence" style={{ color: '#dc2626', fontWeight: 650 }}>Thiếu ảnh · bị phạt</span>
                                        ) : <span className="history-no-evidence">Không yêu cầu</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {visibleRows.length === 0 && (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={rows.length === 0 ? 'Chưa có dữ liệu công việc trong ngày này' : 'Không có kết quả phù hợp'}
                        className="history-list-empty"
                    />
                )}
                <footer className="history-list-footer">
                    Hiển thị {visibleRows.length} / {rows.length} công việc
                </footer>
            </div>
        </section>
    );
};

// Legacy calendar implementation is retained temporarily for data compatibility.
const HistoryCalendar = ({ tasks, history, snapshots, onOpenEvidence }: { tasks: Task[], history: any[], snapshots: Record<string, { tasks?: any[] }>, onOpenEvidence: (task: Task, evidence?: EvidenceMeta) => void }) => {
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [currentMonth, setCurrentMonth] = useState(dayjs());
    const [hoveredDate, setHoveredDate] = useState<string | null>(null);

    // Lấy TẤT CẢ công việc trong ngày (để hiển thị trong modal chi tiết)
    const getAllTasksForDate = (date: dayjs.Dayjs) => {
        const dateStr = date.format('YYYY-MM-DD');
        const isToday = date.isSame(dayjs(), 'day');
        const normalizeSnapshotTask = (task: any): Task => ({
            ...task,
            tags: Array.isArray(task.tags) ? task.tags : (() => {
                try { return task.tags ? JSON.parse(task.tags) : []; } catch { return []; }
            })(),
            attachments: parseAttachments(task.attachments),
            dueTime: task.dueTime || dayjs(task.dueDate).format('HH:mm'),
            dueDate: dayjs(task.dueDate).format('YYYY-MM-DD'),
            type: task.type || 'daily',
        });
        const assignmentsOnDate = tasks.filter(task => task.type === 'assignment' && task.dueDate === dateStr);
        const snapshotTasks = snapshots[dateStr]?.tasks;

        if (Array.isArray(snapshotTasks)) {
            return [...snapshotTasks.map(normalizeSnapshotTask), ...assignmentsOnDate];
        }
        if (isToday) {
            return tasks.filter(task => (!task.type || task.type === 'daily') || task.dueDate === dateStr);
        }

        // Snapshots did not exist for old dates. Infer final status from the
        // activity records so their summary is still meaningful.
        const latestActivities = new Map<string, any>();
        history
            .filter(entry => entry.timestamp && dayjs(entry.timestamp).format('YYYY-MM-DD') === dateStr && entry.taskId)
            .sort((left, right) => dayjs(left.timestamp).valueOf() - dayjs(right.timestamp).valueOf())
            .forEach(entry => latestActivities.set(String(entry.taskId), entry));
        const inferredTasks = Array.from(latestActivities.values()).map((entry, index): Task => ({
            id: Number(entry.taskId) || -(index + 1),
            title: entry.taskTitle || 'Công việc không tên',
            category: entry.category || '',
            assignee: entry.assignee || '',
            verifier: entry.verifier || '',
            priority: 'normal',
            dueTime: '',
            dueDate: dateStr,
            status: entry.action === 'completed' || entry.action === 'daily_reset' || entry.action === 'evidence_submitted' ? 'completed' : 'pending',
            tags: [],
            type: 'daily',
        }));
        return [...inferredTasks, ...assignmentsOnDate];
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

        const activityEntries = entriesOnDate.filter(entry => {
            if (entry.action !== 'completed' && entry.action !== 'daily_reset') return true;
            const taskKey = entry.taskId ? String(entry.taskId) : String(entry.taskTitle || '').trim().toLowerCase();
            return taskKey ? preferredCompletion.get(taskKey) === entry : true;
        });

        // Surface proof submitted before the evidence audit event existed.
        const evidenceEntries = tasks.flatMap(task => {
            const evidence = getEvidence(task);
            if (!evidence.required || !evidence.submittedAt || dayjs(evidence.submittedAt).format('YYYY-MM-DD') !== dateStr) return [];
            if (activityEntries.some(entry => entry.action === 'evidence_submitted' && entry.taskId === task.id)) return [];

            return [{
                taskId: task.id,
                taskTitle: task.title,
                assignee: evidence.submittedBy || task.assignee,
                verifier: '',
                action: 'evidence_submitted',
                timestamp: evidence.submittedAt,
                evidenceTask: task,
            }];
        });

        return [...activityEntries, ...evidenceEntries]
            .sort((left, right) => dayjs(right.timestamp).valueOf() - dayjs(left.timestamp).valueOf());
    };

    const getHistoryDescription = (entry: any) => {
        if (entry.action === 'completed' || entry.action === 'daily_reset') {
            return `✅ Đã hoàn thành: "${entry.taskTitle}"`;
        }
        if (entry.action === 'pending') {
            return `↩️ Đã mở lại: "${entry.taskTitle}"`;
        }
        if (entry.action === 'evidence_submitted') {
            return `📎 Đã nộp bằng chứng: "${entry.taskTitle}"`;
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
                                                                    {(h.action === 'evidence_submitted' || h.action === 'evidence_approved') && (h.evidenceTask || h.evidence) && (
                                                                        <Button
                                                                            size="small"
                                                                            icon={<EyeOutlined />}
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                onOpenEvidence(h.evidenceTask || {
                                                                                    id: Number(h.taskId),
                                                                                    title: h.taskTitle || 'Công việc',
                                                                                    category: h.category || '',
                                                                                    assignee: h.assignee || '',
                                                                                    priority: 'normal',
                                                                                    dueTime: '',
                                                                                    status: 'pending',
                                                                                }, h.evidence);
                                                                            }}
                                                                        >
                                                                            Xem bằng chứng
                                                                        </Button>
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
