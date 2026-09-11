import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Modal, Progress, Select, Spin, Tooltip, message } from 'antd';
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    BankOutlined,
    CalendarOutlined,
    CheckCircleFilled,
    ClockCircleOutlined,
    CodeSandboxOutlined,
    DollarOutlined,
    FileTextFilled,
    FileTextOutlined,
    GiftOutlined,
    InfoCircleOutlined,
    LockOutlined,
    PrinterOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    SendOutlined,
    ToolOutlined,
} from '@ant-design/icons';
import type { Announcement, AnnouncementRecipientAudit } from '../types/electron';
import type { NotificationInbox } from '../lib/useNotificationInbox';
import { requiresNotificationAcknowledgement } from '../lib/notificationAcknowledgement';
import PolicyLibrary from './PolicyLibrary';
import './NotificationCenter.css';

type CenterView = 'notifications' | 'policies';

interface NotificationCenterProps {
    inbox: NotificationInbox;
    isAdmin?: boolean;
    initialSelectedId?: number | null;
}

const categories: Record<string, { label: string; className: string }> = {
    policy: { label: 'Chính sách & Thưởng', className: 'is-policy' },
    reward: { label: 'Thưởng', className: 'is-reward' },
    penalty: { label: 'Chế tài & Quy chuẩn', className: 'is-penalty' },
    operations: { label: 'Vận hành kho', className: 'is-operations' },
    system: { label: 'Hệ thống', className: 'is-system' },
    payroll: { label: 'Quỹ lương', className: 'is-payroll' },
    attendance: { label: 'Chuyên cần', className: 'is-attendance' },
    general: { label: 'Thông báo chung', className: 'is-general' },
};

const formatDate = (value?: string | null) => value
    ? new Intl.DateTimeFormat('vi-VN').format(new Date(value))
    : 'Chưa công bố';

const formatDatePadded = (value?: string | null) => value
    ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
    : 'Chưa công bố';

const formatDateTime = (value?: string | null) => value
    ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
    : 'Chưa công bố';

const formatOfficialDate = (value?: string | null) => {
    const d = value ? new Date(value) : new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `ngày ${day} tháng ${month} năm ${year}`;
};

const formatPublishedTime = (value: string) => {
    const date = new Date(value);
    const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 1) return 'Vừa xong';
    if (diffMinutes < 60) return `${diffMinutes} phút trước`;
    if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)} giờ trước`;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `Hôm qua ${new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date)}`;
    }
    return formatDate(value);
};

const getPublishedTime = (item: Announcement) => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest')) {
        const previewLabels: Record<number, string> = {
            900001: '11 giờ trước',
            900002: '12 giờ trước',
            900003: '12 giờ trước',
            900004: 'Hôm qua 16:20',
            900005: 'Hôm qua 09:00',
        };
        if (previewLabels[item.id]) return previewLabels[item.id];
    }
    return formatPublishedTime(item.publishedAt);
};

const getItemVisual = (item: Announcement) => {
    if (item.source === 'personal' || item.category === 'attendance') {
        return { Icon: item.severity === 'warning' ? ClockCircleOutlined : GiftOutlined, tone: item.severity === 'warning' ? 'orange' : 'green', cta: 'Xem thành tích' };
    }
    if (item.policyCode?.startsWith('PAY-')) return { Icon: DollarOutlined, tone: 'slate', cta: 'Xem lịch đối soát' };
    if (item.category === 'policy' || item.severity === 'reward') return { Icon: GiftOutlined, tone: 'green', cta: 'Xem chính sách' };
    if (item.category === 'penalty' || item.severity === 'danger') return { Icon: FileTextFilled, tone: 'red', cta: 'Chi tiết biểu phí' };
    if (item.category === 'operations') return { Icon: CodeSandboxOutlined, tone: item.requireAcknowledgement ? 'orange' : 'blue', cta: 'Xem quy trình' };
    if (item.category === 'system') return { Icon: FileTextFilled, tone: 'violet', cta: 'Xem chi tiết' };
    return { Icon: FileTextFilled, tone: 'slate', cta: 'Xem chi tiết' };
};

const getDeadline = (item?: Announcement | null) => item?.effectiveAt
    ? `08:00 ${formatDatePadded(item.effectiveAt)}`
    : 'Theo thông báo';

const getRemaining = (item?: Announcement | null) => {
    if (!item?.effectiveAt) return 'Theo thời hạn văn bản';
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest')) return 'Còn 23 giờ 52 phút';
    const deadline = new Date(item.effectiveAt);
    deadline.setHours(8, 0, 0, 0);
    const minutes = Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 60000));
    if (minutes === 0) return 'Đã đến hạn xác nhận';
    return `Còn ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
};

