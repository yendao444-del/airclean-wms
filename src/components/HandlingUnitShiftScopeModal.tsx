import { Alert, Button, Checkbox, Empty, Input, InputNumber, Modal, Radio, Space, Tag, Tooltip, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PackedComboCheckSettings } from "../types/packagePacking";

export type ShiftScopeProduct = { productId: number; name: string; openedCount: number; packageSize?: number };
export type ShiftCheckThreshold = { percent: number; updatedBy?: string; effectiveAt?: string };
export type ShiftCheckMode = "morning" | "afternoon" | "both";
type Props = {
  open: boolean;
  canEditPolicy: boolean;
  canEditAdminSettings: boolean;
  thresholds?: Record<string, ShiftCheckThreshold>;
  minThreshold?: number;
  products: readonly ShiftScopeProduct[];
  selectedIds: readonly number[] | null;
  shiftMode?: ShiftCheckMode;
  fineAmount?: number;
  updatedBy?: string;
  updatedAt?: string;
  /** Daily pre-packed combo count: opening time, deadline and fine (0 = no fine yet). */
  comboCheckSettings?: PackedComboCheckSettings & { updatedBy?: string; effectiveAt?: string };
  onClose: () => void;
  onSaved: () => void;
};
const searchText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi-VN");

function ThresholdInput({ product, current, min, onSaved }: { product: ShiftScopeProduct; current?: ShiftCheckThreshold; min: number; onSaved: () => void }) {
  const savedPercent = useRef<number | null>(current?.percent ?? null);
  const [percent, setPercent] = useState<number | null>(current?.percent ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    savedPercent.current = current?.percent ?? null;
    setPercent(current?.percent ?? null);
  }, [current?.percent]);
  // Saves when the field loses focus or on Enter. There is no "no level" API, so blank restores.
  const commit = async () => {
    if (percent === null || percent === savedPercent.current) { setPercent(savedPercent.current); return; }
    if (percent < min || percent > 100) {
      message.warning(`${product.name}: mức cần kiểm phải từ ${min}% đến 100%.`);
      setPercent(savedPercent.current);
      return;
    }
    setSaving(true);
    try {
      const response = await window.electronAPI?.handlingUnits?.setShiftCheckThreshold({ productId: product.productId, percent });
      if (!response?.success) throw new Error(response?.error || "Không lưu được mức cần kiểm.");
      savedPercent.current = percent;
      message.success(`${product.name}: kiểm khi kiện còn ≤ ${percent}%.`);
      onSaved();
    } catch (error: any) {
      setPercent(savedPercent.current);
      message.error(error?.message || "Không lưu được mức cần kiểm.");
    } finally {
      setSaving(false);
    }
  };
  const hint = [
    product.packageSize && percent !== null
      ? `Kiện ${product.packageSize.toLocaleString("vi-VN")} gói → kiểm khi còn ≤ ${Math.floor(product.packageSize * percent / 100).toLocaleString("vi-VN")} gói`
      : "Mức cần kiểm, tính theo sức chứa của từng kiện",
    current?.updatedBy ? `Đổi bởi ${current.updatedBy}${current.effectiveAt ? ` lúc ${new Date(current.effectiveAt).toLocaleString("vi-VN")}` : ""}` : "",
  ].filter(Boolean).join(". ");
  return <Tooltip title={hint}>
    <InputNumber<number> aria-label={`Mức cần kiểm ${product.name}`} className="hu-shift-level-input" size="small" controls={false} placeholder="Mức"
      value={percent} precision={0} suffix="%" disabled={saving} onChange={value => setPercent(value)}
      onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onBlur={() => void commit()} />
  </Tooltip>;
}

