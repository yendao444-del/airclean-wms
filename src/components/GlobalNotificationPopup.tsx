import { useEffect, useState } from 'react';
import { Button, Checkbox, Modal, Tag, message } from 'antd';
import { BellOutlined, CheckCircleFilled, SafetyCertificateOutlined } from '@ant-design/icons';
import type { Announcement } from '../types/electron';
import '../pages/NotificationCenter.css';

interface GlobalNotificationPopupProps {
    announcement: Announcement | null;
    suppressed?: boolean;
    onMarkRead: (id: number) => Promise<any>;
    onAcknowledge: (id: number) => Promise<any>;
}

const formatDate = (value?: string | null) => value
    ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok' }).format(new Date(value))
    : 'Áp dụng ngay';

interface PackingPolicyRow {
    label: string;
    previous: string;
    current: string;
}

const parsePackingPolicyRows = (content: string): PackingPolicyRow[] => {
    const rows: PackingPolicyRow[] = [];
    content.split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
        if (!line.startsWith('•')) return;
        const raw = line.slice(1).trim();
        if (raw.toLocaleLowerCase('vi-VN').startsWith('ngày sale')) {
            rows.push({ label: 'Ngày sale', previous: 'Đơn giá thường', current: '+ 50% hoa hồng' });
            return;
        }
        const colonIndex = raw.indexOf(':');
        if (colonIndex > 0 && colonIndex < 35) {
            const label = raw.slice(0, colonIndex).trim();
            const value = raw.slice(colonIndex + 1).trim();
            const [previous, current] = value.split(/\s*→\s*/, 2);
            rows.push({
                label,
                previous: current ? previous : '20đ/sp',
                current: current || value,
            });
            return;
        }
        const reward = raw.match(/\d+[\d.,]*\s*đ(?:\/[^\s]+)?/i)?.[0]?.replace(/\s+/g, '');
        if (reward && (raw.toLocaleLowerCase('vi-VN').includes('tuần') || raw.includes('100.000'))) {
            rows.push({ label: 'Thưởng thắng tuần', previous: 'Không áp dụng', current: reward });
        }
    });
    return rows;
};

export default function GlobalNotificationPopup({
    announcement,
    suppressed,
    onMarkRead,
    onAcknowledge,
}: GlobalNotificationPopupProps) {
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setConfirmed(false);
        if (announcement && !suppressed) void onMarkRead(announcement.id);
    }, [announcement?.id, suppressed]);

    if (!announcement) return null;

    const acknowledge = async () => {
        setSaving(true);
        const result = await onAcknowledge(announcement.id);
        setSaving(false);
        if (!result.success) message.error(result.error || 'Không thể lưu xác nhận.');
    };

    const contentLines = announcement.content.split('\n').map(line => line.trim()).filter(Boolean);
    const isPackingPolicy = announcement.policyCode?.startsWith('PKG-REWARD-WEEKLY') === true;
    const isSchedulePolicy = announcement.policyCode === 'ATT-SCHEDULE-2026.09';
    const packingRows = isPackingPolicy ? parsePackingPolicyRows(announcement.content) : [];

    return (
        <Modal
            className="notification-popup"
            open={!suppressed}
            closable={false}
            maskClosable={false}
            keyboard={false}
            width={isPackingPolicy || isSchedulePolicy ? 860 : 720}
            footer={null}
            centered
        >
            <div className="notification-popup__eyebrow">
                <span><BellOutlined /> Thông báo mới cần xác nhận</span>
                <Tag color="orange">Hiệu lực {formatDate(announcement.effectiveAt)}</Tag>
            </div>
            {isSchedulePolicy ? (
                <div className="notification-popup__official-document">
                    <div className="notification-popup__document-banner">
                        THAY ĐỔI THỜI GIAN ĐI LÀM TỪ NGÀY {formatDate(announcement.effectiveAt)}
                    </div>
                    <p className="notification-popup__document-intro">
                        Kể từ ngày <strong>{formatDate(announcement.effectiveAt)}</strong>, {announcement.issuer || 'Phòng vận hành'} chính thức áp dụng giờ ca chiều mới cho nhân viên chính thức:
                    </p>
                    <div className="notification-popup__table-wrap">
                        <table className="notification-popup__policy-table">
                            <thead><tr><th>STT</th><th>Nhóm thời gian</th><th>Trước ngày áp dụng</th><th>Từ ngày áp dụng</th></tr></thead>
                            <tbody>
                                <tr><td>1</td><td><strong>Ca chiều - Chính thức</strong></td><td>13:30</td><td><strong>13:00</strong></td></tr>
                                <tr><td>2</td><td><strong>Ca chiều - Thời vụ</strong></td><td>13:30</td><td><strong>13:30 (giữ nguyên)</strong></td></tr>
                                <tr><td>3</td><td><strong>Thời gian linh động</strong></td><td>5 phút</td><td><strong>5 phút</strong></td></tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="notification-popup__document-intro"><strong>Lưu ý:</strong> Ca sáng vẫn là 08:00. Dữ liệu cũ giữ nguyên; giờ 13:00 chỉ áp dụng cho nhân viên chính thức từ 00:00 ngày {formatDate(announcement.effectiveAt)}.</p>
                </div>
            ) : isPackingPolicy && packingRows.length > 0 ? (
                <div className="notification-popup__official-document">
                    <div className="notification-popup__document-banner">
                        CẬP NHẬT VỀ {announcement.title.toUpperCase()} TỪ NGÀY {formatDate(announcement.effectiveAt)}
                    </div>
                    <p className="notification-popup__document-intro">
                        Từ ngày <strong>{formatDate(announcement.effectiveAt)}</strong>, {announcement.issuer || 'Công ty'} áp dụng các mức mới như sau:
                    </p>
                    <div className="notification-popup__table-wrap">
                        <table className="notification-popup__policy-table">
                            <thead>
                                <tr>
                                    <th>STT</th>
                                    <th>Hạng mục</th>
                                    <th>Trước {formatDate(announcement.effectiveAt)}</th>
                                    <th>Từ {formatDate(announcement.effectiveAt)}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {packingRows.map((row, index) => (
                                    <tr key={`${row.label}-${index}`}>
                                        <td>{index + 1}</td>
                                        <td><strong>{row.label}</strong></td>
                                        <td>{row.previous}</td>
                                        <td><strong>{row.current}</strong></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="notification-popup__official-document">
                    <div className="notification-popup__document-banner">
                        {announcement.title.toUpperCase()} TỪ NGÀY {formatDate(announcement.effectiveAt)}
                    </div>
                    <p className="notification-popup__document-intro">{announcement.summary}</p>
                    <div className="notification-popup__content">
                        {contentLines.map((line, index) => line.startsWith('•') ? (
                            <p className="notification-popup__bullet" key={index}><CheckCircleFilled />{line.slice(1).trim()}</p>
                        ) : <p key={index}>{line}</p>)}
                    </div>
                </div>
            )}
            <div className="notification-popup__privacy">
                <SafetyCertificateOutlined />
                <span>Đây là thông báo quan trọng. Bạn cần đọc và xác nhận trước khi tiếp tục sử dụng phần mềm.</span>
            </div>
            <Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>
                Tôi xác nhận đã đọc đầy đủ và hiểu nội dung thông báo này
            </Checkbox>
            <div className="notification-popup__actions">
                <Button type="primary" disabled={!confirmed} loading={saving} onClick={acknowledge}>
                    Tôi đã đọc và hiểu
                </Button>
            </div>
        </Modal>
    );
}
