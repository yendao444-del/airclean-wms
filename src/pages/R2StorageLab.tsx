import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Divider, Empty, Input, List, Modal, Row, Space, Spin, Statistic, Tag, Typography, Upload, message } from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, EyeOutlined, ApiOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import PdfCanvasPreview from '../components/PdfCanvasPreview';
import './R2StorageLab.css';

const { Title, Text, Paragraph } = Typography;
type LabObject = { key: string; size: number; uploaded?: string };
type Result = { ok: boolean; error?: string; key?: string; size?: number; objects?: LabObject[]; timestamp?: string };
type TestResult = { name: string; status: 'running' | 'pass' | 'fail'; detail?: string };
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const MAX_IMAGE_BYTES = 1024 * 1024;
const TARGET_IMAGE_BYTES = 950 * 1024;
const DATA_SAFETY_MODE = true;
const DATA_SAFETY_MESSAGE = 'Thao tác xóa đang tạm khóa để bảo vệ dữ liệu. Không có file nào bị thay đổi.';

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không thể tạo ảnh nén.')), 'image/webp', quality);
});

async function compressImage(file: File) {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Không đọc được định dạng ảnh này để nén. Hãy dùng JPG, PNG hoặc WebP.');
  }

  try {
    const longestSide = Math.max(bitmap.width, bitmap.height);
    let scale = Math.min(1, 2560 / longestSide);
    let quality = 0.88;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('Không thể khởi tạo bộ nén ảnh.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const compressed = await canvasToBlob(canvas, quality);
      canvas.width = 1;
      canvas.height = 1;
      if (compressed.size <= TARGET_IMAGE_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
        return new File([compressed], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() });
      }

      if (quality > 0.52) quality -= 0.1;
      else {
        scale *= 0.78;
        quality = 0.78;
      }
    }
    throw new Error('Không thể nén ảnh xuống dưới 1 MB.');
  } finally {
    bitmap.close();
  }
}