function NotificationTags({ item }: { item: Announcement }) {
    const category = categories[item.category] || categories.general;
    return (
        <div className="notification-tags">
            <span className={`notification-tag ${category.className}`}>{category.label}</span>
            {item.source !== 'personal' && item.severity === 'reward' && <span className="notification-tag is-reward">Toàn quốc</span>}
            {item.severity === 'danger' && <span className="notification-tag is-danger">Phạt nguội</span>}
            {requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt && <span className="notification-tag is-required">Cần xác nhận</span>}
            {item.recipient?.acknowledgedAt && <span className="notification-tag is-confirmed"><CheckCircleFilled /> Đã xác nhận</span>}
            {!item.recipient?.readAt && !item.requireAcknowledgement && <span className="notification-tag is-unread">Cần đọc</span>}
        </div>
    );
}

const roleName = (role: string) => role === 'admin' ? 'Quản trị viên' : role === 'manager' ? 'Quản lý' : role === 'viewer' ? 'Chỉ xem' : 'Nhân viên';

const getVietnameseInitials = (fullName?: string | null, username?: string | null): string => {
    const name = fullName?.trim() || username?.trim() || '';
    if (!name) return 'U';
    const words = name.split(/\s+/).filter(Boolean);
    // Lấy chữ cái đầu của TÊN (từ cuối cùng), ví dụ: "Nguyễn Đình Toàn" -> "T", "Nguyễn Văn Khánh" -> "K"
    const lastWord = words[words.length - 1];
    return lastWord.charAt(0).toUpperCase();
};

