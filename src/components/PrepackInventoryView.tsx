import { Tag } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { PackingLot } from '../types/packagePacking';
import { packedStockForSku } from '../lib/handlingUnitAllocation';
import './PrepackInventoryView.css';

const number = (value: number) => value.toLocaleString('vi-VN');
const statusLabels: Record<string, string> = {
  draft: 'Đang sửa',
  submitted: 'Chờ xác nhận',
  ready: 'Sẵn sàng',
  issued: 'Đã xuất',
};

type Props = {
  lots: readonly PackingLot[];
  sku: string;
  unitName: string;
  canCreate?: boolean;
  onCreate?: () => void;
};

export default function PrepackInventoryView({ lots, sku, unitName, canCreate = false, onCreate }: Props) {
  const rows = packedStockForSku(lots, sku);
  const comboCount = rows.reduce((sum, row) => sum + row.remainingCombos, 0);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);

  return <section className="prepack-inventory-view" aria-label="Tồn hàng đóng gói sẵn">
    <header className="prepack-inventory-heading">
      <div>
        <div className="prepack-inventory-title"><InboxOutlined /> <strong>Tồn đóng gói sẵn</strong></div>
        <p>Chỉ hiển thị số combo đang còn trong kho, đã trừ những combo đã xuất.</p>
      </div>
      {canCreate && <button type="button" className="prepack-inventory-create" onClick={onCreate}>Tạo đóng gói sẵn</button>}
    </header>
    <div className="prepack-inventory-summary">
      <div><span>Combo còn lại</span><strong>{number(comboCount)} combo</strong></div>
      <div><span>Quy đổi theo SKU {sku}</span><strong>{number(quantity)} {unitName}</strong></div>
      <div><span>Số lô đóng sẵn</span><strong>{number(rows.length)} lô</strong></div>
    </div>
    {rows.length ? <div className="prepack-inventory-list">{rows.map(({ lot, remainingCombos, quantityPerCombo, quantity: componentQuantity }) =>
      <article className="prepack-inventory-card" key={lot.assignmentId}>
        <div className="prepack-inventory-card-heading">
          <div><strong>{lot.code}</strong><small>{lot.workDate.split('-').reverse().join('/')}</small></div>
          <Tag color={lot.status === 'ready' ? 'green' : lot.status === 'issued' ? 'default' : 'orange'}>{statusLabels[lot.status] || lot.status}</Tag>
        </div>
        <div className="prepack-inventory-card-quantity"><strong>{number(remainingCombos)} combo</strong><span>= {number(componentQuantity)} {unitName}</span></div>
        <small>{number(quantityPerCombo)} {unitName}/{`combo`} · {lot.components.map(component => `${number(component.quantity)} ${component.sku}`).join(' + ')}</small>
      </article>,
    )}</div> : <div className="prepack-inventory-empty">SKU này hiện chưa có combo đóng sẵn còn lại trong kho.</div>}
    <p className="prepack-inventory-note">Số lượng này đã chuyển từ kiện sang combo và vẫn nằm trong tổng tồn SKU. Tab này không phụ thuộc ngày làm việc hay danh sách giao việc.</p>
  </section>;
}
