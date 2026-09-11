CREATE TABLE "Announcement" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "status" TEXT NOT NULL DEFAULT 'published',
    "audienceRoles" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "requireAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "policyCode" TEXT,
    "issuer" TEXT,
    "createdBy" INTEGER,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRecipient" (
    "id" SERIAL NOT NULL,
    "announcementId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_status_publishedAt_idx" ON "Announcement"("status", "publishedAt");
CREATE INDEX "Announcement_effectiveAt_idx" ON "Announcement"("effectiveAt");
CREATE INDEX "Announcement_category_idx" ON "Announcement"("category");
CREATE UNIQUE INDEX "AnnouncementRecipient_announcementId_userId_key" ON "AnnouncementRecipient"("announcementId", "userId");
CREATE INDEX "AnnouncementRecipient_userId_readAt_idx" ON "AnnouncementRecipient"("userId", "readAt");
CREATE INDEX "AnnouncementRecipient_userId_acknowledgedAt_idx" ON "AnnouncementRecipient"("userId", "acknowledgedAt");

ALTER TABLE "AnnouncementRecipient" ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey"
FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient" ADD CONSTRAINT "AnnouncementRecipient_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Announcement" (
    "title", "summary", "content", "category", "severity", "status",
    "audienceRoles", "effectiveAt", "publishedAt", "requireAcknowledgement",
    "version", "policyCode", "issuer", "createdByName", "updatedAt"
) VALUES
(
    'Cập nhật cơ chế thưởng đóng gói tháng 09/2026',
    'Áp dụng cho nhân viên đóng gói từ kỳ vận hành tháng 09/2026.',
    'Thông báo này cập nhật cách ghi nhận thưởng đóng gói trong kỳ vận hành tháng 09/2026, áp dụng thống nhất cho các đơn hợp lệ sau khi bàn giao.\n\n• Tính thưởng theo số gói hợp lệ, số đơn và hệ số hiệu suất trong kỳ.\n• Loại trừ đơn hoàn, đơn hủy sau khi bàn giao.\n• Thưởng và phạt liên quan được tổng hợp trong thông báo kết quả cá nhân.\n• Các khoản phạt vẫn hiển thị riêng tại mục Phạt để đối chiếu.',
    'policy', 'reward', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-10 00:00:00', '2026-09-08 08:00:00', true, 2,
    'PKG-2026.09-v2', 'Phòng vận hành', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Quy định kiểm hàng cuối ca',
    'Hướng dẫn kiểm tra kiện hàng và đối chiếu cuối ca tại kho.',
    'Từ ngày 09/09/2026, nhân sự phụ trách ca cần hoàn tất kiểm hàng, đối chiếu số kiện và bàn giao chênh lệch trước khi kết ca.',
    'operations', 'warning', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-09 00:00:00', '2026-09-08 07:30:00', true, 1,
    'OPS-2026.09-01', 'Phòng vận hành', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Điều chỉnh mức phạt sai quy trình đóng gói',
    'Cập nhật mức phạt và các lỗi vi phạm liên quan.',
    'Mức phạt được điều chỉnh theo nhóm lỗi và số lần lặp lại. Nhân viên cần đọc kỹ hướng dẫn đóng gói trước khi bắt đầu ca.',
    'penalty', 'danger', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-12 00:00:00', '2026-09-08 07:00:00', false, 1,
    'PKG-PENALTY-2026.09', 'Phòng vận hành', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Cập nhật quy trình bàn giao TMĐT',
    'Điều chỉnh bước xác nhận và thời gian bàn giao đơn TMĐT.',
    'Quy trình bàn giao mới bổ sung bước xác nhận số lượng kiện và thời điểm chuyển trách nhiệm giữa ca đóng gói và ca xuất hàng.',
    'operations', 'info', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-08 00:00:00', '2026-09-07 09:00:00', false, 1,
    'TMDT-2026.09', 'Phòng vận hành', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Bảo trì hệ thống in tem vận đơn',
    'Thời gian bảo trì và ảnh hưởng đến việc in tem.',
    'Hệ thống in tem vận đơn được bảo trì từ 22:00 đến 23:00 ngày 07/09/2026. Các đơn đã tạo không bị ảnh hưởng.',
    'system', 'info', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-07 22:00:00', '2026-09-07 08:00:00', false, 1,
    'SYS-2026.09-01', 'Phòng kỹ thuật', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Lịch nghỉ lễ 02/09',
    'Thông tin lịch nghỉ và phân ca trực trong kỳ nghỉ lễ.',
    'Công ty áp dụng lịch nghỉ lễ theo thông báo của phòng nhân sự. Các ca trực đã được phân công trực tiếp cho từng nhân sự.',
    'policy', 'info', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-02 00:00:00', '2026-08-31 08:00:00', false, 1,
    'HR-2026.09-02', 'Phòng nhân sự', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
),
(
    'Chính sách thưởng chuyên cần',
    'Duy trì đúng giờ để mở huy hiệu và nhận thưởng tháng 100.000đ.',
    'Công ty áp dụng cơ chế thưởng chuyên cần theo kết quả chấm công thực tế.\n\n• Đúng giờ 3 ngày liên tiếp: mở huy hiệu Đúng giờ.\n• Hoàn tất kỳ làm việc và đạt ít nhất 24/26 ngày đúng giờ: thưởng 100.000đ vào kỳ lương tương ứng.\n• 5 phút đầu mỗi ca vẫn được tính đúng giờ; đi muộn sau grace time vẫn xử lý phạt độc lập.\n• Nghỉ phép được duyệt không làm đứt chuỗi; ngày nghỉ, ngày lễ và ngày không có lịch làm không tính vào chuỗi.',
    'policy', 'reward', 'published', '["admin","manager","staff","viewer"]',
    '2026-09-10 00:00:00', '2026-09-10 00:00:00', false, 1,
    'ATT-REWARD-2026.09', 'Phòng nhân sự', 'Thúy Lê (Admin)', CURRENT_TIMESTAMP
);
