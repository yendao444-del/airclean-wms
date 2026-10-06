import { Button, Tag } from "antd";
import { InboxOutlined, RightOutlined } from "@ant-design/icons";
import type { packedStockForSku } from "../lib/handlingUnitAllocation";

const number = (value: number) => value.toLocaleString("vi-VN");
const statusLabels = { draft: "Đang sửa", submitted: "Chờ xác nhận", ready: "Sẵn sàng", issued: "Đã xuất" };

type Props = {
  rows: ReturnType<typeof packedStockForSku>;
  unitName: string;
  onOpen: () => void;
};

export default function HandlingUnitPackedStock({ rows, unitName, onOpen }: Props) {
  const comboCount = rows.reduce((sum, row) => sum + row.remainingCombos, 0);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  return <section className="hu-packed-stock" aria-label="Tồn combo đóng gói sẵn">
    <div className="hu-packed-stock-heading">
      <div><strong><InboxOutlined /> Đóng gói sẵn</strong><span>
        {number(comboCount)} combo chưa xuất · {number(quantity)} {unitName}
      </span></div>
      <Button size="small" type="link" onClick={onOpen}>Xem công việc <RightOutlined /></Button>
    </div>
    {rows.length > 0 ? <>
      <div className="hu-packed-stock-list">{rows.map(({ lot, remainingCombos, quantityPerCombo, quantity: componentQuantity }) =>
        <article className="hu-packed-stock-card" key={lot.assignmentId}>
          <div className="hu-packed-stock-card-heading"><strong>{lot.code}</strong>
            <Tag color={lot.status === "ready" ? "green" : "orange"}>{statusLabels[lot.status]}</Tag>
          </div>
          <div className="hu-packed-stock-quantity"><b>{number(remainingCombos)} combo</b><span>= {number(componentQuantity)} {unitName}</span></div>
          <small>SKU đang chọn: {number(quantityPerCombo)} {unitName}/combo · Ngày {lot.workDate.split("-").reverse().join("/")}</small>
        </article>,
      )}</div>
      <p>Tồn combo từ tất cả ngày làm việc, đã trừ số xuất. Số {unitName} này đã chuyển từ kiện sang combo, vẫn nằm trong tổng tồn SKU.</p>
    </> : <p>Chưa có combo được ghi nhận cho SKU này. Nhập số “Đã đóng” và gửi xác nhận để chuyển hàng từ kiện sang tồn combo.</p>}
  </section>;
}