export default function NotificationCenter({ inbox, isAdmin = false, initialSelectedId }: NotificationCenterProps) {
    const [view, setView] = useState<CenterView>(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has('policyUiTest') ? 'policies' : 'notifications');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
    const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId || null);
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [recipients, setRecipients] = useState<AnnouncementRecipientAudit[]>([]);
    const [recipientsLoading, setRecipientsLoading] = useState(false);
    const [recipientStatus, setRecipientStatus] = useState<'all' | 'acknowledged' | 'pending'>('all');
    const [recipientSetupOpen, setRecipientSetupOpen] = useState(false);
    const [requiredRecipientIds, setRequiredRecipientIds] = useState<number[]>([]);
    const [recipientSetupSaving, setRecipientSetupSaving] = useState(false);
    const [recipientSetupLoading, setRecipientSetupLoading] = useState(false);
    const feedRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (initialSelectedId) setSelectedId(initialSelectedId);
    }, [initialSelectedId]);

    const filtered = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN');
        return [...inbox.items]
            .filter(item => {
                if (normalizedQuery && !`${item.title} ${item.summary} ${item.policyCode || ''} ${item.issuer || ''}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery)) return false;
                return true;
            })
            .sort((a, b) => (new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()) * (sort === 'newest' ? 1 : -1));
    }, [inbox.items, query, sort]);

    const selected = inbox.items.find(item => item.id === selectedId) || null;
    const featured = useMemo(() => inbox.items
        .filter(item => requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt)
        .sort((a, b) => new Date(a.effectiveAt || a.publishedAt).getTime() - new Date(b.effectiveAt || b.publishedAt).getTime())[0] || null,
    [inbox.items]);
    interface TableRow {
        stt: number;
        label: string;
        value: string;
    }

    const getPreviousRate = (label: string, _value: string): string => {
        const lowerLabel = label.toLowerCase();
        // Khen thưởng trước đó hoàn toàn không có
        if (lowerLabel.includes('thưởng') || lowerLabel.includes('tuần')) {
            return 'Không áp dụng';
        }
        // Trước 01/09: Đóng gói chỉ là 20đ/sp
        return '20đ/sp';
    };

    interface OfficialArticle {
        title: string;
        paragraphs: string[];
        tableRows?: TableRow[];
        bullets?: string[];
        callout?: string;
    }

    const parsedOfficialArticles = useMemo<OfficialArticle[]>(() => {
        if (!selected?.content) return [];
        const lines = selected.content.split('\n').map(l => l.trim()).filter(Boolean);
        const articles: OfficialArticle[] = [];

        let currentArticle: OfficialArticle = {
            title: 'Nội dung và phạm vi áp dụng',
            paragraphs: [],
            tableRows: [],
            bullets: [],
        };
        let rowStt = 1;

        for (const line of lines) {
            // Callout / Policy link
            if (
                line.toLowerCase().includes('xem chi tiết tại') ||
                line.includes('Thông báo ->') ||
                line.includes('Chính sách ->') ||
                line.includes('Thông báo →')
            ) {
                currentArticle.callout = line;
                continue;
            }

            // Bullet pair or regular bullet
            if (line.startsWith('•') || line.startsWith('-')) {
                const raw = line.replace(/^[•\-]\s*/, '').trim();
                const colonIndex = raw.indexOf(':');
                if (colonIndex > 0 && colonIndex < 35 && raw.length < 85) {
                    const label = raw.slice(0, colonIndex).trim();
                    const value = raw.slice(colonIndex + 1).trim();
                    if (!currentArticle.tableRows) currentArticle.tableRows = [];
                    currentArticle.tableRows.push({ stt: rowStt++, label, value });
                } else if (raw.toLowerCase().includes('thưởng') || raw.toLowerCase().includes('100.000') || raw.toLowerCase().includes('/tuần')) {
                    // Extract reward rate and merge directly into table row
                    const rewardMatch = raw.match(/(\d+[\d.,]*\s*đ(?:\/[a-zA-Zà-ỹ]+)?)/i);
                    const rewardVal = rewardMatch ? rewardMatch[1].replace(/\s+/g, '') : '100.000đ/tuần';
                    if (!currentArticle.tableRows) currentArticle.tableRows = [];
                    currentArticle.tableRows.push({
                        stt: rowStt++,
                        label: 'Thưởng thắng tuần',
                        value: rewardVal.includes('/') ? rewardVal : `${rewardVal}/tuần`,
                    });
                } else {
                    if (!currentArticle.bullets) currentArticle.bullets = [];
                    currentArticle.bullets.push(raw);
                }
                continue;
            }

            // Section heading
            const isHeading = (line.length < 50 && !line.endsWith('.') && !line.startsWith('http') && !line.startsWith('Công ty') && !line.startsWith('Theo')) || line.endsWith(':');
            if (isHeading) {
                const cleanHeading = line.replace(/:$/, '').trim();
                // If heading is "Thưởng thắng tuần", merge it under current table instead of creating a separate section
                if (cleanHeading.toLowerCase().includes('thưởng thắng tuần') && currentArticle.tableRows && currentArticle.tableRows.length > 0) {
                    continue;
                }

                const hasContent = currentArticle.paragraphs.length > 0 ||
                    (currentArticle.tableRows && currentArticle.tableRows.length > 0) ||
                    (currentArticle.bullets && currentArticle.bullets.length > 0) ||
                    currentArticle.callout;
                if (hasContent) {
                    articles.push(currentArticle);
                }
                currentArticle = {
                    title: cleanHeading,
                    paragraphs: [],
                    tableRows: [],
                    bullets: [],
                };
                rowStt = 1;
                continue;
            }

            // Standard text paragraph
            currentArticle.paragraphs.push(line);
        }

        const hasContent = currentArticle.paragraphs.length > 0 ||
            (currentArticle.tableRows && currentArticle.tableRows.length > 0) ||
            (currentArticle.bullets && currentArticle.bullets.length > 0) ||
            currentArticle.callout;
        if (hasContent) {
            articles.push(currentArticle);
        }

        // Filter out generic intro sections with no table or bullets
        return articles.filter(art => {
            const isJustIntro = art.title.toLowerCase().includes('nội dung và phạm vi') &&
                (!art.tableRows || art.tableRows.length === 0) &&
                (!art.bullets || art.bullets.length === 0);
            return !isJustIntro;
        });
    }, [selected?.content]);
    const selectedRequiresAcknowledgement = selected ? requiresNotificationAcknowledgement(selected) : false;
    const featuredVisual = featured ? getItemVisual(featured) : null;
    const requiredRecipients = recipients.filter(recipient => recipient.required !== false);
    const acknowledgedRecipients = requiredRecipients.filter(recipient => recipient.acknowledgedAt).length;
    const visibleRecipients = requiredRecipients.filter(recipient => recipientStatus === 'all'
        || (recipientStatus === 'acknowledged' ? Boolean(recipient.acknowledgedAt) : !recipient.acknowledgedAt));

    useEffect(() => {
        setConfirmed(false);
        if (selected && !selected.recipient?.readAt) void inbox.markRead(selected.id);
    }, [selected?.id]);

    useEffect(() => {
        if (!selected?.requireAcknowledgement || !isAdmin) {
            setRecipients([]);
            return;
        }
        let cancelled = false;
        setRecipientsLoading(true);
        void inbox.getRecipients(selected.id).then(result => {
            if (cancelled) return;
            const data = result.success && Array.isArray(result.data) ? result.data : [];
            setRecipients(data);
            setRequiredRecipientIds(data
                .filter(recipient => recipient.required !== false && !recipient.readAt && !recipient.acknowledgedAt)
                .map(recipient => recipient.id));
            if (!result.success) message.error(result.error || 'Không tải được danh sách xác nhận.');
        }).finally(() => {
            if (!cancelled) setRecipientsLoading(false);
        });
        return () => { cancelled = true; };
    }, [inbox.getRecipients, isAdmin, selected?.id, selected?.requireAcknowledgement]);

    useEffect(() => {
        if (selectedId) return;
        const frame = window.requestAnimationFrame(() => {
            if (feedRef.current) feedRef.current.scrollTop = 0;
        });
        return () => window.cancelAnimationFrame(frame);
    }, [query, selectedId, sort]);

    const selectItem = (item: Announcement) => {
        setSelectedId(item.id);
        if (!item.recipient?.readAt) void inbox.markRead(item.id);
    };

    const acknowledge = async () => {
        if (!selected) return;
        setSaving(true);
        const result = await inbox.acknowledge(selected.id);
        setSaving(false);
        if (result.success) message.success('Đã lưu xác nhận của bạn.');
        else message.error(result.error || 'Không thể lưu xác nhận.');
    };

    const toggleRequiredRecipient = (recipient: AnnouncementRecipientAudit) => {
        if (recipient.readAt || recipient.acknowledgedAt) return;
        const userId = recipient.id;
        setRequiredRecipientIds(current => current.includes(userId)
            ? current.filter(id => id !== userId)
            : [...current, userId]);
    };

    const openRecipientSetup = async (announcement: Announcement) => {
        setSelectedId(announcement.id);
        setRecipientSetupOpen(true);
        setRecipientSetupLoading(true);
        const result = await inbox.getRecipients(announcement.id);
        if (result.success && Array.isArray(result.data)) {
            setRecipients(result.data);
            setRequiredRecipientIds(result.data
                .filter(recipient => recipient.required !== false && !recipient.readAt && !recipient.acknowledgedAt)
                .map(recipient => recipient.id));
        } else {
            message.error(result.error || 'Không tải được danh sách nhân viên chính thức.');
        }
        setRecipientSetupLoading(false);
    };

    const saveRecipientSetup = async () => {
        if (!selected) return;
        if (requiredRecipientIds.length === 0) {
            message.warning('Hãy chọn ít nhất một nhân viên chính thức cần xác nhận.');
            return;
        }
        setRecipientSetupSaving(true);
        const result = await inbox.publish(selected.id, requiredRecipientIds);
        setRecipientSetupSaving(false);
        if (!result.success) {
            message.error(result.error || 'Không thể phát hành thông báo.');
            return;
        }
        const refreshedRecipients = await inbox.getRecipients(selected.id);
        if (refreshedRecipients.success && Array.isArray(refreshedRecipients.data)) {
            setRecipients(refreshedRecipients.data);
            setRequiredRecipientIds(refreshedRecipients.data
                .filter(recipient => recipient.required !== false && !recipient.readAt && !recipient.acknowledgedAt)
                .map(recipient => recipient.id));
        }
        setRecipientSetupOpen(false);
        message.success(`Đã phát hành thông báo tới ${requiredRecipientIds.length} nhân viên.`);
    };

    if (selected?.source === 'personal') {
        const visual = getItemVisual(selected);
        const Icon = visual.Icon;
        return (
            <section className="notification-center notification-center--personal">
                <header className="personal-notification-toolbar">
                    <button type="button" className="official-back-btn" onClick={() => setSelectedId(null)} aria-label="Quay lại danh sách thông báo">
                        <ArrowLeftOutlined /> <span>Quay lại danh sách</span>
                    </button>
                    <span className="personal-notification-label">Thông báo cá nhân</span>
                </header>
                <article className="personal-notification-card">
                    <div className={`personal-notification-icon tone-${visual.tone}`}><Icon /></div>
                    <div className="personal-notification-meta"><NotificationTags item={selected} /><span>{getPublishedTime(selected)}</span></div>
                    <h1>{selected.title}</h1>
                    <p className="personal-notification-summary">{selected.summary}</p>
                    <div className="personal-notification-content">{selected.content.split('\n').map((line, index) => line ? <p key={`${selected.id}-${index}`}>{line}</p> : <div key={`${selected.id}-${index}`} className="personal-notification-spacer" />)}</div>
                    <div className="personal-notification-footnote">Thông tin được cập nhật tự động từ dữ liệu chấm công của bạn.</div>
                </article>
            </section>
        );
    }

    if (selected) {
        return (
            <section className="notification-center notification-center--official-doc">
                {/* Formal Document Top Action Bar */}
                <header className="official-paper-toolbar">
                    <div className="official-toolbar-left">
                        <button
                            type="button"
                            className="official-back-btn"
                            onClick={() => setSelectedId(null)}
                            aria-label="Quay lại danh sách thông báo"
                        >
                            <ArrowLeftOutlined />
                            <span>Quay lại danh sách</span>
                        </button>
                        <span className="official-breadcrumb-sep">/</span>
                        <span className="official-doc-type-label">
                            Công văn thông báo nội bộ
                        </span>
                    </div>

                    <div className="official-toolbar-right">
                        <button
                            type="button"
                            className="official-print-btn"
                            onClick={() => window.print()}
                            title="In trực tiếp hoặc Lưu dưới dạng file PDF chuẩn A4"
                        >
                            <PrinterOutlined />
                            <span>In văn bản (A4)</span>
                        </button>

                        {selected.recipient?.acknowledgedAt ? (
                            <span className="official-status-pill is-acknowledged">
                                <CheckCircleFilled /> Đã ký nhận văn bản
                            </span>
                        ) : selectedRequiresAcknowledgement ? (
                            <span className="official-status-pill is-pending">
                                <ClockCircleOutlined /> Yêu cầu ký duyệt
                            </span>
                        ) : (
                            <span className="official-status-pill is-info">
                                <FileTextOutlined /> Đã ban hành chính thức
                            </span>
                        )}
                    </div>
                </header>

                <main className="official-paper-viewport">
                    {/* The Shopee-Styled Announcement Canvas */}
                    <article className="shopee-notice-canvas" id="official-doc-print-area">
                        {/* 1. Shopee Top Crimson Header Banner */}
                        <div className="shopee-notice-banner">
                            <h1>
                                CẬP NHẬT VỀ {selected.title.toUpperCase()} TỪ NGÀY {formatDatePadded(selected.effectiveAt)}
                            </h1>
                        </div>

                        {/* 2. Shopee Lead-in Text */}
                        <div className="shopee-notice-intro">
                            <p>
                                Theo đó, từ ngày <span className="shopee-highlight-date">{formatDatePadded(selected.effectiveAt)}</span>,{' '}
                                {selected.issuer || 'Hệ thống'} cập nhật một số thay đổi về{' '}
                                <span className="shopee-highlight-bold">{selected.title}</span> như sau:
                            </p>
                        </div>

                        {/* 3. Numbered Sections */}
                        <div className="shopee-sections-list">
                            {parsedOfficialArticles.map((art, aIdx) => (
                                <section key={aIdx} className="shopee-section-block">
                                    <h2 className="shopee-section-heading">
                                        {aIdx + 1}. {art.title.toUpperCase()}
                                    </h2>

                                    {art.tableRows && art.tableRows.length > 0 ? (
                                        <p className="shopee-section-subtext">
                                            {selected.issuer || 'Công ty'} điều chỉnh {art.title} với chi tiết mức của từng hạng mục trong bảng dưới đây:
                                        </p>
                                    ) : (
                                        art.paragraphs.map((p, pIdx) => (
                                            <p key={pIdx} className="shopee-section-subtext">{p}</p>
                                        ))
                                    )}

                                    {/* Signature Shopee Dual-Header Comparison Table */}
                                    {art.tableRows && art.tableRows.length > 0 && (
                                        <div className="shopee-table-wrapper">
                                            <table className="shopee-spec-table">
                                                <thead>
                                                    <tr className="tr-header-top">
                                                        <th className="th-navy" style={{ width: '48px' }}>STT</th>
                                                        <th className="th-navy">Nhóm công việc</th>
                                                        <th className="th-navy">Phân loại hạng mục</th>
                                                        <th className="th-navy">Quy cách chi tiết</th>
                                                        <th className="th-coral" colSpan={2}>
                                                            <div className="th-coral-main-title">Mức đơn giá áp dụng</div>
                                                            <div className="th-coral-sub-title">(Đã bao gồm thuế GTGT)</div>
                                                        </th>
                                                    </tr>
                                                    <tr className="tr-header-sub">
                                                        <th className="th-navy-sub" colSpan={4}>Tiêu chuẩn hạng mục</th>
                                                        <th className="th-coral-sub" style={{ width: '130px' }}>
                                                            Trước {formatDatePadded(selected.effectiveAt)}
                                                        </th>
                                                        <th className="th-coral-sub" style={{ width: '130px' }}>
                                                            Từ {formatDatePadded(selected.effectiveAt)}
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {art.tableRows.map((row) => {
                                                        const lower = row.label.toLowerCase();
                                                        const isReward = lower.includes('thưởng') || lower.includes('tuần');
                                                        const isBig = lower.includes('thùng') || lower.includes('kiện');
                                                        
                                                        const category = isReward ? 'Khen thưởng / Hiệu suất' : (isBig ? 'Hàng cồng kềnh' : 'Đóng gói bưu kiện');
                                                        const subCat = isReward ? 'Đạt top 1 sản lượng tuần' : (isBig ? 'Kiện lớn / Thùng carton' : 'Hàng tiêu chuẩn');
                                                        const prevRate = getPreviousRate(row.label, row.value);
                                                        const newRate = row.value;

                                                        return (
                                                            <tr key={row.stt} className="tr-data-row">
                                                                <td className="td-center td-stt">{row.stt}</td>
                                                                <td className="td-cat">{category}</td>
                                                                <td className="td-level"><b>{row.label}</b></td>
                                                                <td className="td-subcat">{subCat}</td>
                                                                <td className="td-center td-old-rate">{prevRate}</td>
                                                                <td className="td-center td-rate">
                                                                    <b>{newRate}</b>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    <tr className="tr-fallback-row">
                                                        <td colSpan={4} className="td-fallback-title">Các hạng mục / trường hợp còn lại</td>
                                                        <td colSpan={2} className="td-center td-fallback-val">Không điều chỉnh</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {art.bullets && art.bullets.length > 0 && (
                                        <div className="shopee-bullets-container">
                                            {art.bullets.map((b, bIdx) => (
                                                <div key={bIdx} className="shopee-bullet-item">
                                                    <span className="shopee-bullet-circle" />
                                                    <span className="shopee-bullet-text">{b}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                </section>
                            ))}
                            {/* Compact Admin Audit Inline Bar right below notice */}
                            {isAdmin && selected.requireAcknowledgement && (
                                <div className="shopee-notice-ack-inline">
                                    <div className="ack-inline-left">
                                        <span className="ack-inline-label">Người xác nhận:</span>
                                        {recipientsLoading ? (
                                            <Spin size="small" />
                                        ) : requiredRecipients.length === 0 ? (
                                            <span className="ack-inline-empty">Chưa có nhân sự nào</span>
                                        ) : (
                                            <div className="ack-inline-avatars">
                                                {requiredRecipients.map(r => {
                                                    const isAck = Boolean(r.acknowledgedAt);
                                                    const initial = getVietnameseInitials(r.fullName, r.username);
                                                    const nameDisplay = r.fullName || r.username;
                                                    const tooltipText = isAck
                                                        ? `${nameDisplay} (Đã xác nhận: ${formatDateTime(r.acknowledgedAt)})`
                                                        : `${nameDisplay} (Chưa xác nhận)`;

                                                    return (
                                                        <Tooltip key={r.id} title={tooltipText}>
                                                            <div className={`ack-avatar-item ${isAck ? 'is-acked' : 'is-pending'}`}>
                                                                <span className="ack-avatar-badge">{initial}</span>
                                                                {isAck && <CheckCircleFilled className="ack-avatar-check-icon" />}
                                                            </div>
                                                        </Tooltip>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <span className="ack-inline-count">
                                            ({acknowledgedRecipients}/{requiredRecipients.length})
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        className="ack-inline-setup-btn"
                                        onClick={() => void openRecipientSetup(selected)}
                                    >
                                        <SendOutlined />
                                        <span>Phát hành thêm</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </article>
                    <Modal
                        title="Phát hành thông báo"
                        open={recipientSetupOpen}
                        okText="Phát hành"
                        cancelText="Hủy"
                        confirmLoading={recipientSetupSaving || recipientSetupLoading}
                        okButtonProps={{ disabled: recipientSetupLoading || requiredRecipientIds.length === 0 }}
                        onCancel={() => setRecipientSetupOpen(false)}
                        onOk={saveRecipientSetup}
                    >
                        <p>Chọn nhân viên chính thức bắt buộc nhận và xác nhận thông báo này. Người đã đọc sẽ được khóa để không phát hành lại; admin vẫn xem và theo dõi nhưng không cần xác nhận.</p>
                        <div className="notification-recipient-setup">
                            {recipientSetupLoading ? <div className="notification-acknowledgements__state"><Spin size="small" /> Đang tải nhân viên chính thức...</div> : recipients.map(recipient => {
                                const alreadyRead = Boolean(recipient.readAt || recipient.acknowledgedAt);
                                return (
                                    <Checkbox
                                        key={recipient.id}
                                        checked={alreadyRead || requiredRecipientIds.includes(recipient.id)}
                                        disabled={alreadyRead}
                                        onChange={() => toggleRequiredRecipient(recipient)}
                                    >
                                        <span className="notification-recipient-setup__identity">
                                            <span><strong>{recipient.fullName || recipient.username}</strong> @{recipient.username}</span>
                                            {alreadyRead && <small><CheckCircleFilled /> Đã đọc — không phát hành lại</small>}
                                        </span>
                                    </Checkbox>
                                );
                            })}
                            {!recipientSetupLoading && recipients.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có nhân viên chính thức để chọn" />}
                        </div>
                    </Modal>
                </main>

                {/* Floating Bottom Acknowledgement Bar */}
                {selectedRequiresAcknowledgement && (
                    <footer className="official-paper-ack-bar">
                        {selected.recipient?.acknowledgedAt ? (
                            <div className="official-paper-ack-bar__confirmed">
                                <CheckCircleFilled />
                                <span>Bạn đã ký nhận thông báo này lúc <b>{formatDateTime(selected.recipient.acknowledgedAt)}</b></span>
                            </div>
                        ) : (
                            <div className="official-paper-ack-bar__form">
                                <Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>
                                    Tôi xác nhận đã đọc toàn bộ văn bản thông báo số <b>{selected.policyCode || `TB-${selected.id}`}</b> và cam kết nghiêm túc thi hành.
                                </Checkbox>
                                <Button type="primary" disabled={!confirmed} loading={saving} onClick={acknowledge} className="official-ack-submit-btn">
                                    Ký xác nhận thông báo
                                </Button>
                            </div>
                        )}
                    </footer>
                )}
            </section>
        );
    }

    return (
        <section className="notification-center">
            <div className="notification-center__content">
                <div className="notification-primary-tabs" role="tablist" aria-label="Thông báo và chính sách">
                    <button type="button" role="tab" aria-selected={view === 'notifications'} className={view === 'notifications' ? 'is-active' : ''} onClick={() => setView('notifications')}>Thông báo <span>{inbox.items.length}</span></button>
                    <button type="button" role="tab" aria-selected={view === 'policies'} className={view === 'policies' ? 'is-active' : ''} onClick={() => setView('policies')}>Chính sách</button>
                </div>

                {view === 'policies' ? <PolicyLibrary /> : <>
                <div className="notification-filters">
                    <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm kiếm nhanh thông báo, quy định, mã văn bản..." value={query} onChange={event => setQuery(event.target.value)} />
                    <Select value={sort} onChange={setSort} options={[{ value: 'newest', label: 'Mới nhất trước' }, { value: 'oldest', label: 'Cũ nhất trước' }]} />
                </div>

                <div className="notification-feed-shell">
                    {featured && featuredVisual && !query && (
                        <article className="notification-featured" onClick={() => selectItem(featured)} role="button" tabIndex={0}>
                            <span className="notification-timeline-dot tone-orange" />
                            <span className="notification-featured__icon"><featuredVisual.Icon /></span>
                            <span className="notification-featured__content">
                                <span><strong>BẮT BUỘC XÁC NHẬN</strong><em>Vận hành kho</em>{featured.policyCode && <code>{featured.policyCode}</code>}</span>
                                <b>{featured.title}</b>
                                <small>{featured.summary}</small>
                            </span>
                            <span className="notification-card__schedule is-deadline">
                                <span>Hạn chót: <strong>{getDeadline(featured)}</strong></span>
                                <small><ClockCircleOutlined /> {getRemaining(featured)}</small>
                            </span>
                            <button type="button" className="notification-featured__cta" onClick={event => { event.stopPropagation(); selectItem(featured); }}>Xem & Ký duyệt <ArrowRightOutlined /></button>
                        </article>
                    )}

                    <div ref={feedRef} className="notification-feed" aria-label="Danh sách thông báo">
                    {inbox.loading && inbox.items.length === 0 ? (
                        <div className="notification-list__state"><Spin /></div>
                    ) : filtered.length === 0 ? (
                        <div className="notification-list__state"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có thông báo phù hợp" /></div>
                    ) : filtered.map(item => {
                        const visual = getItemVisual(item);
                        return (
                            <article
                                key={item.id}
                                className={`notification-feed-card tone-${visual.tone}${!item.recipient?.readAt ? ' is-unread' : ''}${requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt ? ' is-required' : ''}`}
                                onClick={() => selectItem(item)}
                                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectItem(item); }}
                                role="button"
                                tabIndex={0}
                            >
                                <span className={`notification-timeline-dot tone-${visual.tone}`} />
                                <span className="notification-feed-card__icon"><visual.Icon /></span>
                                <div className="notification-feed-card__body">
                                    <div className="notification-feed-card__topline">
                                        <NotificationTags item={item} />
                                        {item.policyCode && <code>{item.policyCode}</code>}
                                    </div>
                                    <h2>{item.title}</h2>
                                    <p>{item.summary}</p>
                                    <div className="notification-feed-card__meta">
                                        <span><ToolOutlined /> {item.issuer || 'DBY Software'}</span>
                                        <i />
                                        <span><CalendarOutlined /> Hiệu lực: {formatDate(item.effectiveAt)}</span>
                                    </div>
                                </div>
                                <div className={`notification-card__schedule${requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt ? ' is-deadline' : ''}`}>
                                    <time>{getPublishedTime(item)}</time>
                                    <span><CalendarOutlined /> {requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt ? 'Hạn chót' : 'Hiệu lực'}: <strong>{getDeadline(item)}</strong></span>
                                </div>
                                {isAdmin && item.requireAcknowledgement ? (
                                    <button
                                        type="button"
                                        className="notification-feed-card__cta"
                                        onClick={event => {
                                            event.stopPropagation();
                                            void openRecipientSetup(item);
                                        }}
                                    >
                                        <SendOutlined /> Phát hành thông báo
                                    </button>
                                ) : (
                                    <button type="button" className="notification-feed-card__cta" onClick={event => { event.stopPropagation(); selectItem(item); }}>
                                        {requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt ? 'Xem chi tiết & Ký xác nhận' : visual.cta} <ArrowRightOutlined />
                                    </button>
                                )}
                            </article>
                        );
                    })}
                    {inbox.error && <div className="notification-list__error">{inbox.error}</div>}
                    </div>
                </div>
                </>}
            </div>

        </section>
    );
}
