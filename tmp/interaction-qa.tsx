import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, Button, Calendar, ConfigProvider, DatePicker, Dropdown, Form, Layout, Modal, Space, TimePicker } from 'antd';
import { CalendarOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import viVN from 'antd/locale/vi_VN';
import '../src/index.css';
import '../src/App.css';
import '../src/pages/Attendance.css';
import '../src/pages/DailyTasks.css';

const { Header, Content } = Layout;

type HeaderContextValue = {
    headerExtra: React.ReactNode;
    setHeaderExtra: (node: React.ReactNode) => void;
    clearHeaderExtra: () => void;
};

const HeaderContext = createContext<HeaderContextValue>({
    headerExtra: null,
    setHeaderExtra: () => {},
    clearHeaderExtra: () => {},
});

function HeaderProvider({ children }: { children: React.ReactNode }) {
    const [headerExtra, setHeaderExtra] = useState<React.ReactNode>(null);
    const clearHeaderExtra = useCallback(() => setHeaderExtra(null), []);
    return <HeaderContext.Provider value={{ headerExtra, setHeaderExtra, clearHeaderExtra }}>{children}</HeaderContext.Provider>;
}

function AttendanceControl() {
    const { setHeaderExtra, clearHeaderExtra } = useContext(HeaderContext);
    const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')]);
    const [pickerMode, setPickerMode] = useState<'day' | 'month' | 'range' | null>(null);
    const [draftRange, setDraftRange] = useState(range);
    const node = useMemo(() => (
        <>
            <div className="att-header-period">
                <Dropdown
                    trigger={['click']}
                    menu={{
                        style: { minWidth: 286 },
                        items: [
                            { key: 'this-month', label: 'Tháng này' },
                            { type: 'divider' },
                            { key: 'pick-day', label: <span className="att-period-menu-choice"><strong>Theo ngày</strong><small>Chọn một ngày cụ thể</small></span> },
                            { key: 'pick-month', label: <span className="att-period-menu-choice"><strong>Theo tháng</strong><small>Chọn trọn một tháng</small></span> },
                            { key: 'pick-range', label: <span className="att-period-menu-choice"><strong>Tùy chỉnh khoảng</strong><small>Chọn ngày bắt đầu và kết thúc</small></span> },
                        ],
                        onClick: ({ key }) => {
                            if (key === 'this-month') setRange([dayjs().startOf('month'), dayjs().endOf('month')]);
                            if (key.startsWith('pick-')) {
                                setDraftRange(range);
                                setPickerMode(key.replace('pick-', '') as 'day' | 'month' | 'range');
                            }
                        },
                    }}
                >
                    <Button className="att-header-period__button">
                        <CalendarOutlined className="att-header-period__icon" />
                        <span className="att-header-period__label">Tháng này</span>
                        <span className="att-header-period__range">{range[0].format('DD/MM')} → {range[1].format('DD/MM/YYYY')}</span>
                        <DownOutlined className="att-header-period__arrow" />
                    </Button>
                </Dropdown>
            </div>
            <Modal
                title="Chọn kỳ chấm công"
                open={pickerMode !== null}
                onCancel={() => setPickerMode(null)}
                onOk={() => { setRange(draftRange); setPickerMode(null); }}
                okText="Áp dụng"
                cancelText="Hủy"
                destroyOnHidden
            >
                <div className="att-period-picker-control">
                    {pickerMode === 'range' ? (
                        <DatePicker.RangePicker value={draftRange} format="DD/MM/YYYY" allowClear={false} inputReadOnly onChange={dates => dates?.[0] && dates[1] && setDraftRange([dates[0], dates[1]])} />
                    ) : (
                        <DatePicker value={draftRange[0]} picker={pickerMode === 'month' ? 'month' : 'date'} format={pickerMode === 'month' ? 'MM/YYYY' : 'DD/MM/YYYY'} allowClear={false} inputReadOnly onChange={date => date && setDraftRange(pickerMode === 'month' ? [date.startOf('month'), date.endOf('month')] : [date.startOf('day'), date.endOf('day')])} />
                    )}
                </div>
            </Modal>
        </>
    ), [draftRange, pickerMode, range]);

    useEffect(() => {
        setHeaderExtra(node);
        return clearHeaderExtra;
    }, [node, clearHeaderExtra, setHeaderExtra]);

    return <p>Attendance content</p>;
}

function BusinessControl() {
    const { setHeaderExtra, clearHeaderExtra } = useContext(HeaderContext);
    const [active, setActive] = useState('pnl');
    const [clicks, setClicks] = useState(0);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setHeaderExtra(
            <Space size={4}>
                <Button type={active === 'pnl' ? 'primary' : 'default'} onClick={() => setActive('pnl')}>Báo cáo P&amp;L</Button>
                <Button type={active === 'inventory' ? 'primary' : 'default'} onClick={() => setActive('inventory')}>Giá trị tồn kho</Button>
                <Button icon={<ReloadOutlined />} loading={loading} onClick={() => {
                    setClicks(value => value + 1);
                    setLoading(true);
                    window.setTimeout(() => setLoading(false), 150);
                }}>Làm mới dữ liệu</Button>
            </Space>,
        );
        return clearHeaderExtra;
    }, [active, loading, setHeaderExtra, clearHeaderExtra]);

    return <p data-testid="business-state">Active: {active}; clicks: {clicks}</p>;
}

