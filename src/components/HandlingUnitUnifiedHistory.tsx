import { useMemo, useState } from "react";
import { Alert, Button, Empty, Input, Select, Table, Tag, Tooltip } from "antd";
import { HistoryOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useSkuStockLedger } from "../lib/hooks/useSkuStockLedger";
import { buildUnifiedHistory, historyPackageIdentity, type UnifiedHistoryRow } from "../lib/handlingUnitUnifiedHistory";
import type { HandlingUnitHistoryEntry } from "../lib/handlingUnitHistory";

type Props = {
  sku: string;
  unitCode?: string;
  entries: readonly HandlingUnitHistoryEntry[];
  units: readonly { id: string; skuName: string; sequenceNumber?: number; unitName?: string }[];
  currentNumbers: ReadonlyMap<string, number>;
  packedLots?: readonly { assignmentId: string; components: readonly { sku: string; quantity: number }[] }[];
  onReloadSources?: () => unknown;
};
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("vi-VN");
const signed = (value: number | null) => `${value != null && value > 0 ? "+" : ""}${number(value)}`;
const time = (value: string) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok", hour12: false }) : "—";
const codeKey = (value?: string) => String(value || "").trim().toUpperCase();

export default function HandlingUnitUnifiedHistory({ sku, unitCode, entries, units, currentNumbers, packedLots, onReloadSources }: Props) {
  const { rows: stockRows, loading, error, reload } = useSkuStockLedger(sku);
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const rows = useMemo(() => buildUnifiedHistory(entries, stockRows, sku, units, packedLots), [entries, stockRows, sku, units, packedLots]);
  const identity = (code?: string) => historyPackageIdentity(code, units, currentNumbers);
  const selectedLabel = identity(unitCode).label;
  const types = [...new Set(rows.map(row => row.type))].sort();
  const visible = rows.filter(row => {
    if (selectedOnly && !row.packageLines.some(line => codeKey(line.code) === codeKey(unitCode))) return false;
    if (typeFilter !== "all" && row.type !== typeFilter) return false;
    const createdAt = Date.parse(row.createdAt);
    if (fromDate && !(createdAt >= Date.parse(`${fromDate}T00:00:00+07:00`))) return false;
    if (toDate && !(createdAt <= Date.parse(`${toDate}T23:59:59.999+07:00`))) return false;
    const text = [row.type, row.reference, row.actor, row.note,
      ...row.packageLines.flatMap(line => [identity(line.code).label, line.code, line.type, line.note])].join(" ");
    return text.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
  });
  const sourceNumbers = (row: UnifiedHistoryRow) => {
    const numbers = row.packageLines.map(line => {
      if (codeKey(line.code).startsWith("PACKED:")) return "Nguồn đóng gói sẵn";
      if (codeKey(line.code).startsWith("UNALLOCATED:")) return "Chưa phân kiện";
      const unit = units.find(item => codeKey(item.id) === codeKey(line.code));
      const value = unit && currentNumbers.get(unit.id);
      return value && Number.isInteger(value) && value > 0 ? String(value) : "—";
    });
    return [...new Set(numbers)].join(", ") || "—";
  };
  const sources = (row: UnifiedHistoryRow) => <div className="hu-history-unit-source">
    {row.packageLines.length ? row.packageLines.map((line, index) => {
      const source = identity(line.code);
      return <div key={`${row.key}-${index}`} className={codeKey(line.code) === codeKey(unitCode) ? "is-selected" : ""}>
        <b>{line.quantity != null && line.quantity < 0 ? "Trừ " : line.quantity != null && line.quantity > 0 ? "Cộng " : ""}{source.label}</b>
        <span className={Number(line.quantity) < 0 ? "is-negative" : "is-positive"}>{signed(line.quantity)} {source.unitName} · {number(line.before)} → {number(line.after)}</span>
        <small>{line.code || "—"}</small>
      </div>;
    }) : <div><b>Toàn SKU</b><small>Chưa xác định được kiện nguồn</small></div>}
  </div>;
  return (
    <section className="hu-unit-stock-history hu-unified-history" aria-label={`Lịch sử kiện và thẻ kho ${sku}`}>
      <header className="hu-unit-stock-history-header">
        <div>
          <h3><HistoryOutlined /> Lịch sử · {sku}</h3>
          <p>Tồn đầu / cuối là tồn toàn SKU. Kiện nguồn theo thứ tự hiện tại; “—” khi chưa xác định. Bấm Xem ghi chú để đối chiếu từng kiện.</p>
        </div>
        <Button icon={<ReloadOutlined />} size="small" onClick={() => { reload(); void onReloadSources?.(); }} loading={loading}>Tải lại</Button>
      </header>
      {error && <Alert type="warning" showIcon message={error} description="Phần thẻ kho chưa tải đầy đủ. Vẫn hiển thị thao tác kiện đã có; bấm Tải lại để thử lại." style={{ marginBottom: 10 }} />}
      <div className="hu-movement-history-filters">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm kiện số, mã kiện, chứng từ, nhân viên..." value={search} onChange={event => setSearch(event.target.value)} />
        <Select aria-label="Loại giao dịch" value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "Tất cả thao tác" }, ...types.map(type => ({ value: type, label: type }))]} style={{ width: 185 }} />
        <Input aria-label="Từ ngày" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} style={{ width: 140 }} />
        <Input aria-label="Đến ngày" type="date" value={toDate} onChange={event => setToDate(event.target.value)} style={{ width: 140 }} />
        {unitCode && <Button type={selectedOnly ? "primary" : "default"} aria-pressed={selectedOnly} onClick={() => setSelectedOnly(value => !value)}>Chỉ {selectedLabel.toLocaleLowerCase("vi")}</Button>}
      </div>
      <Table<UnifiedHistoryRow>
        rowKey="key"
        className="hu-unit-stock-history-table"
        size="small"
        tableLayout="fixed"
        dataSource={visible}
        loading={loading}
        scroll={{ x: 850 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lịch sử phù hợp" /> }}
        pagination={{ pageSize: 5, size: "small", showSizeChanger: false, showTotal: total => `${total} dòng gần đây` }}
        expandable={{
          showExpandColumn: false,
          expandedRowKeys: expanded,
          expandedRowRender: row => <div className="hu-unit-stock-history-note">
            <b>{row.reference || "Chi tiết giao dịch"}</b>
            <span>{row.note || "Không có ghi chú"}</span>
            {sources(row)}
            {row.packageLines.map((line, index) => <span key={index}>{identity(line.code).label} · {line.code} · {line.type || "Thao tác kiện"}{line.note && ` · ${line.note}`}</span>)}
            {row.kind === "stock" && !row.packageLines.length && <span>Lịch sử kiện gần đây chưa có bản ghi khớp chắc chắn với giao dịch này.</span>}
          </div>,
        }}
        columns={[
          { title: "Thời điểm / NV", width: 145, render: (_, row) => <div className="hu-history-ledger-meta"><span>{time(row.createdAt)}</span><span>{row.actor}</span></div> },
          { title: "Chứng từ", width: 230, render: (_, row) => <div className="hu-unit-stock-history-document"><Tag color={row.kind === "stock" ? "green" : "blue"} title={row.type}>{row.type}</Tag><Tooltip title={row.reference}><span>{row.reference || "—"}</span></Tooltip></div> },
          { title: "Tồn đầu", width: 85, align: "right", render: (_, row) => row.kind === "stock" ? number(row.before) : "—" },
          { title: "±", width: 85, align: "right", render: (_, row) => row.kind === "stock" ? <b className={Number(row.quantity) < 0 ? "is-negative" : "is-positive"}>{signed(row.quantity)}</b> : "—" },
          { title: "Tồn cuối", width: 85, align: "right", render: (_, row) => row.kind === "stock" ? number(row.after) : "—" },
          { title: "Kiện nguồn", width: 150, align: "center", render: (_, row) => <Tooltip title={row.packageLines.length ? row.packageLines.map(line => `${identity(line.code).label} · ${line.code}`).join("; ") : "Chưa xác định được kiện nguồn"}><b className="hu-history-source-number">{sourceNumbers(row)}</b></Tooltip> },
          { title: "Ghi chú", width: 130, render: (_, row) => <Button type="link" size="small" aria-expanded={expanded.includes(row.key)} onClick={() => setExpanded(keys => keys.includes(row.key) ? keys.filter(key => key !== row.key) : [...keys, row.key])}>{expanded.includes(row.key) ? "Thu gọn" : "Xem ghi chú"}</Button> },
        ]}
      />
    </section>
  );
}
