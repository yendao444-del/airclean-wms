import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, ConfigProvider, Layout, Menu, Modal, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import viVN from 'antd/locale/vi_VN';
import {
  AppstoreOutlined, BarcodeOutlined, BellOutlined, CheckCircleFilled, CheckCircleOutlined,
  CarOutlined, ClockCircleOutlined, CloudUploadOutlined, DatabaseOutlined, DownOutlined, FileExcelOutlined,
  FileTextOutlined, HistoryOutlined, HomeOutlined, InboxOutlined, InfoCircleOutlined, MailOutlined,
  MenuFoldOutlined, ReloadOutlined, SafetyCertificateOutlined, SendOutlined, SettingOutlined,
  ShopOutlined, ShoppingCartOutlined, ToolOutlined, UploadOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import dayjs from 'dayjs';
import ghnLogo from './assets/carriers/ghn.png';
import jntLogo from './assets/carriers/jnt.png';
import spxLogo from './assets/carriers/spx.svg';
import './App.css';

type ImportedOrder = {
  orderId: string; trackingNumber: string; platform: string; carrierCode: string;
  carrierName: string; sourceFile: string;
};
type CarrierGroup = {
  carrierCode: string; carrierName: string; channel: string; recipient: string;
  referenceCode: string; shopeeCount: number; tiktokCount: number; orders: ImportedOrder[];
};
type ImportSummary = {
  sessionId: string; importedAt: string; fileCount: number; parsedCount: number;
  eligibleCount: number; existingOrderCount: number; duplicateComplaintCount: number;
  needsReviewCount: number; databaseConnected: boolean; groups: CarrierGroup[];
  excluded: Array<{ order: ImportedOrder; reason: string; reasonCode: string }>;
};
type AppStatus = { databaseConfigured: boolean; smtpConfigured: boolean; safeToSend: boolean; modeLabel: string };
type HistoryRow = { id: string; carrierName: string; referenceCode: string; status: string; orderCount: number; createdAt: string; sentAt?: string };

const isTauri = () => '__TAURI_INTERNALS__' in window;
const makeOrders = (carrierCode: string, carrierName: string, platform: string, count: number, prefix: string): ImportedOrder[] =>
  Array.from({ length: count }, (_, index) => ({
    orderId: `${platform === 'Shopee' ? 'SHP' : 'TT'}250823${String(index + 1).padStart(4, '0')}`,
    trackingNumber: `${prefix}${String(62382746805 + index)}`,
    platform, carrierCode, carrierName,
    sourceFile: platform === 'Shopee' ? 'don-shopee-23-08.xlsx' : 'orders-tiktok-23-08.csv',
  }));

const buildMock = (): ImportSummary => {
  const spx = [...makeOrders('SPX', 'SPX Express', 'Shopee', 8, 'SPXVN0'), ...makeOrders('SPX', 'SPX Express', 'TikTok Shop', 2, 'SPXVN0')];
  const jnt = [...makeOrders('JNT', 'J&T Express', 'Shopee', 5, 'JT'), ...makeOrders('JNT', 'J&T Express', 'TikTok Shop', 2, 'JT')];
  const ghn = [...makeOrders('GHN', 'GHN', 'Shopee', 5, 'GHN'), ...makeOrders('GHN', 'GHN', 'TikTok Shop', 2, 'GHN')];
  const group = (code: string, name: string, orders: ImportedOrder[], recipient: string): CarrierGroup => ({
    carrierCode: code, carrierName: name, channel: `Email ${code}`, recipient,
    referenceCode: `KN-${code}-20260823-KHO01`,
    shopeeCount: orders.filter((order) => order.platform === 'Shopee').length,
    tiktokCount: orders.filter((order) => order.platform === 'TikTok Shop').length, orders,
  });
  return {
    sessionId: 'demo-session', importedAt: '2026-08-23T18:30:00+07:00', fileCount: 3,
    parsedCount: 31, eligibleCount: 24, existingOrderCount: 3, duplicateComplaintCount: 2,
    needsReviewCount: 2, databaseConnected: true,
    groups: [group('SPX', 'SPX Express', spx, 'cskh@spx.vn'), group('JNT', 'J&T Express', jnt, 'care@jtexpress.vn'), group('GHN', 'GHN', ghn, 'cskh@ghn.vn')],
    excluded: [],
  };
};

const carrierLogos: Record<string, string> = { SPX: spxLogo, JNT: jntLogo, GHN: ghnLogo };
const CarrierMark = ({ code }: { code: string }) => carrierLogos[code]
  ? <span className="carrier-logo"><img src={carrierLogos[code]} alt={`${code} logo`} /></span>
  : <span className="carrier-logo carrier-logo--fallback" aria-label={code}><CarOutlined /></span>;
const PlatformLabel = ({ name }: { name: string }) => (
  <span className={`platform-label platform-label--${name === 'Shopee' ? 'shopee' : 'tiktok'}`}><ShopOutlined /> {name}</span>
);

function Workspace() {
  const { message } = AntApp.useApp();
  const [summary, setSummary] = useState<ImportSummary | null>(buildMock());
  const [status, setStatus] = useState<AppStatus>({ databaseConfigured: true, smtpConfigured: false, safeToSend: false, modeLabel: 'Chế độ an toàn' });
  const [selectedCarrier, setSelectedCarrier] = useState('SPX');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<AppStatus>('get_app_status').then(setStatus).catch(() => undefined);
    setSummary(null);
  }, []);

  const selected = useMemo(() => summary?.groups.find((group) => group.carrierCode === selectedCarrier) || summary?.groups[0], [selectedCarrier, summary]);

  const chooseAndImport = async (directory: boolean) => {
    setPickerOpen(false);
    if (!isTauri()) {
      setLoading(true);
      window.setTimeout(() => { setSummary(buildMock()); setSelectedCarrier('SPX'); setLoading(false); message.success('Đã đọc 3 file và đối soát 31 đơn.'); }, 700);
      return;
    }
    const selectedPaths = await open({
      directory, multiple: !directory,
      title: directory ? 'Chọn thư mục file đơn cuối ngày' : 'Chọn file đơn cuối ngày',
      filters: directory ? undefined : [{ name: 'Dữ liệu đơn hàng', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    if (!selectedPaths) return;
    const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
    setLoading(true);
    try {
      const result = await invoke<ImportSummary>('import_order_files', { paths });
      setSummary(result); setSelectedCarrier(result.groups[0]?.carrierCode || '');
      if (!result.databaseConnected) message.warning('Không kết nối được Đơn hàng. Toàn bộ đơn đã chuyển sang cần kiểm tra và khóa gửi.');
      else message.success(`Đã giữ lại ${result.eligibleCount} đơn chưa được lấy.`);
    } catch (error) { message.error(String(error)); }
    finally { setLoading(false); }
  };

  const sendSelected = async () => {
    if (!selected) return;
    if (!isTauri()) {
      setSending(true);
      window.setTimeout(() => { setSending(false); message.success(`Đã gửi ${selected.orders.length} đơn tới ${selected.carrierName}.`); }, 900);
      return;
    }
    if (!status.safeToSend) { message.error('Chưa đủ cấu hình DATABASE_URL và SMTP. Hệ thống không gửi.'); return; }
    setSending(true);
    try {
      const result = await invoke<{ message: string }>('send_complaint', { request: { group: selected, warehouse: 'Kho 01', cutoff: '18:30' } });
      message.success(result.message);
    } catch (error) { message.error(String(error)); }
    finally { setSending(false); }
  };

  const loadHistory = async () => {
    setHistoryOpen(true);
    if (!isTauri()) {
      setHistory([{ id: '1', carrierName: 'SPX Express', referenceCode: 'KN-SPX-20260822-KHO01', status: 'sent', orderCount: 12, createdAt: '2026-08-22T18:31:00+07:00', sentAt: '2026-08-22T18:31:08+07:00' }]); return;
    }
    try { setHistory(await invoke<HistoryRow[]>('get_complaint_history')); }
    catch (error) { message.error(String(error)); }
  };

  const menuItems: MenuProps['items'] = [
    { key: 'overview', icon: <HomeOutlined />, label: 'Tổng quan' },
    { key: 'sales', icon: <ShoppingCartOutlined />, label: 'Bán hàng' },
    { key: 'orders', icon: <BarcodeOutlined />, label: 'Đơn hàng' },
    { key: 'tools', icon: <ToolOutlined />, label: 'Công cụ hỗ trợ' },
    { key: 'products', icon: <AppstoreOutlined />, label: 'Sản phẩm' },
    { key: 'warehouse', icon: <InboxOutlined />, label: 'Quản lý kho' },
    { key: 'packages', icon: <DatabaseOutlined />, label: 'Quản lý kiện hàng' },
    { key: 'handover', icon: <FileTextOutlined />, label: 'Bàn giao TMĐT' },
    { type: 'divider' },
    { key: 'complaints', icon: <SafetyCertificateOutlined />, label: 'Khiếu nại DVVC' },
    { key: 'settings', icon: <SettingOutlined />, label: 'Cài đặt' },
  ];

  return (
    <Layout className="app-shell">
      <header className="app-topbar">
        <div className="brand"><span className="brand-symbol">DB</span><span>DBY Software POS</span></div>
        <div className="topbar-actions">
          <Tooltip title={status.safeToSend ? 'Kết nối đã sẵn sàng' : 'Đang khóa gửi tự động'}><span className={`connection-state ${status.safeToSend ? 'is-ready' : ''}`}><SafetyCertificateOutlined /> {status.modeLabel}</span></Tooltip>
          <BellOutlined className="top-icon" /><span className="avatar">K</span><span>Kho 01</span><DownOutlined className="tiny-icon" />
        </div>
      </header>
      <Layout>
        <aside className="sidebar"><Menu mode="inline" selectedKeys={['complaints']} items={menuItems} /><div className="sidebar-footer"><MenuFoldOutlined /> Thu gọn</div></aside>
        <main className="workspace">
          <section className="page-heading">
            <div><Typography.Title level={2}>Khiếu nại DVVC</Typography.Title><Typography.Text type="secondary">Chốt lấy hàng hôm nay&nbsp; • &nbsp;<strong>23/08/2026</strong></Typography.Text></div>
            <Space size={12}><Button icon={<HomeOutlined />}>Kho: Kho 01 <DownOutlined /></Button><Button icon={<ClockCircleOutlined />}>Chốt lấy hàng đến: 18:30 <DownOutlined /></Button><Tooltip title="Đối soát lại"><Button icon={<ReloadOutlined />} /></Tooltip></Space>
          </section>

          <Spin spinning={loading} tip="Đang đọc file và đối soát đơn...">
            <section className="import-panel">
              <div className="section-title">Import đơn chưa được lấy</div>
              <div className="import-content">
                <button className="drop-zone" type="button" onClick={() => setPickerOpen(true)}><CloudUploadOutlined /><span><strong>Chọn file hoặc thư mục</strong><small>Shopee / TikTok Shop • XLSX, XLS, CSV</small></span><em>Dùng cùng quy tắc kiểm tra với Bàn giao TMĐT</em></button>
                <div className="import-result">
                  {summary ? <><div className="file-result"><CheckCircleOutlined /><span><strong>{summary.fileCount} file&nbsp; • &nbsp;{summary.parsedCount} đơn đã đọc</strong><small>Import lúc {dayjs(summary.importedAt).format('HH:mm')}</small></span></div><div className="reconcile-stats"><div className="stat stat--primary"><strong>{summary.eligibleCount}</strong><span>đơn chưa lấy</span></div><div className="stat"><strong>{summary.existingOrderCount}</strong><span>đơn đã có trong<br />Đơn hàng</span></div><div className="stat"><strong>{summary.duplicateComplaintCount}</strong><span>đơn đã khiếu nại</span></div><div className="stat"><strong>{summary.needsReviewCount}</strong><span>đơn cần kiểm tra</span></div></div></> : <div className="empty-import"><FileExcelOutlined /><span>Chưa có dữ liệu cuối ngày</span><small>Chọn file để bắt đầu đối soát.</small></div>}
                </div>
              </div>
              <div className="independence-note"><InfoCircleOutlined /> Dữ liệu Khiếu nại DVVC được lưu riêng, không thay đổi Bàn giao TMĐT.</div>
            </section>

            <section className="batch-workspace">
              <div className="carrier-list">
                <div className="carrier-table-head"><span>Nhà vận chuyển</span><span>Đơn</span><span>Nguồn đơn</span><span>Đối soát</span><span>Trạng thái</span><span /></div>
                {summary?.groups.length ? summary.groups.map((group) => <button key={group.carrierCode} type="button" className={`carrier-row ${selected?.carrierCode === group.carrierCode ? 'is-selected' : ''}`} onClick={() => setSelectedCarrier(group.carrierCode)}><span className="carrier-name"><CarrierMark code={group.carrierCode} /><strong>{group.carrierName}</strong></span><span><strong>{group.orders.length}</strong> đơn</span><span className="source-breakdown">{group.shopeeCount > 0 && <PlatformLabel name="Shopee" />}{group.tiktokCount > 0 && <PlatformLabel name="TikTok Shop" />}</span><span>{summary ? dayjs(summary.importedAt).add(1, 'minute').format('HH:mm') : '—'}</span><span>{group.recipient ? <Tag color="success" icon={<CheckCircleOutlined />}>Sẵn sàng gửi</Tag> : <Tag color="warning">Thiếu email</Tag>}</span><span><DownOutlined className="row-arrow" /></span></button>) : <div className="empty-carriers"><InboxOutlined /><strong>Chưa có lô khiếu nại</strong><span>Import dữ liệu để hệ thống nhóm theo DVVC.</span></div>}
                <div className="carrier-list-spacer" /><div className="list-footer"><span>Tổng cộng: <strong>{summary?.groups.length || 0} DVVC</strong>&nbsp; • &nbsp;<strong>{summary?.eligibleCount || 0} đơn sẽ gửi</strong></span><Button type="text" icon={<HistoryOutlined />} onClick={loadHistory}>Lịch sử</Button></div>
              </div>

              <div className="complaint-detail">
                {selected ? <><div className="detail-header"><CarrierMark code={selected.carrierCode} /><Typography.Title level={4}>{selected.carrierName}</Typography.Title></div><dl className="detail-meta"><dt>Kênh gửi:</dt><dd><MailOutlined /> {selected.channel}</dd><dt>Người nhận:</dt><dd>{selected.recipient || `Chưa cấu hình ${selected.carrierCode}_COMPLAINT_EMAIL`}</dd><dt>Mã tham chiếu:</dt><dd>{selected.referenceCode}</dd><dt>Tiêu đề:</dt><dd>Khiếu nại đơn hàng chưa được lấy tại Kho 01 – 23/08/2026</dd></dl><div className="tracking-section"><div className="tracking-title">Danh sách vận đơn ({selected.orders.length}) <Button type="link" size="small" onClick={() => setPreviewOpen(true)}>Xem nội dung</Button></div><div className="tracking-list">{selected.orders.map((order, index) => <div className="tracking-row" key={`${order.platform}-${order.orderId}`}><span>{index + 1}.</span><strong>{order.trackingNumber}</strong><small>{order.platform}</small></div>)}</div></div><div className="assurance"><strong>Kiểm tra & bảo đảm</strong><span><CheckCircleFilled /> Không có đơn đã lấy</span><span><CheckCircleFilled /> Không trùng mã đơn hoặc mã vận đơn</span><span><CheckCircleFilled /> Sẽ đối soát lại ngay trước khi gửi</span></div>{(!status.safeToSend || !selected.recipient) && isTauri() && <div className="safe-mode-note"><SafetyCertificateOutlined /><span><strong>Đang khóa gửi tự động</strong><small>{!selected.recipient ? `Cần cấu hình email đã xác minh cho ${selected.carrierCode}.` : 'Cần DATABASE_URL và cấu hình SMTP hợp lệ.'}</small></span></div>}<div className="platform-note"><InfoCircleOutlined /> Đơn nguồn Shopee/TikTok có thể được DVVC yêu cầu chuyển tiếp qua Seller Center.</div><div className="detail-actions"><Button type="link" onClick={() => setPreviewOpen(true)}>Sửa nội dung</Button><Button type="primary" icon={<SendOutlined />} loading={sending} onClick={sendSelected} disabled={isTauri() && (!status.safeToSend || !selected.recipient)}>{selected.recipient ? `Gửi khiếu nại ${selected.carrierCode} • ${selected.orders.length} đơn` : `Thiếu email ${selected.carrierCode}`}</Button></div></> : <div className="empty-detail"><MailOutlined /><strong>Chưa có DVVC được chọn</strong><span>Import file cuối ngày để tạo nội dung khiếu nại.</span></div>}
              </div>
            </section>
          </Spin>
        </main>
      </Layout>

      <Modal title="Chọn nguồn import" open={pickerOpen} onCancel={() => setPickerOpen(false)} footer={null} width={520} centered><div className="picker-options"><button type="button" onClick={() => chooseAndImport(false)}><FileExcelOutlined /><span><strong>Chọn một hoặc nhiều file</strong><small>XLSX, XLS hoặc CSV từ Shopee/TikTok Shop</small></span></button><button type="button" onClick={() => chooseAndImport(true)}><UploadOutlined /><span><strong>Chọn cả thư mục</strong><small>Đọc toàn bộ file đơn hàng hợp lệ trong thư mục</small></span></button></div></Modal>
      <Modal title={`Nội dung khiếu nại • ${selected?.carrierName || ''}`} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => setPreviewOpen(false)}>Xác nhận nội dung</Button>} width={720}><div className="mail-preview"><div><span>Đến</span><strong>{selected?.recipient}</strong></div><div><span>Tiêu đề</span><strong>[{selected?.referenceCode}] Yêu cầu hỗ trợ các đơn chưa được lấy</strong></div><p>Kính gửi {selected?.carrierName},</p><p>Kho 01 đã chuẩn bị bàn giao các đơn dưới đây trong ngày 23/08/2026. Đến 18:30, các đơn vẫn chưa được cập nhật trạng thái lấy hàng. Vui lòng kiểm tra và hỗ trợ điều phối lấy hàng.</p><pre>{selected?.orders.map((order) => `${order.trackingNumber} — ${order.platform}`).join('\n')}</pre></div></Modal>
      <Modal title="Lịch sử khiếu nại" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={null} width={760}><div className="history-list">{history.length ? history.map((row) => <div key={row.id}><span className="history-icon"><CheckCircleOutlined /></span><span><strong>{row.carrierName} • {row.orderCount} đơn</strong><small>{row.referenceCode} • {dayjs(row.createdAt).format('DD/MM/YYYY HH:mm')}</small></span><Tag color={row.status === 'sent' ? 'success' : 'warning'}>{row.status}</Tag></div>) : <div className="history-empty">Chưa có khiếu nại nào được gửi.</div>}</div></Modal>
    </Layout>
  );
}

function App() {
  return <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#08ad60', borderRadius: 8, colorText: '#172033', fontFamily: 'Inter, "Segoe UI", Arial, sans-serif' } }}><AntApp><Workspace /></AntApp></ConfigProvider>;
}
export default App;
