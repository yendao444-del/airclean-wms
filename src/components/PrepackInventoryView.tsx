import { useEffect, useState } from 'react';
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
  /** Empty means the overview: show every SKU with remaining prepacked stock. */
  sku?: string;
  unitName?: string;
  catalog?: readonly { sku: string; variantName: string; unitName: string }[];
  canCreate?: boolean;
  onCreate?: () => void;
};

export default function PrepackInventoryView({ lots, sku = '', unitName = 'đơn vị', catalog = [], canCreate = false, onCreate }: Props) {
  const [filterSku, setFilterSku] = useState(sku);
  const [filterPacker, setFilterPacker] = useState('');
  useEffect(() => setFilterSku(sku), [sku]);
  const selectedSku = filterSku.trim();
  const filteredLots = lots.filter(lot => !filterPacker || (lot.packerUsername || '__unknown__') === filterPacker);
  const rows = selectedSku
    ? packedStockForSku(filteredLots, selectedSku)
    : filteredLots.flatMap(lot => {
      const remainingCombos = Math.max(0, lot.packedQty - (lot.issuedQty || 0));
      return remainingCombos > 0 ? [{ lot, remainingCombos, quantityPerCombo: 0, quantity: 0 }] : [];
    });
  const comboCount = selectedSku
    ? rows.reduce((sum, row) => sum + row.remainingCombos, 0)
    : rows.reduce((sum, row) => sum + row.remainingCombos, 0);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const skuOptions = [...new Set(filteredLots.flatMap(lot => lot.components.map(component => component.sku)))].sort();
  const packerOptions = [...new Map(lots.filter(lot => lot.packerUsername).map(lot => [lot.packerUsername!, lot.packerName || lot.packerUsername!])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  const hasUnknownPacker = lots.some(lot => !lot.packerUsername);
  const labelForSku = (value: string) => catalog.find(item => item.sku === value)?.variantName || value;
  const unitForSku = (value: string) => catalog.find(item => item.sku === value)?.unitName || unitName;

  return <section className="prepack-inventory-view" aria-label="Tồn hàng đóng gói sẵn">
    <header className="prepack-inventory-heading">
      <div>
        <div className="prepack-inventory-title"><InboxOutlined /> <strong>Tồn đóng gói sẵn</strong></div>
        <p>{selectedSku ? `Đang lọc theo ${labelForSku(selectedSku)} · ` : 'Tổng quan tất cả sản phẩm · '}chỉ hiển thị combo còn trong kho sau khi trừ combo đã xuất.</p>
      </div>
      {canCreate && <button type="button" className="prepack-inventory-create" onClick={onCreate}>Tạo đóng gói sẵn</button>}
    </header>
    <div className="prepack-inventory-filter">
      <label htmlFor="prepack-packer-filter">Nhân viên</label>
      <select id="prepack-packer-filter" value={filterPacker} onChange={event => { setFilterPacker(event.target.value); setFilterSku(''); }}>
        <option value="">Tất cả nhân viên</option>
        {packerOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {hasUnknownPacker && <option value="__unknown__">Chưa xác định</option>}
      </select>
      <label htmlFor="prepack-sku-filter">Sản phẩm</label>
      <select id="prepack-sku-filter" value={selectedSku} onChange={event => setFilterSku(event.target.value)}>
        <option value="">Tất cả sản phẩm</option>
        {skuOptions.map(value => <option key={value} value={value}>{labelForSku(value)} · {value}</option>)}
      </select>
    </div>
    <div className="prepack-inventory-summary">
      <div><span>Combo còn lại</span><strong>{number(comboCount)} combo</strong></div>
      <div><span>{selectedSku ? `Quy đổi theo SKU ${selectedSku}` : 'Sản phẩm đang có hàng'}</span><strong>{selectedSku ? `${number(quantity)} ${unitForSku(selectedSku)}` : `${number(skuOptions.length)} SKU`}</strong></div>
      <div><span>Số lô đóng sẵn</span><strong>{number(rows.length)} lô</strong></div>
    </div>
    {rows.length ? <div className="prepack-inventory-list">{rows.map(({ lot, remainingCombos, quantityPerCombo, quantity: componentQuantity }) =>
      <article className="prepack-inventory-card" key={lot.assignmentId}>
        <div className="prepack-inventory-card-heading">
          <div><strong>{lot.code}</strong><small>{lot.workDate.split('-').reverse().join('/')}</small></div>
          <Tag color={lot.status === 'ready' ? 'green' : lot.status === 'issued' ? 'default' : 'orange'}>{statusLabels[lot.status] || lot.status}</Tag>
        </div>
        <div className="prepack-inventory-card-quantity"><strong>{number(remainingCombos)} combo</strong>{selectedSku && <span>= {number(componentQuantity)} {unitForSku(selectedSku)}</span>}</div>
        <small>{lot.packerName || lot.packerUsername ? `Nhân viên: ${lot.packerName || lot.packerUsername} · ` : 'Nhân viên: Chưa xác định · '}{selectedSku ? `${number(quantityPerCombo)} ${unitForSku(selectedSku)}/combo · ` : 'Thành phần · '}{lot.components.map(component => `${number(component.quantity)} ${labelForSku(component.sku)}`).join(' + ')}</small>
      </article>,
    )}</div> : <div className="prepack-inventory-empty">Hiện chưa có combo đóng sẵn còn lại trong kho.</div>}
    <p className="prepack-inventory-note">Số lượng này đã chuyển từ kiện sang combo và vẫn nằm trong tổng tồn SKU. Tab này không phụ thuộc ngày làm việc hay danh sách giao việc.</p>
  </section>;
}
