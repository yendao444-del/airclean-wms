import { useState } from 'react';
import { Image, Spin } from 'antd';
import { EyeOutlined, PictureOutlined } from '@ant-design/icons';

export interface EvidenceGalleryEntry {
    key: string;
    name?: string;
    url?: string;
    error?: string;
}

export default function DailyTaskEvidenceGallery({ entries }: { entries: EvidenceGalleryEntry[] }) {
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const loaded = entries.filter(entry => Boolean(entry.url));
    const current = Math.max(0, loaded.findIndex(entry => entry.key === activeKey));
    const pending = entries.filter(entry => !entry.url && !entry.error).length;

    if (!entries.length) return null;

    return (
        <div className="daily-evidence-gallery">
            <div className="daily-evidence-gallery__hint" role="status">
                {pending > 0
                    ? `Đang tải ảnh… ${loaded.length}/${entries.length}. Có thể xem ngay ảnh đã tải.`
                    : 'Bấm vào ảnh để phóng to, thu nhỏ hoặc chuyển sang ảnh tiếp theo.'}
            </div>
            <div className="daily-evidence-gallery__grid">
                {entries.map((entry, index) => (
                    <div className="daily-evidence-gallery__card" key={entry.key}>
                        <button
                            type="button"
                            className="daily-evidence-gallery__thumbnail"
                            disabled={!entry.url}
                            aria-label={`Phóng to ảnh bằng chứng ${index + 1}${entry.name ? `: ${entry.name}` : ''}`}
                            onClick={() => setActiveKey(entry.key)}
                        >
                            {entry.url ? (
                                <>
                                    <Image
                                        src={entry.url}
                                        alt={`Bằng chứng ${index + 1}`}
                                        width="100%"
                                        height="100%"
                                        preview={false}
                                        decoding="async"
                                        placeholder={<div className="daily-evidence-gallery__placeholder"><Spin size="small" /></div>}
                                        styles={{ image: { width: '100%', height: '100%', objectFit: 'contain' } }}
                                    />
                                    <span className="daily-evidence-gallery__zoom"><EyeOutlined /> Phóng to</span>
                                </>
                            ) : (
                                <span className="daily-evidence-gallery__placeholder">
                                    {entry.error ? <PictureOutlined /> : <Spin size="small" />}
                                    <span>{entry.error ? 'Không tải được ảnh' : 'Đang tải ảnh…'}</span>
                                </span>
                            )}
                        </button>
                        <div className="daily-evidence-gallery__caption" title={entry.name}>Ảnh {index + 1}{entry.name ? ` · ${entry.name}` : ''}</div>
                    </div>
                ))}
            </div>
            {loaded.length > 0 && (
                <Image.PreviewGroup
                    items={loaded.map(entry => ({ src: entry.url!, alt: entry.name || 'Ảnh bằng chứng' }))}
                    preview={{
                        open: activeKey !== null,
                        current,
                        zIndex: 2000,
                        onOpenChange: open => { if (!open) setActiveKey(null); },
                        onChange: index => setActiveKey(loaded[index]?.key || null),
                    }}
                />
            )}
        </div>
    );
}
