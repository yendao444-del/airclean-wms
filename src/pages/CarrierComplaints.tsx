import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Button, Card, Col, Descriptions, Drawer, Empty, Form, Input, List,
    Modal, Row, Space, Statistic, Table, Tag, Typography, Upload, message,
} from 'antd';
import type { UploadProps } from 'antd';
import {
    CheckCircleOutlined, CloudUploadOutlined, HistoryOutlined, MailOutlined,
    SafetyCertificateOutlined, SendOutlined, SettingOutlined, ShopOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import './CarrierComplaints.css';

type ComplaintOrder = {
    orderId: string;
    trackingNumber: string;
    platform: 'Shopee' | 'TikTok';
    carrierCode: string;
    carrierName: string;
    sourceFile: string;
};

type ExcludedOrder = {
    order: ComplaintOrder;
    reasonCode: 'ALREADY_PICKED' | 'DUPLICATE_COMPLAINT' | 'NEEDS_REVIEW';
    reason: string;
};

type ComplaintConfig = { recipients: Record<string, string> };
type ComplaintBatch = {
    id: string;
    carrierCode: string;
    recipient: string;
    status: string;
    orders: ComplaintOrder[];
    createdAt: string;
    sentAt?: string;
    error?: string;
};

const CARRIER_NAMES: Record<string, string> = {
    SPX: 'SPX Express', JNT: 'J&T Express', GHN: 'Giao Hàng Nhanh',
    GHTK: 'Giao Hàng Tiết Kiệm', VTP: 'Viettel Post', VNPOST: 'VNPost',
    BEST: 'BEST Express', NINJA: 'Ninja Van',
};
const CONFIG_CODES = Object.keys(CARRIER_NAMES);

const normalizeHeader = (value: unknown) => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function rowValue(row: Record<string, unknown>, candidates: string[]) {
    const wanted = new Set(candidates.map(normalizeHeader));
    const key = Object.keys(row).find(item => wanted.has(normalizeHeader(item)));
    return key ? row[key] : undefined;
}

function identifyCarrier(raw: unknown) {
    const value = normalizeHeader(raw).replace(/[^a-z0-9&]+/g, ' ');
    let code = 'UNKNOWN';
    if (/\bspx\b|shopee express/.test(value)) code = 'SPX';
    else if (/j\s*&?\s*t|\bjnt\b/.test(value)) code = 'JNT';
    else if (/\bghn\b|giao hang nhanh/.test(value)) code = 'GHN';
    else if (/\bghtk\b|giao hang tiet kiem/.test(value)) code = 'GHTK';
    else if (/viettel post|\bvtp\b/.test(value)) code = 'VTP';
    else if (/vnpost|vietnam post|buu dien viet nam/.test(value)) code = 'VNPOST';
    else if (/best express|\bbest\b/.test(value)) code = 'BEST';
    else if (/ninja\s*van|\bninjavan\b/.test(value)) code = 'NINJA';
    return { code, name: CARRIER_NAMES[code] || String(raw || 'Chưa nhận diện').trim() };
}

function parseWorkbook(workbook: XLSX.WorkBook, sourceFile: string): ComplaintOrder[] {
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    const first = rows[0] || {};
    const isTikTok = Object.keys(first).some(key => ['order id', 'cancelled time'].includes(normalizeHeader(key)));
    const isShopee = rowValue(first, ['Mã đơn hàng']) !== undefined
        || rowValue(first, ['Đơn Vị Vận Chuyển', 'Đơn vị vận chuyển']) !== undefined;
    if (!isTikTok && !isShopee) return [];

    const orders = new Map<string, ComplaintOrder>();
    const trackingSeen = new Set<string>();
    for (const row of rows) {
        const orderId = String(isTikTok
            ? rowValue(row, ['Order ID'])
            : rowValue(row, ['Mã đơn hàng']) || '').trim();
        const trackingNumber = String(isTikTok
            ? rowValue(row, ['Tracking ID', 'Tracking Number'])
            : rowValue(row, ['Mã vận đơn', 'Mã vận chuyển', 'Số vận đơn']) || '').trim();
        const carrierRaw = isTikTok
            ? rowValue(row, ['Shipping Provider Name'])
            : rowValue(row, ['Đơn Vị Vận Chuyển', 'Đơn vị vận chuyển']);
        if (!orderId || !trackingNumber || orderId.includes('Platform unique') || trackingNumber.includes("order's tracking")) continue;
        const platform = isTikTok ? 'TikTok' : 'Shopee';
        const key = `${platform}:${orderId}`.toLowerCase();
        const trackingKey = trackingNumber.toLowerCase();
        if (orders.has(key) || trackingSeen.has(trackingKey)) continue;
        const carrier = identifyCarrier(carrierRaw);
        orders.set(key, {
            orderId, trackingNumber, platform,
            carrierCode: carrier.code, carrierName: carrier.name, sourceFile,
        });
        trackingSeen.add(trackingKey);
    }
    return [...orders.values()];
}

function uniqueOrders(orders: ComplaintOrder[]) {
    const byOrder = new Map<string, ComplaintOrder>();
    const tracking = new Set<string>();
    for (const order of orders) {
        const key = `${order.platform}:${order.orderId}`.toLowerCase();
        const trackingKey = order.trackingNumber.toLowerCase();
        if (byOrder.has(key) || tracking.has(trackingKey)) continue;
        byOrder.set(key, order);
        tracking.add(trackingKey);
    }
    return [...byOrder.values()];
}

export default function CarrierComplaintsPage() {
    const [rawOrders, setRawOrders] = useState<ComplaintOrder[]>([]);
    const [eligible, setEligible] = useState<ComplaintOrder[]>([]);
    const [excluded, setExcluded] = useState<ExcludedOrder[]>([]);
    const [fileCount, setFileCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState('');
    const [selectedCode, setSelectedCode] = useState('');
    const [config, setConfig] = useState<ComplaintConfig>({ recipients: {} });
    const [configOpen, setConfigOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [history, setHistory] = useState<ComplaintBatch[]>([]);
    const [form] = Form.useForm();

    useEffect(() => {
        window.electronAPI.carrierComplaints.getConfig().then(result => {
            if (result.success && result.data) setConfig(result.data);
        });
    }, []);

    const groups = useMemo(() => {
        const map = new Map<string, ComplaintOrder[]>();
        eligible.forEach(order => {
            if (!map.has(order.carrierCode)) map.set(order.carrierCode, []);
            map.get(order.carrierCode)!.push(order);
        });
        return [...map.entries()].map(([code, orders]) => ({
            code, name: CARRIER_NAMES[code] || orders[0]?.carrierName || code, orders,
            shopee: orders.filter(order => order.platform === 'Shopee').length,
            tiktok: orders.filter(order => order.platform === 'TikTok').length,
            recipient: config.recipients?.[code] || '',
        }));
    }, [eligible, config]);

    const selected = groups.find(group => group.code === selectedCode) || groups[0];
    const pickedCount = excluded.filter(item => item.reasonCode === 'ALREADY_PICKED').length;
    const duplicateCount = excluded.filter(item => item.reasonCode === 'DUPLICATE_COMPLAINT').length;
    const reviewCount = excluded.filter(item => item.reasonCode === 'NEEDS_REVIEW').length;

    const reconcile = async (orders: ComplaintOrder[], files: number) => {
        const normalized = uniqueOrders(orders);
        if (!normalized.length) throw new Error('Không tìm thấy đơn Shopee/TikTok có mã đơn và mã vận đơn hợp lệ');
        const result = await window.electronAPI.carrierComplaints.reconcile({ orders: normalized });
        if (!result.success) throw new Error(result.error || 'Không thể đối soát đơn hàng');
        setRawOrders(normalized);
        setEligible(result.data.eligible || []);
        setExcluded(result.data.excluded || []);
        setConfig(result.data.config || { recipients: {} });
        setFileCount(files);
        const firstCode = result.data.eligible?.[0]?.carrierCode || '';
        setSelectedCode(firstCode);
        message.success(`Đã đọc ${normalized.length} đơn, giữ lại ${result.data.eligible?.length || 0} đơn chưa lấy`);
    };

    const readFiles = async (files: File[]) => {
        setLoading(true);
        try {
            const parsed: ComplaintOrder[] = [];
            for (const file of files) {
                const buffer = await file.arrayBuffer();
                parsed.push(...parseWorkbook(XLSX.read(buffer, { type: 'array' }), file.name));
            }
            await reconcile(parsed, files.length);
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể đọc file');
        } finally { setLoading(false); }
    };

    const uploadProps: UploadProps = {
        multiple: true, accept: '.xlsx,.xls,.csv', showUploadList: false,
        beforeUpload: (_file, list) => {
            if (_file.uid === list[0]?.uid) void readFiles(list as unknown as File[]);
            return false;
        },
    };

    const importFolder = async () => {
        setLoading(true);
        try {
            const folder = await window.electronAPI.ecommerceExports.selectFolder();
            if (!folder.success || !folder.data) {
                if (folder.error && !folder.error.toLowerCase().includes('chon')) message.error(folder.error);
                return;
            }
            const loaded = await window.electronAPI.ecommerceExports.loadExcelFiles(folder.data);
            if (!loaded.success) throw new Error(loaded.error || 'Không đọc được thư mục');
            const parsed: ComplaintOrder[] = [];
            for (const file of loaded.data || []) {
                const bytes = Uint8Array.from(atob(file.data), char => char.charCodeAt(0));
                parsed.push(...parseWorkbook(XLSX.read(bytes, { type: 'array' }), file.name));
            }
            await reconcile(parsed, loaded.data?.length || 0);
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể đọc thư mục');
        } finally { setLoading(false); }
    };

    const openConfig = () => {
        form.setFieldsValue(config.recipients || {});
        setConfigOpen(true);
    };

    const saveConfig = async () => {
        const recipients = await form.validateFields();
        const result = await window.electronAPI.carrierComplaints.saveConfig({ recipients });
        if (!result.success) return message.error(result.error || 'Không lưu được cấu hình');
        setConfig(result.data);
        setConfigOpen(false);
        message.success('Đã lưu email tiếp nhận DVVC');
    };

    const loadHistory = async () => {
        const result = await window.electronAPI.carrierComplaints.getHistory();
        if (result.success) setHistory(result.data || []);
        setHistoryOpen(true);
    };

    const sendGroup = async () => {
        if (!selected) return;
        Modal.confirm({
            title: `Gửi khiếu nại ${selected.code}?`,
            content: `Hệ thống sẽ đối soát lại ${selected.orders.length} đơn ngay trước khi gửi tới ${selected.recipient}.`,
            okText: 'Đối soát & gửi', cancelText: 'Hủy',
            onOk: async () => {
                setSending(selected.code);
                try {
                    const result = await window.electronAPI.carrierComplaints.send({
                        carrierCode: selected.code, warehouse: 'Kho 01', cutoff: '18:30', orders: selected.orders,
                    });
                    if (!result.success) throw new Error(result.error || 'Gửi khiếu nại thất bại');
                    message.success(result.message || `Đã gửi ${selected.orders.length} đơn`);
                    await reconcile(rawOrders, fileCount);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : 'Gửi khiếu nại thất bại');
                } finally { setSending(''); }
            },
        });
    };

    return <div className="carrier-complaints-page">
        <div className="cc-heading">
            <div><Typography.Title level={3}>Khiếu nại DVVC</Typography.Title><Typography.Text type="secondary">Chốt đơn chưa được lấy cuối ngày • {dayjs().format('DD/MM/YYYY')}</Typography.Text></div>
            <Space><Button icon={<SettingOutlined />} onClick={openConfig}>Email DVVC</Button><Button icon={<HistoryOutlined />} onClick={loadHistory}>Lịch sử</Button></Space>
        </div>

        <Card title="Import đơn chưa được lấy" className="cc-import-card">
            <Row gutter={16} align="middle">
                <Col xs={24} lg={9}>
                    <div className="cc-upload-box">
                        <CloudUploadOutlined />
                        <div><strong>Chọn file hoặc thư mục</strong><span>Shopee / TikTok • XLSX, XLS, CSV</span></div>
                        <Space><Upload {...uploadProps}><Button loading={loading}>Chọn file</Button></Upload><Button onClick={importFolder} loading={loading}>Chọn thư mục</Button></Space>
                    </div>
                </Col>
                <Col xs={24} lg={15}>
                    <Row gutter={8} className="cc-stats">
                        <Col span={6}><Statistic title="Đơn chưa lấy" value={eligible.length} valueStyle={{ color: '#08ad60' }} /></Col>
                        <Col span={6}><Statistic title="Đã có trong Đơn hàng" value={pickedCount} /></Col>
                        <Col span={6}><Statistic title="Đã khiếu nại" value={duplicateCount} /></Col>
                        <Col span={6}><Statistic title="Cần kiểm tra" value={reviewCount} /></Col>
                    </Row>
                </Col>
            </Row>
            <Alert className="cc-independent-note" type="info" showIcon message={`${fileCount || 0} file • ${rawOrders.length} đơn đã đọc. Dữ liệu khiếu nại lưu riêng, không thay đổi Bàn giao TMĐT.`} />
        </Card>

        <Row gutter={16} className="cc-workspace">
            <Col xs={24} xl={15}>
                <Card title="Nhóm theo đơn vị vận chuyển" extra={<Tag color="green">{eligible.length} đơn sẽ gửi</Tag>}>
                    {groups.length ? <Table pagination={false} rowKey="code" dataSource={groups} onRow={record => ({ onClick: () => setSelectedCode(record.code) })} rowClassName={record => selected?.code === record.code ? 'cc-selected-row' : ''} columns={[
                        { title: 'DVVC', render: (_, row) => <Space><span className={`cc-carrier cc-${row.code.toLowerCase()}`}>{row.code}</span><strong>{row.name}</strong></Space> },
                        { title: 'Đơn', dataIndex: ['orders', 'length'], width: 70, render: (_, row) => <strong>{row.orders.length}</strong> },
                        { title: 'Nguồn', render: (_, row) => <Space size={4}><Tag icon={<ShopOutlined />}>Shopee {row.shopee}</Tag><Tag>TikTok {row.tiktok}</Tag></Space> },
                        { title: 'Trạng thái', width: 145, render: (_, row) => row.recipient ? <Tag color="success" icon={<CheckCircleOutlined />}>Sẵn sàng</Tag> : <Tag color="warning">Thiếu email</Tag> },
                    ]} /> : <Empty description="Import file cuối ngày để tạo lô khiếu nại" />}
                </Card>
            </Col>
            <Col xs={24} xl={9}>
                <Card className="cc-detail-card" title={selected ? <Space><span className={`cc-carrier cc-${selected.code.toLowerCase()}`}>{selected.code}</span>{selected.name}</Space> : 'Nội dung khiếu nại'}>
                    {selected ? <>
                        <Descriptions column={1} size="small" colon labelStyle={{ width: 105 }}>
                            <Descriptions.Item label="Kênh gửi"><MailOutlined /> Gmail</Descriptions.Item>
                            <Descriptions.Item label="Người nhận">{selected.recipient || <Typography.Text type="warning">Chưa cấu hình</Typography.Text>}</Descriptions.Item>
                            <Descriptions.Item label="Thời điểm chốt">18:30 hôm nay</Descriptions.Item>
                        </Descriptions>
                        <div className="cc-order-title"><strong>Danh sách vận đơn ({selected.orders.length})</strong><Button type="link" onClick={() => setPreviewOpen(true)}>Xem nội dung</Button></div>
                        <List size="small" className="cc-order-list" dataSource={selected.orders} renderItem={(order, index) => <List.Item extra={<Tag>{order.platform}</Tag>}><Typography.Text type="secondary">{index + 1}.</Typography.Text>&nbsp; <strong>{order.trackingNumber}</strong></List.Item>} />
                        <Alert className="cc-safety" type="success" showIcon icon={<SafetyCertificateOutlined />} message="Đã chống khiếu nại nhầm và trùng" description="Kiểm tra mã đơn + mã vận đơn và đối soát lại ngay trước khi gửi." />
                        <Button block type="primary" size="large" icon={<SendOutlined />} disabled={!selected.recipient} loading={sending === selected.code} onClick={sendGroup}>{selected.recipient ? `Gửi khiếu nại ${selected.code} • ${selected.orders.length} đơn` : `Cấu hình email ${selected.code} trước`}</Button>
                    </> : <Empty description="Chưa có DVVC được chọn" />}
                </Card>
            </Col>
        </Row>

        <Modal title="Email tiếp nhận đã xác minh" open={configOpen} onCancel={() => setConfigOpen(false)} onOk={saveConfig} okText="Lưu cấu hình" width={620}>
            <Alert type="warning" showIcon message="Đã điền sẵn email CSKH/khiếu nại công khai trên kênh chính thức." description="Chỉ sửa khi DVVC hoặc Seller Center cấp địa chỉ riêng. Đơn từ sàn có thể được hãng yêu cầu tiếp tục xử lý trên Seller Center." style={{ marginBottom: 16 }} />
            <Form form={form} layout="vertical"><Row gutter={12}>{CONFIG_CODES.map(code => <Col span={12} key={code}><Form.Item name={code} label={CARRIER_NAMES[code]} rules={[{ type: 'email', message: 'Email không hợp lệ' }]}><Input placeholder={`${code.toLowerCase()}@...`} /></Form.Item></Col>)}</Row></Form>
        </Modal>

        <Modal title={`Xem trước khiếu nại ${selected?.code || ''}`} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => setPreviewOpen(false)}>Đã kiểm tra</Button>} width={720}>
            <p><strong>Đến:</strong> {selected?.recipient || 'Chưa cấu hình'}</p><p><strong>Tiêu đề:</strong> Khiếu nại đơn chưa được lấy tại Kho 01</p><p>Kính gửi {selected?.name},</p><p>Đến 18:30, các đơn dưới đây vẫn chưa được cập nhật trạng thái lấy hàng. Vui lòng kiểm tra và hỗ trợ điều phối lấy hàng.</p><pre className="cc-preview">{selected?.orders.map(order => `${order.trackingNumber} — ${order.platform} — ${order.orderId}`).join('\n')}</pre>
        </Modal>

        <Drawer title="Lịch sử khiếu nại" open={historyOpen} onClose={() => setHistoryOpen(false)} width={680}>
            <List dataSource={history} locale={{ emptyText: 'Chưa có khiếu nại nào' }} renderItem={batch => <List.Item><List.Item.Meta title={<Space><strong>{batch.carrierCode}</strong><Tag color={batch.status === 'sent' ? 'success' : batch.status === 'failed' ? 'error' : 'warning'}>{batch.status}</Tag></Space>} description={<><div>{batch.id} • {batch.orders?.length || 0} đơn • {dayjs(batch.createdAt).format('DD/MM/YYYY HH:mm')}</div>{batch.error && <Typography.Text type="danger">{batch.error}</Typography.Text>}</>} /></List.Item>} />
        </Drawer>
    </div>;
}
