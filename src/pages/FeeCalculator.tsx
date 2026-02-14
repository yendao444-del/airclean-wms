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
    Divider,
    Button,
    Modal,
    Input
} from 'antd';
import {
    DollarOutlined,
    PercentageOutlined,
    ShoppingOutlined,
    RocketOutlined,
    EditOutlined,
    CheckOutlined
} from '@ant-design/icons';

const { Title, Text } = Typography;

const DEFAULT_FEES = [
    { id: 'phiCoDinh', name: 'Phí cố định', type: 'percent', value: 12.50, icon: '💳', color: '#1890ff' },
    { id: 'piShip', name: 'Phí dịch vụ FiShip', type: 'fixed', value: 1620, icon: '🚚', color: '#52c41a' },
    { id: 'phiHaTang', name: 'Phí Dịch Vụ', type: 'fixed', value: 3000, icon: '⚙️', color: '#722ed1' },
    { id: 'phiThanhToan', name: 'Phí thanh toán', type: 'percent', value: 4.73, icon: '💰', color: '#fa8c16' },
    { id: 'thueGTGT', name: 'Thuế GTGT', type: 'percent', value: 0.96, icon: '🏛️', color: '#eb2f96' },
    { id: 'thueTNCN', name: 'Thuế TNCN', type: 'percent', value: 0.48, icon: '📊', color: '#13c2c2' },
    { id: 'ads', name: 'ADS', type: 'fixed', value: 0, isCustom: true, icon: '📢', color: '#f5222d' }
];

const CONFIG_VERSION = '2.0';

