import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, DatePicker, Empty, Input, Select, Spin, Table, Tag } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import type { PackedComboHistoryEntry } from '../types/packagePacking';

export default function PackedComboHistory({ workHistory }: { workHistory?: ReactNode }) {
  const [scope, setScope] = useState('counts');
  const [rows, setRows] = useState<PackedComboHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([dayjs().subtract(7, 'day'), dayjs()]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    window.electronAPI.packedComboCheck.history({ startDate: range[0]?.format('YYYY-MM-DD'), endDate: range[1]?.format('YYYY-MM-DD'), pattern: search })
      .then(result => {
        if (cancelled) return;
        if (!result.success) throw new Error(result.error || 'Không tải được lịch sử.');
        setRows(result.data || []);
      }).catch(reason => { if (!cancelled) { setRows([]); setError(reason.message || 'Không tải được lịch sử.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range[0]?.valueOf(), range[1]?.valueOf(), search, refresh]);
  const employees = useMemo(() => [...new Map(rows.flatMap(row => row.items.length ? row.items.map(item => [item.packerUsername || row.packerUsername, item.packerName || row.packerName] as const) : [[row.packerUsername, row.packerName] as const])).entries()].map(([value, label]) => ({ value, label })), [rows]);
  const [employee, setEmployee] = useState<string>();
  const data = rows.flatMap((row, rowIndex) => (row.items.length ? row.items : [{ code: '', key: '', lotCode: `Dữ liệu cũ (${row.count} mẫu, chỉ có tổng)`, components: [], bookQuantity: 0, actualQuantity: 0, variance: row.variance, reason: '', note: '' }]).map((item, index) => ({ ...item, row, packerUsername: item.packerUsername || row.packerUsername, packerName: item.packerName || row.packerName, key: `${row.reference || row.at}-${rowIndex}-${index}` }))).filter(item => !employee || item.packerUsername === employee);
  return <div className="hu-history-panel">
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <strong>{scope === 'work' ? 'Lịch sử giao / nhận việc' : 'Lịch sử nhập số đã đóng'}</strong>
      {workHistory && <Button type="link" size="small" onClick={() => setScope(scope === 'work' ? 'counts' : 'work')}>
        {scope === 'work' ? '← Về lịch sử nhập số đã đóng' : 'Xem lịch sử giao / nhận việc'}
      </Button>}
    </div>
    {scope === 'work' ? workHistory : <>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      <DatePicker.RangePicker value={range} format="DD/MM/YYYY" onChange={value => setRange(value ? [value[0], value[1]] : [null, null])} />
      <Select allowClear placeholder="Nhân viên" options={employees} value={employee} onChange={setEmployee} style={{ minWidth: 180 }} />
      <Input.Search allowClear placeholder="Tìm mẫu / mã combo" onSearch={setSearch} style={{ width: 220 }} />
      <Button onClick={() => setRefresh(value => value + 1)}>Làm mới</Button>
    </div>
    {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
    {rows.length === 1000 && <Alert type="info" message="Đang hiển thị 1.000 lần xác nhận mới nhất. Chọn khoảng ngày hẹp hơn để xem đầy đủ." />}
    {rows.some(row => row.legacy) && <Alert type="info" message="Các lần nhập cũ chưa lưu chi tiết từng mẫu, nên chỉ hiển thị tổng chênh lệch." style={{ marginBottom: 12 }} />}
    <Spin spinning={loading}><Table size="small" rowKey="key" dataSource={data} locale={{ emptyText: <Empty description="Chưa có lịch sử xác nhận" /> }} columns={[
      { title: 'Thời gian', render: (_: unknown, item: typeof data[number]) => new Date(item.row.at).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) },
      { title: 'Nhân viên', render: (_: unknown, item: typeof data[number]) => <>{item.packerName}{item.packerUsername !== item.row.by && <Tag color="blue" style={{ marginLeft: 6 }}>Nhập thay</Tag>}</> },
      { title: 'Mẫu đóng gói', dataIndex: 'lotCode' },
      { title: 'Trước', render: (_: unknown, item: typeof data[number]) => item.row.legacy ? '—' : item.bookQuantity, align: 'right' as const },
      { title: 'Đã đóng', render: (_: unknown, item: typeof data[number]) => item.row.legacy ? '—' : item.actualQuantity, align: 'right' as const },
      { title: 'Chênh lệch', render: (_: unknown, item: typeof data[number]) => <Tag color={item.variance < 0 ? 'red' : item.variance > 0 ? 'green' : 'default'}>{item.variance > 0 ? `+${item.variance}` : item.variance}</Tag> },
      { title: 'Lý do / ghi chú', render: (_: unknown, item: typeof data[number]) => [item.reason, item.note].filter(Boolean).join(' · ') || '—' },
      { title: 'Người thao tác', render: (_: unknown, item: typeof data[number]) => item.row.adminUsername ? `${item.row.adminUsername} (đóng vai ${item.row.by})` : item.row.by || '—' },
      { title: 'Nguồn', render: (_: unknown, item: typeof data[number]) => item.row.mode === 'row' ? 'Nhập Đã đóng' : item.row.mode === 'spot' ? 'Kiểm cuối ca' : 'Kiểm combo' },
    ]} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }} /></Spin>
    </>}
  </div>;
}