function DailyControl() {
    const [open, setOpen] = useState(false);
    const [date, setDate] = useState(dayjs());
    return (
        <>
            <Button icon={<CalendarOutlined />} onClick={() => setOpen(true)}>{date.format('DD/MM/YYYY')}</Button>
            <Form initialValues={{ deadline: dayjs().hour(19).minute(0).second(0) }} style={{ width: 420, marginTop: 24 }}>
                <Form.Item name="deadline" label="Thời hạn hoàn thành">
                    <AssignmentDeadlinePicker />
                </Form.Item>
            </Form>
            <Modal title="Chọn ngày công việc" open={open} footer={null} width={380} destroyOnHidden onCancel={() => setOpen(false)}>
                <Calendar fullscreen={false} value={date} onSelect={value => { setDate(value); setOpen(false); }} />
            </Modal>
        </>
    );
}

function AssignmentDeadlinePicker({ value, onChange }: { value?: dayjs.Dayjs; onChange?: (value: dayjs.Dayjs) => void }) {
    const currentValue = value?.isValid() ? value : dayjs().hour(19).minute(0).second(0).millisecond(0);
    return (
        <div className="assignment-deadline-picker">
            <label>
                <span>Ngày hoàn thành</span>
                <DatePicker value={currentValue} format="DD/MM/YYYY" allowClear={false} inputReadOnly onChange={date => date && onChange?.(date.hour(currentValue.hour()).minute(currentValue.minute()).second(0).millisecond(0))} />
            </label>
            <label>
                <span>Giờ hoàn thành</span>
                <TimePicker value={currentValue} format="HH:mm" allowClear={false} inputReadOnly needConfirm={false} minuteStep={1} onChange={time => time && onChange?.(currentValue.hour(time.hour()).minute(time.minute()).second(0).millisecond(0))} />
            </label>
        </div>
    );
}

function QaApp() {
    const { headerExtra } = useContext(HeaderContext);
    const [screen, setScreen] = useState<'attendance' | 'daily' | 'business'>('attendance');
    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Header className="app-page-header" style={{ background: '#fff', display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 1 }}>
                <Space>
                    <Button onClick={() => setScreen('attendance')}>Attendance</Button>
                    <Button onClick={() => setScreen('daily')}>Daily</Button>
                    <Button onClick={() => setScreen('business')}>Business</Button>
                </Space>
                <div className="app-page-header-extra" style={{ display: 'flex', alignItems: 'center', flex: 1 }}>{headerExtra}</div>
            </Header>
            <Content className="app-content" style={{ padding: 24 }}>
                {screen === 'attendance' && <AttendanceControl />}
                {screen === 'daily' && <DailyControl />}
                {screen === 'business' && <BusinessControl />}
            </Content>
        </Layout>
    );
}

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#00ab56' } }}>
            <App>
                <HeaderProvider><QaApp /></HeaderProvider>
            </App>
        </ConfigProvider>
    </React.StrictMode>,
);