export default function FeeCalculator() {
    const [fees, setFees] = useState(DEFAULT_FEES);
    const [doanhThu, setDoanhThu] = useState(112000);
    const [giaNhap, setGiaNhap] = useState(0);
    const [vatRate, setVatRate] = useState(8);
    const [vatEnabled, setVatEnabled] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editingFee, setEditingFee] = useState<any>(null);

    useEffect(() => {
        (async () => {
            try {
                const savedVersion = await window.electronAPI.appConfig.get('config_version');
                const version = savedVersion.success ? savedVersion.data : null;

                if (version !== CONFIG_VERSION) {
                    console.log('🔄 Phát hiện version mới, reset về config mặc định');
                    await window.electronAPI.appConfig.set('config_version', CONFIG_VERSION);
                    await window.electronAPI.appConfig.set('fees_config', DEFAULT_FEES);
                    setFees(DEFAULT_FEES);
                } else {
                    const savedFees = await window.electronAPI.appConfig.get('fees_config');
                    if (savedFees.success && savedFees.data) {
                        setFees(savedFees.data);
                    }
                }

                const savedInputs = await window.electronAPI.appConfig.get('calculator_inputs');
                if (savedInputs.success && savedInputs.data) {
                    const inputs = savedInputs.data;
                    setDoanhThu(inputs.doanhThu || 0);
                    setGiaNhap(inputs.giaNhap || 0);
                    setVatRate(inputs.vatRate !== undefined ? inputs.vatRate : 8);
                    setVatEnabled(inputs.vatEnabled !== undefined ? inputs.vatEnabled : false);
                }
            } catch (error) {
                console.error('Error loading fee config:', error);
            }
        })();
    }, []);

    useEffect(() => {
        const inputs = { doanhThu, giaNhap, vatRate, vatEnabled };
        window.electronAPI.appConfig.set('calculator_inputs', inputs);
    }, [doanhThu, giaNhap, vatRate, vatEnabled]);

    const saveFees = async (newFees: any[]) => {
        await window.electronAPI.appConfig.set('fees_config', newFees);
        setFees(newFees);
    };

    const calculateFee = (fee: any) => {
        if (fee.type === 'percent') {
            return (doanhThu * fee.value) / 100;
        }
        return fee.value;
    };

    const regularFees = fees.filter(f => !f.isCustom);
    const adsFee = fees.find(f => f.id === 'ads');

    const totalFees = regularFees.reduce((sum, fee) => sum + calculateFee(fee), 0);
    const adsAmount = adsFee ? calculateFee(adsFee) : 0;
    const vatAmount = vatEnabled ? (giaNhap * vatRate) / 100 : 0;
    const conLai = doanhThu - totalFees - adsAmount - giaNhap - vatAmount;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN').format(value);
    };

    const getPercentDisplay = (fee: any) => {
        if (fee.type === 'percent') {
            return fee.value;
        }
        const percent = doanhThu > 0 ? (calculateFee(fee) / doanhThu * 100) : 0;
        return parseFloat(percent.toFixed(2));
    };

    const openEditModal = (fee: any) => {
        setEditingFee({ ...fee });
        setEditModalVisible(true);
    };

    const saveEditedFee = () => {
        if (!editingFee) return;

        const newFees = fees.map(f =>
            f.id === editingFee.id ? editingFee : f
        );
        saveFees(newFees);
        setEditModalVisible(false);
        setEditingFee(null);
    };

    return (
        <div style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh' }}>
            <Title level={2} style={{ marginBottom: 24 }}>
                💰 Tính phí sản phẩm
            </Title>

            {/* Input chính */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} lg={8}>
                    <Card>
                        <Statistic
                            title="Doanh thu"
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
                            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                            addonAfter="₫"
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={8}>
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
                            parser={(value) => value!.replace(/\$\s?|(,*)/g, '')}
                            addonAfter="₫"
                        />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={8}>
                    <Card style={{
                        background: conLai >= 0
                            ? 'linear-gradient(135deg, #52c41a 0%, #73d13d 100%)'
                            : 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
                        border: 'none'
                    }}>
                        <Statistic
                            title={<span style={{ color: '#fff' }}>Lợi nhuận</span>}
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
            <Card title="📊 Chi phí" style={{ marginBottom: 16 }}>
                <Row gutter={[16, 16]}>
                    {regularFees.map((fee) => {
                        const amount = calculateFee(fee);
                        const percent = getPercentDisplay(fee);

                        return (
                            <Col xs={24} sm={12} lg={6} key={fee.id}>
                                <Card
                                    size="small"
                                    style={{
                                        background: `linear-gradient(135deg, ${fee.color}15 0%, ${fee.color}05 100%)`,
                                        borderLeft: `4px solid ${fee.color}`,
                                        position: 'relative'
                                    }}
                                >
                                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {fee.icon} {fee.name}
                                            </Text>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<EditOutlined />}
                                                onClick={() => openEditModal(fee)}
                                            />
                                        </div>
                                        <Text strong style={{ fontSize: 18, color: fee.color }}>
                                            {formatCurrency(amount)} ₫
                                        </Text>
                                        <Tag color={fee.type === 'percent' ? 'blue' : 'green'} style={{ width: 'fit-content' }}>
                                            {percent}%
                                        </Tag>
                                    </Space>
                                </Card>
                            </Col>
                        );
                    })}

                    {/* ADS */}
                    {adsFee && (() => {
                        const amount = calculateFee(adsFee);
                        const percent = getPercentDisplay(adsFee);

                        return (
                            <Col xs={24} sm={12} lg={6} key={adsFee.id}>
                                <Card
                                    size="small"
                                    style={{
                                        background: `linear-gradient(135deg, ${adsFee.color}15 0%, ${adsFee.color}05 100%)`,
                                        borderLeft: `4px solid ${adsFee.color}`,
                                        position: 'relative'
                                    }}
                                >
                                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {adsFee.icon} {adsFee.name}
                                            </Text>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<EditOutlined />}
                                                onClick={() => openEditModal(adsFee)}
                                            />
                                        </div>
                                        <Text strong style={{ fontSize: 18, color: adsFee.color }}>
                                            {formatCurrency(amount)} ₫
                                        </Text>
                                        <Tag color={adsFee.type === 'percent' ? 'blue' : 'green'} style={{ width: 'fit-content' }}>
                                            {percent}%
                                        </Tag>
                                    </Space>
                                </Card>
                            </Col>
                        );
                    })()}
                </Row>
            </Card>

            {/* VAT */}
            <Card title="🧾 VAT" style={{ marginBottom: 16 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                            <Switch
                                checked={vatEnabled}
                                onChange={setVatEnabled}
                            />
                            <Text strong>Hóa đơn VAT</Text>
                            {vatEnabled && (
                                <Tag color="orange">{vatRate}% × Giá nhập</Tag>
                            )}
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
                        <Statistic
                            value={vatAmount}
                            precision={0}
                            suffix="₫"
                            valueStyle={{ color: '#fa8c16' }}
                        />
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
                                step={editingFee.type === 'percent' ? 0.1 : 100}
                                addonAfter={editingFee.type === 'percent' ? '%' : '₫'}
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
