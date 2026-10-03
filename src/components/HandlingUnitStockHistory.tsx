import { useState } from "react";
import { Alert, Button, Empty, Table, Tag, Tooltip } from "antd";
import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons";
import { useSkuStockLedger, type StockLedgerRow } from "../lib/hooks/useSkuStockLedger";

const number = (value: number | null | undefined) => value == null ? "—" : Number(value).toLocaleString("vi-VN");
const time = (value: string) => new Date(value).toLocaleString("vi-VN", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export default function HandlingUnitStockHistory({ sku }: { sku: string }) {
  const { rows, loading, error, reload } = useSkuStockLedger(sku);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  return (
    <section className="hu-unit-stock-history" aria-label={`Thẻ kho SKU ${sku}`}>
      <header className="hu-unit-stock-history-header">
        <div>
          <h3><HistoryOutlined /> Thẻ kho · {sku}</h3>
          <p>Lịch sử nhập / xuất của toàn bộ SKU. Tồn đầu và tồn cuối là tồn SKU.</p>
        </div>
        <Button icon={<ReloadOutlined />} size="small" onClick={reload} loading={loading}>Tải lại</Button>
      </header>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 10 }} />}
      <Table<StockLedgerRow>
        key={sku}
        className="hu-unit-stock-history-table"
        rowKey="id"
        size="small"
        tableLayout="fixed"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 760 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có giao dịch thẻ kho" /> }}
        pagination={{ pageSize: 5, size: "small", showSizeChanger: false, showTotal: total => `${total} giao dịch gần nhất` }}
        expandable={{
          showExpandColumn: false,
          expandedRowKeys: expandedKeys,
          expandedRowRender: row => <div className="hu-unit-stock-history-note"><b>{row.reference || "Ghi chú"}</b><span>{row.note || "Không có ghi chú"}</span></div>,
        }}
        columns={[
          { title: "Thời điểm / NV", width: 145, render: (_, row) => <div className="hu-history-ledger-meta"><span>{time(row.createdAt)}</span><span>{row.actor}</span></div> },
          { title: "Chứng từ", width: 195, render: (_, row) => <div className="hu-unit-stock-history-document"><Tag>{row.referenceType || row.type || "Khác"}</Tag><span>{row.reference || "—"}</span></div> },
          { title: "Tồn đầu", dataIndex: "oldStock", width: 85, align: "right", render: number },
          { title: "±", dataIndex: "quantity", width: 85, align: "right", render: value => <b className={Number(value) < 0 ? "is-negative" : "is-positive"}>{Number(value) > 0 ? "+" : ""}{number(value)}</b> },
          { title: "Tồn cuối", dataIndex: "newStock", width: 85, align: "right", render: number },
          { title: "Ghi chú", render: (_, row) => row.note ? <Tooltip title={row.note}><Button type="link" size="small" onClick={() => setExpandedKeys(keys => keys.includes(row.id) ? keys.filter(key => key !== row.id) : [...keys, row.id])}>{expandedKeys.includes(row.id) ? "Thu gọn" : "Xem ghi chú"}</Button></Tooltip> : "—" },
        ]}
      />
    </section>
  );
}
