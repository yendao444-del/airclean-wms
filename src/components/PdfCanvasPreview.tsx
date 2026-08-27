import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import { LeftOutlined, MinusOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const { Text } = Typography;

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<any>;
};

type Destroyable = {
  destroy?: () => void | Promise<void>;
};

export default function PdfCanvasPreview({ file }: { file: Blob }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const renderTaskRef = useRef<{ cancel?: () => void; promise: Promise<void> } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: (Destroyable & { promise: Promise<PdfDocument> }) | null = null;

    const loadPdf = async () => {
      try {
        setError('');
        setLoading(true);
        setPageNumber(1);
        setZoom(1);
        const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const data = new Uint8Array(await file.arrayBuffer());
        loadingTask = pdfjs.getDocument({ data });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    void loadPdf();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      renderTaskRef.current = null;
      pdfRef.current = null;
      if (typeof loadingTask?.destroy === 'function') {
        try {
          void Promise.resolve(loadingTask.destroy()).catch(() => undefined);
        } catch {
          // Closing the preview must never crash the application.
        }
      }
    };
  }, [file]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !viewportSize.width || !viewportSize.height) return;
    let cancelled = false;

    const renderPage = async () => {
      try {
        setLoading(true);
        renderTaskRef.current?.cancel?.();
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(120, viewportSize.width - 28);
        const availableHeight = Math.max(120, viewportSize.height - 28);
        const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({ scale: fitScale * zoom * pixelRatio });

        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        canvas.style.width = `${Math.ceil(renderViewport.width / pixelRatio)}px`;
        canvas.style.height = `${Math.ceil(renderViewport.height / pixelRatio)}px`;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Không thể khởi tạo vùng hiển thị PDF.');

        const task = page.render({ canvas, canvasContext: context, viewport: renderViewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) setLoading(false);
        page.cleanup();
      } catch (reason: any) {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
    };
  }, [pageNumber, pageCount, viewportSize, zoom]);

  if (error) return <Alert type="error" showIcon message="Không hiển thị được PDF" description={error} />;

  return <div style={{ height: 'calc(100vh - 145px)', minHeight: 320, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <Space size={6}>
        <Button size="small" icon={<LeftOutlined />} disabled={pageNumber <= 1 || loading} onClick={() => setPageNumber(current => current - 1)}>Trang trước</Button>
        <Text style={{ minWidth: 74, textAlign: 'center' }}>{pageCount ? `${pageNumber} / ${pageCount}` : 'Đang tải'}</Text>
        <Button size="small" icon={<RightOutlined />} disabled={!pageCount || pageNumber >= pageCount || loading} onClick={() => setPageNumber(current => current + 1)}>Trang sau</Button>
      </Space>
      <Space size={6}>
        <Button size="small" icon={<MinusOutlined />} disabled={zoom <= 0.5 || loading} onClick={() => setZoom(current => Math.max(0.5, current - 0.25))} />
        <Button size="small" onClick={() => setZoom(1)} disabled={loading}>Vừa khung · {Math.round(zoom * 100)}%</Button>
        <Button size="small" icon={<PlusOutlined />} disabled={zoom >= 3 || loading} onClick={() => setZoom(current => Math.min(3, current + 0.25))} />
      </Space>
    </div>
    <div
      ref={viewportRef}
      title="Lăn chuột để phóng to hoặc thu nhỏ"
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (loading || event.deltaY === 0) return;
        const direction = event.deltaY < 0 ? 1 : -1;
        setZoom(current => Math.min(3, Math.max(0.5, Number((current + direction * 0.1).toFixed(2)))));
      }}
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden', padding: 14, background: '#e9edf2', borderRadius: 8 }}
    >
      {loading && <div style={{ position: 'absolute', zIndex: 2, display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(255,255,255,.92)', borderRadius: 8, boxShadow: '0 4px 16px rgba(15,23,42,.1)' }}><Spin size="small" /><Text>Đang dựng trang PDF</Text></div>}
      <canvas ref={canvasRef} aria-label={`Trang ${pageNumber}`} style={{ display: pageCount ? 'block' : 'none', maxWidth: zoom <= 1 ? '100%' : 'none', maxHeight: zoom <= 1 ? '100%' : 'none', background: '#fff', boxShadow: '0 8px 30px rgba(15,23,42,.16)', borderRadius: 4 }} />
    </div>
  </div>;
}
