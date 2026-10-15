import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Modal, Space, Spin, Typography, message } from 'antd';

type Settings = {
    periodKey: string;
    employees: Array<{ id: number; name: string; username: string }>;
    employeeIds: number[];
    revision: string;
    payrollOverrides: Record<string, any>;
};

export default function SalesBonusSettingsModal({ open, periodKey, eligibleEmployeeIds, kind = 'sales', onClose, onSaved }: {
    open: boolean;
    periodKey: string;
    eligibleEmployeeIds: number[];
    kind?: 'sales' | 'packing';
    onClose: () => void;
    onSaved: (payrollOverrides: Record<string, any>) => void;
}) {
    const isPacking = kind === 'packing';
    const [settings, setSettings] = useState<Settings | null>(null);
    const [selected, setSelected] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const savingRef = useRef(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setSettings(null);
        setError('');
        setLoading(true);
        void (async () => {
            try {
                const api = window.electronAPI?.attendance;
                if (!api || (isPacking ? !api.getPackingIncomeSettings : !api.getSalesBonusSettings)) {
                    throw new Error('Vui lòng đóng/mở lại ứng dụng để cập nhật chức năng cài đặt thưởng.');
                }
                const response = await (isPacking ? api.getPackingIncomeSettings({ periodKey }) : api.getSalesBonusSettings({ periodKey }));
                if (!response.success || !response.data) throw new Error(response.error || 'Không tải được danh sách nhận thưởng.');
                if (!cancelled) {
                    setSettings(response.data);
                    setSelected(response.data.employeeIds);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được cài đặt thưởng.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, periodKey, reloadKey, kind]);

    const visibleEmployees = (settings?.employees || []).filter(employee => eligibleEmployeeIds.includes(employee.id));
    const visibleIds = visibleEmployees.map(employee => employee.id);
    const save = async () => {
        if (!settings || savingRef.current || settings.periodKey !== periodKey) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            const api = window.electronAPI.attendance;
            const response = await (isPacking ? api.updatePackingIncomeSettings({
                periodKey: settings.periodKey,
                employeeIds: selected,
                expectedRevision: settings.revision,
            }) : api.updateSalesBonusSettings({
                periodKey: settings.periodKey,
                employeeIds: selected,
                expectedRevision: settings.revision,
            }));
            if (!response.success || !response.data?.payrollOverrides) throw new Error(response.error || 'Không lưu được người nhận thưởng.');
            onSaved(response.data.payrollOverrides);
            message.success(isPacking ? 'Đã lưu nhân viên nhận thu nhập đóng gói.' : 'Đã lưu nhân viên nhận thưởng doanh thu.');
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Không lưu được cài đặt thưởng.');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return <Modal
        title={isPacking ? 'Cài đặt nhân viên nhận thu nhập đóng gói' : 'Cài đặt nhân viên nhận thưởng doanh thu'}
        open={open}
        width={560}
        onCancel={() => { if (!savingRef.current) onClose(); }}
        closable={!saving}
        maskClosable={!saving}
        footer={<Space wrap>
            <Button onClick={() => setReloadKey(value => value + 1)} disabled={loading || saving}>Tải lại danh sách</Button>
            <Button onClick={onClose} disabled={saving}>Hủy</Button>
            <Button type="primary" onClick={() => void save()} loading={saving} disabled={loading || !settings || settings.periodKey !== periodKey}>Lưu áp dụng</Button>
        </Space>}
    >
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`Áp dụng riêng cho tháng ${periodKey.slice(5)}/${periodKey.slice(0, 4)}`}
            description={isPacking
                ? 'Chọn nhân viên được nhận thu nhập đóng gói. Bỏ chọn để không tính khoản thu nhập này trong bảng lương, phiếu lương và Gmail của tháng này. Giữ nguyên đơn hàng, sản lượng, bảng xếp hạng, đơn giá và thưởng vô địch tuần. Không sửa kỳ lương đã khóa.'
                : 'Chọn nhân viên chính thức được nhận thưởng doanh thu theo tỷ lệ hiện tại. Bỏ chọn để không tính khoản thưởng này trong bảng lương, phiếu lương và Gmail của tháng này. Không thay đổi tỷ lệ thưởng hoặc kỳ lương đã khóa.'} />
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <Spin spinning={loading}>
            <Space style={{ marginBottom: 12 }} wrap>
                <Button size="small" disabled={!settings || saving || loading} onClick={() => setSelected(current => [...new Set([...current, ...visibleIds])])}>Chọn tất cả</Button>
                <Button size="small" disabled={!settings || saving || loading} onClick={() => setSelected(current => current.filter(id => !visibleIds.includes(id)))}>Bỏ chọn tất cả</Button>
                <Typography.Text type="secondary">Đã chọn {selected.filter(id => visibleIds.includes(id)).length}/{visibleEmployees.length} nhân viên</Typography.Text>
            </Space>
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 2px' }}>
                {!loading && settings && visibleEmployees.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có nhân viên đang làm việc." />}
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {visibleEmployees.map(employee => <Checkbox key={employee.id}
                        disabled={saving || loading}
                        checked={selected.includes(employee.id)}
                        onChange={event => setSelected(current => event.target.checked ? [...new Set([...current, employee.id])] : current.filter(id => id !== employee.id))}
                    >{employee.name} <Typography.Text type="secondary">@{employee.username}</Typography.Text></Checkbox>)}
                </Space>
            </div>
        </Spin>
    </Modal>;
}
