import { Alert, Button, Checkbox, Empty, Input, Modal, Radio, Space, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";

export type ShiftScopeProduct = { productId: number; name: string; openedCount: number };
type Props = {
  open: boolean;
  products: readonly ShiftScopeProduct[];
  selectedIds: readonly number[] | null;
  updatedBy?: string;
  updatedAt?: string;
  onClose: () => void;
  onSaved: () => void;
};
const searchText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi-VN");

// Admin-only: choose which products the end-of-shift count (and its fines) covers.
export default function HandlingUnitShiftScopeModal(props: Props) {
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [checked, setChecked] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setMode(props.selectedIds ? "selected" : "all");
    setChecked(props.selectedIds ? [...props.selectedIds] : []);
    setSearch("");
  }, [props.open, props.selectedIds]);
  const visible = useMemo(() => {
    const term = searchText(search).trim();
    return props.products.filter(product => !term || searchText(product.name).includes(term));
  }, [props.products, search]);
  const checkedSet = new Set(checked);
  const toggle = (productId: number, on: boolean) =>
    setChecked(previous => on ? [...new Set([...previous, productId])] : previous.filter(id => id !== productId));
  const save = async () => {
    if (mode === "selected" && checked.length === 0) { message.warning("Hãy tick ít nhất một sản phẩm cần kiểm."); return; }
    setSaving(true);
    try {
      const response = await window.electronAPI?.handlingUnits?.setShiftCheckScope({ productIds: mode === "all" ? null : checked });
      if (!response?.success) throw new Error(response?.error || "Không lưu được danh sách sản phẩm cần kiểm.");
      message.success(mode === "all" ? "Kiểm cuối ca áp dụng cho toàn bộ sản phẩm." : `Kiểm cuối ca chỉ áp dụng cho ${checked.length} sản phẩm đã chọn.`);
      props.onSaved();
      props.onClose();
    } catch (error: any) {
      message.error(error?.message || "Không lưu được danh sách sản phẩm cần kiểm.");
    } finally {
      setSaving(false);
    }
  };
  return <Modal open={props.open} title="Sản phẩm cần kiểm cuối ca" onCancel={() => !saving && props.onClose()}
    onOk={save} okText="Lưu" cancelText="Huỷ" confirmLoading={saving} width={560} destroyOnHidden>
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Radio.Group value={mode} onChange={event => setMode(event.target.value)} disabled={saving}>
        <Radio value="all">Kiểm toàn bộ sản phẩm</Radio>
        <Radio value="selected">Chỉ kiểm sản phẩm được tick</Radio>
      </Radio.Group>
      <Alert type="info" showIcon title="Sản phẩm không được tick sẽ không hiện trong Kiểm cuối ca và không tính phạt từ thời điểm lưu. Các ca đã qua hạn giữ nguyên." />
      {mode === "selected" && <>
        <Input allowClear placeholder="Tìm sản phẩm..." value={search} onChange={event => setSearch(event.target.value)} disabled={saving} />
        <Space size={8}>
          <Button size="small" disabled={saving} onClick={() => setChecked(previous => [...new Set([...previous, ...visible.map(product => product.productId)])])}>Tick tất cả đang hiện</Button>
          <Button size="small" disabled={saving} onClick={() => setChecked(previous => previous.filter(id => !visible.some(product => product.productId === id)))}>Bỏ tick đang hiện</Button>
          <span>Đã chọn <b>{checked.length}</b>/{props.products.length}</span>
        </Space>
        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #f0f0f0", borderRadius: 8, padding: "4px 12px" }}>
          {visible.length === 0 && <Empty description="Không có sản phẩm phù hợp" />}
          {visible.map(product => <div key={product.productId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
            <Checkbox checked={checkedSet.has(product.productId)} disabled={saving} onChange={event => toggle(product.productId, event.target.checked)}>{product.name}</Checkbox>
            {product.openedCount > 0 && <Tag color="blue">{product.openedCount} kiện đang khui</Tag>}
          </div>)}
        </div>
      </>}
      {props.updatedAt && <small style={{ color: "#8c8c8c" }}>Cập nhật lần cuối bởi {props.updatedBy || "admin"} lúc {new Date(props.updatedAt).toLocaleString("vi-VN")}</small>}
    </Space>
  </Modal>;
}
