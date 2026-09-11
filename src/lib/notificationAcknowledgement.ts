import type { Announcement } from '../types/electron';

// `requireAcknowledgement` is the policy-level rule. Admins receive the same
// announcement for oversight but are explicitly marked as non-recipients.
export const requiresNotificationAcknowledgement = (announcement: Announcement) => (
    announcement.requireAcknowledgement
    && announcement.recipient?.acknowledgementRequired !== false
);