// Admin or a named staff editor chooses which products the end-of-shift count
// (and its fines) covers. Other staff only see the per-product level inputs.
export default function HandlingUnitShiftScopeModal(props: Props) {
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [shiftMode, setShiftMode] = useState<ShiftCheckMode>("both");
  const [fineAmount, setFineAmount] = useState<number | null>(null);
  const [minThreshold, setMinThreshold] = useState<number | null>(null);
  const [comboOpensAt, setComboOpensAt] = useState("17:00");
  const [comboDeadline, setComboDeadline] = useState("20:00");
  const [comboFine, setComboFine] = useState<number | null>(0);
  // Compare by content: applying a level reloads the workspace and must not
  // throw away ticks the admin has not saved yet.
  const selectedKey = JSON.stringify(props.selectedIds);
  const [checked, setChecked] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setMode(props.selectedIds ? "selected" : "all");
    setShiftMode(props.shiftMode || "both");
    setFineAmount(props.fineAmount ?? null);
    setMinThreshold(props.minThreshold ?? 10);
    setComboOpensAt(props.comboCheckSettings?.opensAt || "17:00");
    setComboDeadline(props.comboCheckSettings?.deadline || "20:00");
    setComboFine(props.comboCheckSettings?.fineAmount ?? 0);
    setChecked(props.selectedIds ? [...props.selectedIds] : []);
    setSearch("");
  }, [props.open, selectedKey, props.shiftMode, props.fineAmount, props.minThreshold, props.comboCheckSettings?.opensAt, props.comboCheckSettings?.deadline, props.comboCheckSettings?.fineAmount]);
  const visible = useMemo(() => {
    const term = searchText(search).trim();
    // Staff set levels only for products that are actually being counted.
    const scoped = !props.canEditPolicy && props.selectedIds
      ? props.products.filter(product => props.selectedIds?.includes(product.productId)) : props.products;
    return scoped.filter(product => !term || searchText(product.name).includes(term));
  }, [props.products, props.canEditPolicy, props.selectedIds, search]);
  const checkedSet = new Set(checked);
  // Saved ticks of hidden SKUs stay in the policy so a SKU that returns is still counted.
  const listedCheckedCount = props.products.filter(product => checkedSet.has(product.productId)).length;
  const toggle = (productId: number, on: boolean) =>
    setChecked(previous => on ? [...new Set([...previous, productId])] : previous.filter(id => id !== productId));
  const save = async () => {
    if (mode === "selected" && listedCheckedCount === 0) { message.warning("Hãy tick ít nhất một sản phẩm cần kiểm."); return; }
    if (props.canEditAdminSettings && fineAmount === null) { message.warning("Hãy nhập mức phạt mỗi ca."); return; }
    if (props.canEditAdminSettings && minThreshold === null) { message.warning("Hãy nhập mức tối thiểu."); return; }
    const comboChanged = props.canEditAdminSettings && (comboOpensAt !== (props.comboCheckSettings?.opensAt || "17:00")
      || comboDeadline !== (props.comboCheckSettings?.deadline || "20:00") || (comboFine ?? 0) !== (props.comboCheckSettings?.fineAmount ?? 0));
    if (comboChanged && (!comboOpensAt || !comboDeadline || comboDeadline <= comboOpensAt)) { message.warning("Hạn nộp kiểm combo phải sau giờ mở."); return; }
    setSaving(true);
    try {
      if (comboChanged) {
        const comboResponse = await window.electronAPI?.packedComboCheck?.saveConfig({ opensAt: comboOpensAt, deadline: comboDeadline, fineAmount: comboFine ?? 0 });
        if (!comboResponse?.success) throw new Error(comboResponse?.error || "Không lưu được cài đặt kiểm combo.");
      }
      const response = await window.electronAPI?.handlingUnits?.setShiftCheckScope({ productIds: mode === "all" ? null : checked, shiftMode, ...(props.canEditAdminSettings ? { fineAmount: fineAmount ?? undefined, minThresholdPercent: minThreshold ?? undefined } : {}) });
      if (!response?.success) throw new Error(response?.error || "Không lưu được danh sách sản phẩm cần kiểm.");
      message.success(`Đã lưu: ${shiftMode === "morning" ? "kiểm buổi sáng" : shiftMode === "afternoon" ? "kiểm buổi chiều" : "kiểm cả buổi sáng và buổi chiều"}.`);
      props.onSaved();
      props.onClose();
    } catch (error: any) {
      message.error(error?.message || "Không lưu được danh sách sản phẩm cần kiểm.");
    } finally {
      setSaving(false);
    }
  };
  const levelMin = props.canEditAdminSettings ? 1 : props.minThreshold ?? 10;
  return <Modal open={props.open} title={props.canEditPolicy ? "Cài đặt kiểm cuối ca" : "Cài đặt mức cần kiểm"} onCancel={() => !saving && props.onClose()}
    onOk={save} okText="Lưu" cancelText="Huỷ" confirmLoading={saving} width={560} destroyOnHidden
    footer={props.canEditPolicy ? undefined : <Button onClick={props.onClose}>Đóng</Button>}
    wrapClassName="hu-shift-scope-wrap" className="hu-shift-scope-modal">
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {props.canEditPolicy && <>
      <div>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Buổi cần kiểm</div>
        <Radio.Group value={shiftMode} onChange={event => setShiftMode(event.target.value)} disabled={saving}>
          <Space direction="vertical" size={4}>
            <Radio value="morning">Buổi sáng (hạn 12:30)</Radio>
            <Radio value="afternoon">Buổi chiều (hạn 20:00)</Radio>
            <Radio value="both">Cả buổi sáng và buổi chiều</Radio>
          </Space>
        </Radio.Group>
      </div>
      {props.canEditAdminSettings && <>
      <div>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Mức phạt mỗi ca</div>
        <InputNumber<number> aria-label="Mức phạt mỗi ca" style={{ width: 200 }} value={fineAmount} disabled={saving}
          min={1000} max={10000000} step={10000} precision={0} suffix="đ"
          formatter={value => value === undefined || value === null ? "" : Number(value).toLocaleString("vi-VN")}
          parser={value => Number((value || "").replace(/\D/g, ""))}
          onChange={value => setFineAmount(value)} />
      </div>
      <div>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Mức thấp nhất nhân viên được đặt</div>
        <InputNumber<number> aria-label="Mức thấp nhất nhân viên được đặt" style={{ width: 200 }} value={minThreshold} disabled={saving}
          min={1} max={100} precision={0} suffix="%" onChange={value => setMinThreshold(value)} />
      </div>
      <div className="hu-combo-check-settings">
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Kiểm combo đóng gói sẵn</div>
        <Space size={12} wrap>
          <label>Giờ mở <Input aria-label="Giờ mở kiểm combo" type="time" style={{ width: 120 }} value={comboOpensAt} disabled={saving} onChange={event => setComboOpensAt(event.target.value)} /></label>
          <label>Hạn nộp <Input aria-label="Hạn nộp kiểm combo" type="time" style={{ width: 120 }} value={comboDeadline} disabled={saving} onChange={event => setComboDeadline(event.target.value)} /></label>
          <label>Phạt trễ hạn <InputNumber<number> aria-label="Mức phạt trễ kiểm combo" style={{ width: 160 }} value={comboFine} disabled={saving}
            min={0} max={10000000} step={10000} precision={0} suffix="đ"
            formatter={value => value === undefined || value === null ? "" : Number(value).toLocaleString("vi-VN")}
            parser={value => Number((value || "").replace(/\D/g, ""))}
            onChange={value => setComboFine(value)} /></label>
        </Space>
        <small style={{ display: "block", marginTop: 4, color: "#8c8c8c" }}>0đ = chưa phạt, chỉ ghi nhận trễ hạn. Mức mới áp dụng từ lúc lưu.</small>
      </div>
      </>}
      <Radio.Group value={mode} onChange={event => setMode(event.target.value)} disabled={saving}>
        <Radio value="all">Kiểm toàn bộ sản phẩm</Radio>
        <Radio value="selected">Chỉ kiểm sản phẩm được tick</Radio>
      </Radio.Group>
      <Alert type="info" showIcon title="Sản phẩm không được tick sẽ không hiện trong Kiểm cuối ca và không tính phạt từ thời điểm lưu. Mức phạt mới áp dụng cho các hạn kiểm sau khi lưu; các ca đã qua hạn giữ nguyên." />
      </>}
      {!props.canEditPolicy && <Alert type="info" showIcon title="Sản phẩm đã đặt mức chỉ phải kiểm khi kiện xuống tới mức đó; kiện chờ chốt hết kiện vẫn luôn phải kiểm. Mọi lần đổi mức đều được ghi lại." />}
      <>
        <Input allowClear placeholder="Tìm sản phẩm..." value={search} onChange={event => setSearch(event.target.value)} disabled={saving} />
        {props.canEditPolicy && mode === "selected" && <Space size={8}>
          <Button size="small" disabled={saving} onClick={() => setChecked(previous => [...new Set([...previous, ...visible.map(product => product.productId)])])}>Tick tất cả đang hiện</Button>
          <Button size="small" disabled={saving} onClick={() => setChecked(previous => previous.filter(id => !visible.some(product => product.productId === id)))}>Bỏ tick đang hiện</Button>
          <span>Đã chọn <b>{listedCheckedCount}</b>/{props.products.length}</span>
        </Space>}
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: "4px 12px" }}>
          {visible.length === 0 && <Empty description="Không có sản phẩm phù hợp" />}
          {visible.map(product => <div key={product.productId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {props.canEditPolicy && mode === "selected"
                ? <Checkbox checked={checkedSet.has(product.productId)} disabled={saving} onChange={event => toggle(product.productId, event.target.checked)}>{product.name}</Checkbox>
                : product.name}
            </div>
            {product.openedCount > 0 && <Tag color="blue" style={{ marginInlineEnd: 0 }}>{product.openedCount} kiện đang khui</Tag>}
            <ThresholdInput product={product} current={props.thresholds?.[product.productId]} min={levelMin} onSaved={props.onSaved} />
          </div>)}
        </div>
      </>
      {props.updatedAt && <small style={{ color: "#8c8c8c" }}>Cập nhật lần cuối bởi {props.updatedBy || "admin"} lúc {new Date(props.updatedAt).toLocaleString("vi-VN")}</small>}
    </Space>
  </Modal>;
}
