import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Announcement, AnnouncementRecipientAudit } from '../types/electron';
import { requiresNotificationAcknowledgement } from './notificationAcknowledgement';

const notificationUiTestItems: Announcement[] = [
    {
        id: 900001,
        title: 'Tăng hoa hồng đóng gói và thưởng thắng tuần',
        summary: 'Đơn giá hiện hành: Dễ: 20đ/gói · Trung bình: 50đ/gói · Cao: 100đ/gói · Thùng kiện to: 500đ/kiện. Thưởng thắng tuần: 100.000đ.',
        content: 'Công ty tăng hoa hồng đóng gói và áp dụng thưởng thắng tuần cho nhân viên đóng gói.\n\nHoa hồng đóng gói hiện hành\n• Dễ: 20đ/gói\n• Trung bình: 50đ/gói\n• Cao: 100đ/gói\n• Thùng kiện to: 500đ/kiện\n\nThưởng thắng tuần\n• 100.000đ/tuần cho nhân viên có kết quả đóng gói cao nhất tuần, căn cứ dữ liệu ghi nhận trên hệ thống.\n\nXem chi tiết tại Thông báo → Chính sách → Hoa hồng đóng gói / Thưởng thắng tuần.',
        category: 'policy', severity: 'reward', status: 'published',
        effectiveAt: '2026-09-01T00:00:00.000Z', publishedAt: '2026-09-01T00:00:00.000Z',
        requireAcknowledgement: true, version: 3, policyCode: 'PKG-REWARD-WEEKLY',
        issuer: 'Phòng vận hành', createdByName: 'Thúy Lê (Admin)', recipient: {
            readAt: '2026-09-08T02:00:00.000Z',
            acknowledgedAt: '2026-09-08T02:05:00.000Z',
        },
    },
];

export function useNotificationInbox(userId?: number) {
    const [items, setItems] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!userId) return;
        if (!window.electronAPI?.notifications) {
            if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest')) {
                setItems(current => current.length > 0 ? current : notificationUiTestItems);
            }
            return;
        }
        setLoading(true);
        try {
            const result = await window.electronAPI.notifications.list();
            if (!result.success || !Array.isArray(result.data)) {
                setError(result.error || 'Không tải được thông báo.');
                return;
            }
            setItems(result.data);
            setError('');
        } catch {
            setError('Không tải được thông báo.');
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) {
            setItems([]);
            return;
        }
        void refresh();
        const dispose = window.electronAPI?.notifications?.onChanged?.((event) => {
            if (!event?.userId || event.userId === userId) void refresh();
        });
        return () => dispose?.();
    }, [refresh, userId]);

    const mutate = useCallback(async (
        id: number,
        action: 'markRead' | 'acknowledge' | 'snooze',
    ) => {
        const api = window.electronAPI?.notifications;
        if (!api && import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest')) {
            const now = new Date().toISOString();
            setItems(current => current.map(item => item.id !== id ? item : {
                ...item,
                recipient: {
                    ...item.recipient,
                    readAt: item.recipient?.readAt || now,
                    acknowledgedAt: action === 'acknowledge' ? now : item.recipient?.acknowledgedAt,
                    snoozedUntil: action === 'snooze' ? new Date(Date.now() + 86400000).toISOString() : item.recipient?.snoozedUntil,
                },
            }));
            return { success: true };
        }
        if (!api) return { success: false, error: 'Chức năng chỉ khả dụng trong ứng dụng desktop.' };
        const result = await api[action](id);
        if (result.success) await refresh();
        return result;
    }, [refresh]);

    const unreadCount = useMemo(
        () => items.filter(item => !item.recipient?.readAt).length,
        [items],
    );
    const requiredCount = useMemo(
        () => items.filter(item => requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt).length,
        [items],
    );
    const attentionCount = useMemo(
        () => items.filter(item => !item.recipient?.readAt
            || (requiresNotificationAcknowledgement(item) && !item.recipient?.acknowledgedAt)).length,
        [items],
    );
    const popupAnnouncement = useMemo(() => {
        const now = Date.now();
        return items.find(item => {
            if (!requiresNotificationAcknowledgement(item) || item.recipient?.acknowledgedAt) return false;
            const snoozedUntil = item.recipient?.snoozedUntil
                ? new Date(item.recipient.snoozedUntil).getTime()
                : 0;
            return !snoozedUntil || snoozedUntil <= now;
        }) || null;
    }, [items]);

    const getRecipients = useCallback(async (id: number): Promise<{ success: boolean; data?: AnnouncementRecipientAudit[]; error?: string }> => {
        const api = window.electronAPI?.notifications;
        if (!api && import.meta.env.DEV && new URLSearchParams(window.location.search).has('notificationUiTest')) {
            return {
                success: true,
                data: [
                    { id: 11, username: 'nguyenvana', fullName: 'Nguyễn Văn A', role: 'staff', required: true, deliveredAt: '2026-09-09T01:00:00.000Z', readAt: '2026-09-09T01:04:00.000Z', acknowledgedAt: '2026-09-09T01:05:00.000Z' },
                    { id: 12, username: 'tranthib', fullName: 'Trần Thị B', role: 'staff', required: true, deliveredAt: '2026-09-09T01:00:00.000Z', readAt: '2026-09-09T01:10:00.000Z', acknowledgedAt: null },
                    { id: 13, username: 'lequangc', fullName: 'Lê Quang C', role: 'manager', required: true, deliveredAt: '2026-09-09T01:00:00.000Z', readAt: '2026-09-09T01:02:00.000Z', acknowledgedAt: '2026-09-09T01:03:00.000Z' },
                ],
            };
        }
        if (!api) return { success: false, error: 'Chức năng chỉ khả dụng trong ứng dụng desktop.' };
        return api.getRecipients(id);
    }, []);

    const publish = useCallback(async (id: number, userIds: number[]) => {
        const api = window.electronAPI?.notifications;
        if (!api) return { success: false, error: 'Chức năng chỉ khả dụng trong ứng dụng desktop.' };
        const result = await api.publish(id, userIds);
        if (result.success) await refresh();
        return result;
    }, [refresh]);

    return {
        items,
        loading,
        error,
        unreadCount,
        requiredCount,
        attentionCount,
        popupAnnouncement,
        refresh,
        getRecipients,
        publish,
        markRead: (id: number) => mutate(id, 'markRead'),
        acknowledge: (id: number) => mutate(id, 'acknowledge'),
        snooze: (id: number) => mutate(id, 'snooze'),
    };
}

export type NotificationInbox = ReturnType<typeof useNotificationInbox>;
