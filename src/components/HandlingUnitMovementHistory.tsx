import { useMemo, useState } from "react";
import { Button, Empty, Input, Table, Tag, Tooltip } from "antd";
import { HistoryOutlined, SearchOutlined } from "@ant-design/icons";
import { handlingUnitHistory, type HandlingUnitHistoryEntry } from "../lib/handlingUnitHistory";

type Props = {
  sku: string;
  unitCode?: string;
  entries: readonly HandlingUnitHistoryEntry[];
  units: readonly { id: string; skuName: string }[];
};
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("vi-VN");
const time = (value?: string) => value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Bangkok", hour12: false }) : "—";

export default function HandlingUnitMovementHistory({ sku, unitCode, entries, units }: Props) {
  const [search, setSearch] = useState("");
  const [checksOnly, setChecksOnly] = useState(false);
  const rows = useMemo(() => handlingUnitHistory(entries, sku, units, unitCode), [entries, sku, units, unitCode]);
  const visible = rows.filter(row => (!checksOnly || /^kiểm/i.test(row.type || "")) &&
    [row.unitId, row.type, row.actor, row.reason, row.note].join(" ").toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  return (
    <section className="hu-unit-stock-history" aria-label={`Lịch sử thao tác kiện ${unitCode || sku}`}>
      <header className="hu-unit-stock-history-header">
        <div>
          <h3><HistoryOutlined /> Lịch sử thao tác kiện</h3>
          <p>Kiểm thực tế, lấy hàng và đồng bộ. Số lượng trước / sau thuộc từng kiện. Hiển thị hoạt động gần đây.</p>
        </div>
        <Tag>{rows.length} hoạt động</Tag>
      </header>
      <div className="hu-movement-history-filters">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm mã kiện, người kiểm, ghi chú..." value={search} onChange={event => setSearch(event.target.value)} />
        <Button type={checksOnly ? "primary" : "default"} aria-pressed={checksOnly} onClick={() => setChecksOnly(value => !value)}>Chỉ xem kiểm kiện</Button>
      </div>
      <Table
        className="hu-unit-stock-history-table"
        rowKey="key"
        size="small"
        tableLayout="fixed"
        dataSource={visible}
        scroll={{ x: 860 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thao tác kiện phù hợp trong lịch sử gần đây" /> }}
        pagination={{ pageSize: 5, size: "small", showSizeChanger: false }}
        columns={[
          { title: "Thời điểm / NV", width: 165, render: (_, row) => <div className="hu-history-ledger-meta"><span>{time(row.createdAt)}</span><span>{row.actor || "Hệ thống"}</span></div> },
          { title: "Mã kiện", dataIndex: "unitId", width: 195, ellipsis: true },
          { title: "Thao tác", width: 190, render: (_, row) => <Tag color={/^kiểm/i.test(row.type || "") ? "gold" : /đồng bộ/i.test(row.type || "") ? "default" : "blue"} style={{ whiteSpace: "normal" }}>{row.type || "Hoạt động khác"}</Tag> },
          { title: "Trước", dataIndex: "before", width: 70, align: "right", render: number },
          { title: "Sau", dataIndex: "after", width: 70, align: "right", render: number },
          { title: "Ghi chú", ellipsis: true, render: (_, row) => <Tooltip title={row.note || row.reason}><span>{row.note || row.reason || "—"}</span></Tooltip> },
        ]}
      />
    </section>
  );
}