export default function R2StorageLab() {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem('r2-test-endpoint') || '');
  const [testKey, setTestKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [statusText, setStatusText] = useState('Chưa kiểm tra kết nối');
  const [objects, setObjects] = useState<LabObject[]>([]);
  const [lastUpload, setLastUpload] = useState<LabObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{ url: string; file: Blob; name: string; type: string } | null>(null);
  const [deletingKeys, setDeletingKeys] = useState<Record<string, boolean>>({});
  const deletingKeysRef = useRef<Set<string>>(new Set());
  const baseUrl = useMemo(() => endpoint.trim().replace(/\/+$/, ''), [endpoint]);
  const headers = useMemo(() => ({ 'x-r2-test-key': testKey }), [testKey]);

  const testUpdateInterface = () => {
    window.dispatchEvent(new CustomEvent('dby:update-ui-test', {
      detail: {
        status: 'installing',
        percent: 84,
        currentVersion: '1.0.397',
        latestVersion: '1.0.398',
      },
    }));
  };

  useEffect(() => {
    const loadBootstrap = async () => {
      try {
        const result = await (window as any).electronAPI?.r2Test?.getBootstrap?.();
        if (!result?.success || !result.data) return;
        setEndpoint(result.data.endpoint);
        setTestKey(result.data.testKey);
        localStorage.setItem('r2-test-endpoint', result.data.endpoint);
      } catch { }
    };
    void loadBootstrap();
  }, []);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview?.url]);

  const call = async (path: string, init: RequestInit = {}) => {
    if (!baseUrl) throw new Error('Chưa nhập URL Worker staging.');
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const error = contentType.includes('json') ? await response.json() as Result : { error: await response.text() };
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return { response, data: contentType.includes('json') ? await response.json() as Result : null };
  };

  const checkConnection = async () => {
    setStatus('loading');
    try {
      const { data } = await call('/health', { headers: {} });
      setStatus('ok');
      setStatusText(`Worker hoạt động lúc ${new Date(data?.timestamp || Date.now()).toLocaleTimeString('vi-VN')}`);
    } catch (error: any) { setStatus('error'); setStatusText(error.message || 'Không kết nối được Worker'); }
  };
  const loadObjects = async () => { try { const { data } = await call('/objects'); setObjects(data?.objects || []); } catch (error: any) { message.error(error.message); } };

  useEffect(() => {
    if (!baseUrl || !testKey) return;
    void checkConnection();
    void loadObjects();
  }, [baseUrl, testKey]);

  const uploadFile = async (file: File) => {
    setBusy(true);
    try {
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name);
      const uploadFile = isImage ? await compressImage(file) : file;
      if (uploadFile.size > 15 * 1024 * 1024) throw new Error('File test tối đa 15 MB.');
      if (isImage && uploadFile.size >= MAX_IMAGE_BYTES) throw new Error('Ảnh sau nén vẫn vượt quá 1 MB.');

      const key = `test/${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { data } = await call(`/objects/${encodeURIComponent(key)}`, { method: 'POST', body: uploadFile, headers: { 'content-type': uploadFile.type || 'application/octet-stream' } });
      setLastUpload({ key, size: data?.size || uploadFile.size, uploaded: new Date().toISOString() });
      await loadObjects();
      message.success(isImage ? `Đã nén ${formatBytes(file.size)} → ${formatBytes(uploadFile.size)} và upload.` : 'Upload R2 staging thành công.');
    } catch (error: any) { message.error(error.message); } finally { setBusy(false); }
    return false;
  };
  const viewObject = async (item: LabObject) => {
    setPreviewLoading(true);
    try {
      const { response } = await call(`/objects/${encodeURIComponent(item.key)}`);
      const blob = await response.blob();
      setPreview({ url: URL.createObjectURL(blob), file: blob, name: item.key.split('/').pop() || item.key, type: blob.type || 'application/octet-stream' });
    } catch (error: any) { message.error(error.message); }
    finally { setPreviewLoading(false); }
  };
  const deleteObject = (item: LabObject) => {
    if (DATA_SAFETY_MODE) {
      message.warning(DATA_SAFETY_MESSAGE);
      return;
    }
    if (deletingKeysRef.current.has(item.key)) return;
    deletingKeysRef.current.add(item.key);
    setDeletingKeys(current => ({ ...current, [item.key]: true }));

    const clearDeleting = () => {
      deletingKeysRef.current.delete(item.key);
      setDeletingKeys(current => {
        const next = { ...current };
        delete next[item.key];
        return next;
      });
    };

    Modal.confirm({
      title: 'Xóa file test?',
      content: <Text>File <Text code>{item.key}</Text> sẽ bị xóa khỏi R2 staging.</Text>,
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onCancel: clearDeleting,
      onOk: async () => {
        try {
          await call(`/objects/${encodeURIComponent(item.key)}`, { method: 'DELETE' });
          setObjects(current => current.filter(object => object.key !== item.key));
          setLastUpload(current => current?.key === item.key ? null : current);
          message.success('Đã xóa file test.');
        } catch (error: any) {
          message.error(error.message);
          throw error;
        } finally {
          clearDeleting();
        }
      },
    });
  };
  const runAutomatedTests = async () => {
    if (DATA_SAFETY_MODE) {
      message.warning('Bộ kiểm tra tự động có bước xóa file nên đang tạm khóa trong chế độ bảo vệ dữ liệu.');
      return;
    }
    const names = ['Worker health', 'Từ chối key sai', 'Upload + download đối chiếu', 'Dọn file test'];
    setTestResults(names.map(name => ({ name, status: 'running' })));
    const update = (index: number, result: Partial<TestResult>) => setTestResults(current => current.map((item, i) => i === index ? { ...item, ...result } : item));
    let key = '';
    try {
      await call('/health', { headers: {} }); update(0, { status: 'pass', detail: 'HTTP 200' });
    } catch (error: any) { update(0, { status: 'fail', detail: error.message }); setTestResults(current => current.slice(0, 1).map(item => item)); return; }
    try {
      const response = await fetch(`${baseUrl}/objects`, { headers: { 'x-r2-test-key': `${testKey}-invalid` } });
      if (response.status !== 401) throw new Error(`HTTP ${response.status}`);
      update(1, { status: 'pass', detail: 'HTTP 401 đúng như kỳ vọng' });
    } catch (error: any) { update(1, { status: 'fail', detail: error.message }); }
    try {
      key = `test/automated-${Date.now()}.txt`;
      const expected = `DBY POS R2 test ${Date.now()}`;
      await call(`/objects/${encodeURIComponent(key)}`, { method: 'POST', body: expected, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      const downloaded = await (await call(`/objects/${encodeURIComponent(key)}`)).response.text();
      if (downloaded !== expected) throw new Error('Nội dung tải xuống không khớp');
      update(2, { status: 'pass', detail: 'Nội dung upload/download khớp' });
    } catch (error: any) { update(2, { status: 'fail', detail: error.message }); }
    try {
      if (key) await call(`/objects/${encodeURIComponent(key)}`, { method: 'DELETE' });
      update(3, { status: 'pass', detail: 'Đã xóa object tự động' });
      await loadObjects();
    } catch (error: any) { update(3, { status: 'fail', detail: error.message }); }
  };

  return <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
    <Space align="center"><ApiOutlined style={{ fontSize: 28, color: '#1677ff' }} /><Title level={2} style={{ margin: 0 }}>R2 Storage Test Lab</Title><Tag color="gold">STAGING ONLY</Tag></Space>
    <Paragraph type="secondary">Khu vực thử nghiệm riêng cho Admin. File ở đây không liên quan đến Google Drive, phiếu bán hàng hay dữ liệu production.</Paragraph>
    <Card className="r2-update-ui-test" style={{ marginBottom: 16 }}>
      <div className="r2-update-ui-test__content">
        <div className="r2-update-ui-test__icon"><RocketOutlined /></div>
        <div className="r2-update-ui-test__copy">
          <Title level={4}>Kiểm thử giao diện cập nhật</Title>
          <Paragraph>Chạy mô phỏng mẫu 3 để kiểm tra bố cục toàn màn hình. Chế độ này <Text strong>không tải, không cài đặt</Text> và không thay đổi phiên bản ứng dụng.</Paragraph>
        </div>
        <Button type="primary" size="large" icon={<RocketOutlined />} onClick={testUpdateInterface}>Test giao diện cập nhật</Button>
      </div>
    </Card>
    <Card title="1. Kết nối Worker staging" style={{ marginBottom: 16 }}>
      <Row gutter={[16, 16]}><Col xs={24} md={14}><Input value={endpoint} onChange={e => { setEndpoint(e.target.value); localStorage.setItem('r2-test-endpoint', e.target.value); }} placeholder="https://dby-pos-r2-test.<subdomain>.workers.dev" addonBefore="Worker URL" /></Col><Col xs={24} md={6}><Input.Password value={testKey} onChange={e => setTestKey(e.target.value)} placeholder="R2_TEST_KEY" addonBefore="Key" /></Col><Col xs={24} md={4}><Button type="primary" icon={<ApiOutlined />} block loading={status === 'loading'} onClick={checkConnection}>Kiểm tra</Button></Col></Row>
      <div style={{ marginTop: 16 }}><Badge status={status === 'ok' ? 'success' : status === 'error' ? 'error' : status === 'loading' ? 'processing' : 'default'} text={statusText} /></div>
    </Card>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}><Card title="2. Upload file thử nghiệm"><Upload.Dragger beforeUpload={uploadFile} showUploadList={false} disabled={busy || !baseUrl || !testKey}><p className="ant-upload-drag-icon"><CloudUploadOutlined /></p><p>Chọn hoặc kéo ảnh/PDF vào đây</p><p className="ant-upload-hint">Ảnh tự nén dưới 1 MB trước upload · file khác tối đa 15 MB</p></Upload.Dragger>{lastUpload && <Alert type="success" showIcon icon={<CheckCircleOutlined />} style={{ marginTop: 16 }} message="Upload thành công" description={<Text code>{lastUpload.key}</Text>} />}</Card></Col>
      <Col xs={24} lg={16}><Card title="3. Kiểm tra file trong bucket" extra={<Space><Button icon={<ReloadOutlined />} onClick={loadObjects} disabled={!baseUrl || !testKey}>Làm mới</Button><Button type="primary" onClick={runAutomatedTests} disabled={DATA_SAFETY_MODE || !baseUrl || !testKey} loading={testResults.some(item => item.status === 'running')}>Chạy toàn bộ kiểm tra</Button></Space>}><Row gutter={16} style={{ marginBottom: 16 }}><Col span={8}><Statistic title="File test" value={objects.length} prefix={<CloudUploadOutlined />} /></Col><Col span={8}><Statistic title="Dung lượng" value={formatBytes(objects.reduce((sum, item) => sum + (item.size || 0), 0))} /></Col><Col span={8}><Statistic title="Thao tác" value={DATA_SAFETY_MODE ? 'Upload · Xem' : 'Upload · Xem · Xóa'} /></Col></Row>{DATA_SAFETY_MODE && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="Chế độ bảo vệ dữ liệu đang bật" description="Xóa file và bộ kiểm tra có bước dọn file đang tạm khóa." />}{testResults.length > 0 && <List size="small" header="Kết quả kiểm tra tự động" dataSource={testResults} renderItem={item => <List.Item><Badge status={item.status === 'pass' ? 'success' : item.status === 'fail' ? 'error' : 'processing'} text={<Text strong={item.status === 'pass'}>{item.name}</Text>} /><Text type="secondary">{item.detail || 'Đang chạy...'}</Text></List.Item>} />}<Divider style={{ margin: '12px 0' }} />{objects.length ? <List size="small" dataSource={objects} renderItem={item => <List.Item actions={[<Button key="view" type="link" icon={<EyeOutlined />} onClick={() => viewObject(item)}>Xem</Button>, <Button key="delete" danger type="link" icon={<DeleteOutlined />} loading={Boolean(deletingKeys[item.key])} disabled={DATA_SAFETY_MODE || Boolean(deletingKeys[item.key])} onClick={() => deleteObject(item)}>Xóa</Button>]}><List.Item.Meta title={item.key} description={`${formatBytes(item.size)} · ${item.uploaded ? new Date(item.uploaded).toLocaleString('vi-VN') : 'R2'}`} /></List.Item>} /> : <Empty description="Chưa có file test" />}</Card></Col>
    </Row>
    <Alert style={{ marginTop: 16 }} type="info" showIcon message="Tiêu chí chốt giai đoạn 1" description="Health xanh, upload ảnh/PDF, mở lại file sau khi restart app, xóa file, file quá 15 MB bị chặn và không có thao tác nào ghi vào dữ liệu nghiệp vụ. Sau khi đạt các tiêu chí này mới bật chạy song song." />
    <Modal rootClassName="r2-preview-modal" open={Boolean(preview)} title={preview?.name || 'Xem file R2'} onCancel={() => setPreview(null)} footer={null} width="min(1000px, 94vw)" style={{ top: 24 }} styles={{ body: { overflow: 'hidden', padding: 12 } }} destroyOnHidden>
      {preview?.type === 'application/pdf' ? <PdfCanvasPreview file={preview.file} /> : preview?.type.startsWith('image/') ? <div style={{ width: '100%', height: 'calc(100vh - 170px)', minHeight: 280, display: 'grid', placeItems: 'center', overflow: 'hidden', background: '#f5f5f5', borderRadius: 8 }}><img src={preview.url} alt={preview.name} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} /></div> : preview ? <Alert type="info" showIcon message="Định dạng này không hỗ trợ xem trực tiếp" description={<a href={preview.url} download={preview.name}>Tải file xuống để kiểm tra</a>} /> : null}
    </Modal>
    <Modal open={previewLoading} footer={null} closable={false} centered width={220}><div style={{ display: 'grid', placeItems: 'center', gap: 12, padding: 12 }}><Spin /><Text>Đang tải file...</Text></div></Modal>
  </div>;
}
