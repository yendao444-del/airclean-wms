import { useState, useEffect } from 'react';
import {
    Card,
    InputNumber,
    Switch,
    Row,
    Col,
    Statistic,
    Typography,
    Space,
    Tag,
    Button,
    Modal,
    Input,
    Segmented,
    Divider
} from 'antd';
import {
    DollarOutlined,
    ShoppingOutlined,
    RocketOutlined,
    EditOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

// Dùng chung fee defaults với BusinessReport
const DEFAULT_SHOPEE_FEES = [
    { id: 'troGia', name: 'Trợ giá (Đồng Tài Trợ)', type: 'percent', value: 4.50, icon: '🎁', color: '#ff4d4f' },
    { id: 'phiCoDinh', name: 'Phí cố định', type: 'percent', value: 12.50, icon: '💳', color: '#1890ff' },
    { id: 'piShip', name: 'Phí dịch vụ PiShip', type: 'fixed', value: 1620, icon: '🚚', color: '#52c41a' },
    { id: 'phiDichVu', name: 'Phí Dịch Vụ', type: 'fixed', value: 3000, icon: '⚙️', color: '#722ed1' },
    { id: 'phiThanhToan', name: 'Phí thanh toán', type: 'percent', value: 4.69, icon: '💰', color: '#fa8c16' },
    { id: 'thueGTGT', name: 'Thuế GTGT', type: 'percent', value: 0.96, icon: '🏛️', color: '#eb2f96' },
    { id: 'thueTNCN', name: 'Thuế TNCN', type: 'percent', value: 0.48, icon: '📊', color: '#13c2c2' },
    { id: 'affiliate', name: 'Hoa hồng Affiliate/CTV', type: 'percent', value: 0, icon: '🤝', color: '#52c41a' },
];

const DEFAULT_TIKTOK_FEES = [
    { id: 'phiGiaoDich', name: 'Phí giao dịch', type: 'percent', value: 5.00, icon: '💰', color: '#fa8c16' },
    { id: 'phiHoaHong', name: 'Phí hoa hồng TikTok Shop', type: 'percent', value: 10.31, icon: '💳', color: '#1890ff' },
    { id: 'phiXuLyDon', name: 'Phí xử lý đơn hàng', type: 'fixed', value: 3000, icon: '⚙️', color: '#722ed1' },
    { id: 'thueGTGT', name: 'Thuế GTGT (TikTok khấu trừ)', type: 'percent', value: 1.00, icon: '🏛️', color: '#eb2f96' },
    { id: 'thueTNCN', name: 'Thuế TNCN (TikTok khấu trừ)', type: 'percent', value: 0.50, icon: '📊', color: '#13c2c2' },
    { id: 'affiliate', name: 'Hoa hồng liên kết', type: 'percent', value: 15.00, icon: '🤝', color: '#52c41a' },
];

export default function FeeCalculator() {
    const [platform, setPlatform] = useState<'shopee' | 'tiktok'>('shopee');
    const [shopeeFees, setShopeeFees] = useState(DEFAULT_SHOPEE_FEES);
    const [tiktokFees, setTiktokFees] = useState(DEFAULT_TIKTOK_FEES);
    const [doanhThu, setDoanhThu] = useState(149999);
    const [giaNhap, setGiaNhap] = useState(0);
    const [vatRate, setVatRate] = useState(8);
    const [vatEnabled, setVatEnabled] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editingFee, setEditingFee] = useState<any>(null);

    // Load config
    useEffect(() => {
        (async () => {
            try {
                // Load Shopee fees (v3 - đồng bộ với BusinessReport)
                const shopeeRes = await window.electronAPI.appConfig.get('shopee_fees_v3');
                if (shopeeRes.success && shopeeRes.data && Array.isArray(shopeeRes.data)) {
                    setShopeeFees(shopeeRes.data);
                } else {
                    await window.electronAPI.appConfig.set('shopee_fees_v3', DEFAULT_SHOPEE_FEES);
                }

                // Load TikTok fees (v3)
                const tiktokRes = await window.electronAPI.appConfig.get('tiktok_fees_v3');
                if (tiktokRes.success && tiktokRes.data && Array.isArray(tiktokRes.data)) {
                    setTiktokFees(tiktokRes.data);
                } else {
                    await window.electronAPI.appConfig.set('tiktok_fees_v3', DEFAULT_TIKTOK_FEES);
                }

                // Load inputs
                const savedInputs = await window.electronAPI.appConfig.get('calculator_inputs_v2');
                if (savedInputs.success && savedInputs.data) {
                    const inputs = savedInputs.data;
                    setDoanhThu(inputs.doanhThu || 149999);
                    setGiaNhap(inputs.giaNhap || 0);
                    setVatRate(inputs.vatRate !== undefined ? inputs.vatRate : 8);
                    setVatEnabled(inputs.vatEnabled !== undefined ? inputs.vatEnabled : false);
                    if (inputs.platform) setPlatform(inputs.platform);
                }
            } catch (error) {
                console.error('Error loading fee config:', error);
            }
        })();
    }, []);

    // Save inputs when changed
    useEffect(() => {
        window.electronAPI.appConfig.set('calculator_inputs_v2', { doanhThu, giaNhap, vatRate, vatEnabled, platform });
    }, [doanhThu, giaNhap, vatRate, vatEnabled, platform]);

    const currentFees = platform === 'shopee' ? shopeeFees : tiktokFees;
    const setCurrentFees = platform === 'shopee' ? setShopeeFees : setTiktokFees;

    const saveFees = async (newFees: any[]) => {
        const key = platform === 'shopee' ? 'shopee_fees_v3' : 'tiktok_fees_v3';
        await window.electronAPI.appConfig.set(key, newFees);
        setCurrentFees(newFees);
    };

    const calculateFee = (fee: any) => {
        if (fee.type === 'percent') return (doanhThu * fee.value) / 100;
        return fee.value;
    };

    const totalFees = currentFees.reduce((sum, fee) => sum + calculateFee(fee), 0);
    const vatAmount = vatEnabled ? (giaNhap * vatRate) / 100 : 0;
    const conLai = doanhThu - totalFees - giaNhap - vatAmount;
    const feePercent = doanhThu > 0 ? (totalFees / doanhThu * 100) : 0;

    const fmt = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v));

    const openEditModal = (fee: any) => {
        setEditingFee({ ...fee });
        setEditModalVisible(true);
    };

    const saveEditedFee = () => {
        if (!editingFee) return;
        const newFees = currentFees.map(f => f.id === editingFee.id ? editingFee : f);
        saveFees(newFees);
        setEditModalVisible(false);
        setEditingFee(null);
    };

    const platformColor = platform === 'shopee' ? '#ff6633' : '#1a1a2e';
    const platformIcon = platform === 'shopee' ? '🛒' : '🎵';

    return (
        <div style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>
                    💰 Tính phí sản phẩm
                </Title>
                <Segmented
                    size="large"
                    value={platform}
                    onChange={(val) => setPlatform(val as 'shopee' | 'tiktok')}
                    options={[
                        { label: '🛒 Shopee', value: 'shopee' },
                        { label: '🎵 TikTok', value: 'tiktok' },
                    ]}
                    style={{ fontWeight: 600 }}
                />
            </div>

            {/* Input + Kết quả */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={8}>
                    <Card>
                        <Statistic
                            title="Doanh thu (Giá bán)"
                            value={doanhThu}
                            precision={0}
                            prefix={<DollarOutlined />}
                            suffix="₫"
                            valueStyle={{ color: '#3f8600' }}
                        />
                        <InputNumber
                            style={{ width: '100%', marginTop: 8 }}
                            size="large"
                            value={doanhThu}
                            onChange={(value) => setDoanhThu(value || 0)}
                            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, '')) as any}
                            addonAfter="₫"
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={8}>
                    <Card>
                        <Statistic
                            title="Giá nhập"
                            value={giaNhap}
                            precision={0}
                            prefix={<ShoppingOutlined />}
                            suffix="₫"
                            valueStyle={{ color: '#cf1322' }}
                        />
                        <InputNumber
                            style={{ width: '100%', marginTop: 8 }}
                            size="large"
                            value={giaNhap}
                            onChange={(value) => setGiaNhap(value || 0)}
                            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                            parser={(value) => Number(value!.replace(/\$\s?|(,*)/g, '')) as any}
                            addonAfter="₫"
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={8}>
                    <Card style={{
                        background: conLai >= 0
                            ? 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)'
                            : 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
                        border: 'none'
                    }}>
                        <Statistic
                            title={<span style={{ color: '#fff' }}>Lợi nhuận ước tính</span>}
                            value={conLai}
                            precision={0}
                            prefix={<RocketOutlined />}
                            suffix="₫"
                            valueStyle={{ color: '#fff', fontWeight: 'bold', fontSize: 32 }}
                        />
                        <Tag color={conLai >= 0 ? 'success' : 'error'} style={{ marginTop: 8, fontSize: 14 }}>
                            {doanhThu > 0 ? ((conLai / doanhThu * 100).toFixed(2) + '%') : '0%'}
                        </Tag>
                    </Card>
                </Col>
            </Row>

            {/* Các khoản phí */}
            <Card
                title={
                    <span>
                        {platformIcon} Chi phí {platform === 'shopee' ? 'Shopee' : 'TikTok'}
                        <Tag color={platform === 'shopee' ? 'orange' : 'default'} style={{ marginLeft: 8 }}>
                            Tổng: {fmt(totalFees)}₫ ({feePercent.toFixed(2)}%)
                        </Tag>
                    </span>
                }
                style={{ marginBottom: 16, borderTop: `3px solid ${platformColor}` }}
            >
                {/* Bảng chi tiết phí */}
                <div style={{ marginBottom: 16 }}>
                    {currentFees.map((fee) => {
                        const amount = calculateFee(fee);
                        const pct = doanhThu > 0 ? (amount / doanhThu * 100) : 0;

                        return (
                            <div
                                key={fee.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '10px 12px',
                                    borderBottom: '1px solid #f0f0f0',
                                    transition: 'background 0.2s',
                                    cursor: 'pointer',
                                }}
                                onClick={() => openEditModal(fee)}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <div style={{
                                    width: 28, height: 28, borderRadius: 6,
                                    background: `${fee.color}15`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 14, marginRight: 10,
                                    border: `1px solid ${fee.color}30`,
                                }}>{fee.icon}</div>
                                <div style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 13 }}>{fee.name}</Text>
                                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                                        {fee.type === 'percent' ? `${fee.value}%` : `${fmt(fee.value)}₫/đơn`}
                                    </Text>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <Text strong style={{ fontSize: 14, color: fee.color }}>
                                        -{fmt(amount)}₫
                                    </Text>
                                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                                        {pct.toFixed(2)}%
                                    </Text>
                                </div>
                                <EditOutlined style={{ marginLeft: 8, color: '#bfbfbf', fontSize: 12 }} />
                            </div>
                        );
                    })}
                </div>

                {/* Tổng kết */}
                <Divider style={{ margin: '8px 0' }} />
                <div style={{ padding: '8px 12px' }}>
                    <Row justify="space-between" align="middle">
                        <Text strong style={{ fontSize: 14 }}>Tổng phí sàn:</Text>
                        <Text strong style={{ fontSize: 16, color: '#ff4d4f' }}>-{fmt(totalFees)}₫</Text>
                    </Row>
                    <Row justify="space-between" align="middle" style={{ marginTop: 4 }}>
                        <Text strong style={{ fontSize: 14, color: '#52c41a' }}>
                            Doanh thu ước tính sau phí:
                        </Text>
                        <Text strong style={{ fontSize: 18, color: '#52c41a' }}>
                            {fmt(doanhThu - totalFees)}₫
                        </Text>
                    </Row>
                </div>
            </Card>

            {/* VAT */}
            <Card title="🧾 VAT (Giá nhập)" style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                            <Switch checked={vatEnabled} onChange={setVatEnabled} />
                            <Text strong>Hóa đơn VAT</Text>
                            {vatEnabled && <Tag color="orange">{vatRate}% × Giá nhập</Tag>}
                        </Space>
                        {vatEnabled && (
                            <Button
                                size="small"
                                onClick={() => {
                                    const newRate = prompt('Nhập % VAT:', String(vatRate));
                                    if (newRate !== null && !isNaN(Number(newRate))) {
                                        setVatRate(parseFloat(newRate));
                                    }
                                }}
                            >
                                Sửa {vatRate}%
                            </Button>
                        )}
                    </div>
                    {vatEnabled && (
                        <Statistic value={vatAmount} precision={0} suffix="₫" valueStyle={{ color: '#fa8c16' }} />
                    )}
                </Space>
            </Card>

            {/* Edit Modal */}
            <Modal
                title={`Sửa ${editingFee?.name || ''}`}
                open={editModalVisible}
                onCancel={() => setEditModalVisible(false)}
                onOk={saveEditedFee}
                okText="Lưu"
                cancelText="Hủy"
            >
                {editingFee && (
                    <Space direction="vertical" style={{ width: '100%' }} size={16}>
                        <div>
                            <Text>Tên phí:</Text>
                            <Input
                                value={editingFee.name}
                                onChange={(e) => setEditingFee({ ...editingFee, name: e.target.value })}
                                style={{ marginTop: 8 }}
                            />
                        </div>
                        <div>
                            <Text>Giá trị:</Text>
                            <InputNumber
                                style={{ width: '100%', marginTop: 8 }}
                                value={editingFee.value}
                                onChange={(value) => setEditingFee({ ...editingFee, value: value || 0 })}
                                step={editingFee.type === 'percent' ? 0.01 : 100}
                                addonAfter={editingFee.type === 'percent' ? '%' : '₫'}
                                formatter={editingFee.type === 'fixed' ? (v: any) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : undefined}
                                parser={editingFee.type === 'fixed' ? ((v: any) => v.replace(/,/g, '')) : undefined}
                            />
                        </div>
                        <div>
                            <Text>Loại:</Text>
                            <div style={{ marginTop: 8 }}>
                                <Space>
                                    <Button
                                        type={editingFee.type === 'percent' ? 'primary' : 'default'}
                                        onClick={() => setEditingFee({ ...editingFee, type: 'percent' })}
                                    >
                                        % Phần trăm
                                    </Button>
                                    <Button
                                        type={editingFee.type === 'fixed' ? 'primary' : 'default'}
                                        onClick={() => setEditingFee({ ...editingFee, type: 'fixed' })}
                                    >
                                        ₫ Cố định
                                    </Button>
                                </Space>
                            </div>
                        </div>
                    </Space>
                )}
            </Modal>
        </div>
    );
}
