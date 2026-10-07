import { Alert, AutoComplete, Button, Empty, Input, InputNumber, Select, Space, Tag } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { ShiftIdentity } from "../lib/handlingUnitShiftScope";

type Unit = { id: string; skuName: string; currentPcs: number; initialPcs: number; unitName: string; status: string; packageType: string; location?: {zone?: string; rack?: string} };
export type ShiftChecklistItem = ShiftIdentity & { unit: Unit; withdrawalCount: number; withdrawnQuantity: number; lastWithdrawalAt: number; packed?: boolean };
export type ShiftDraft = { actualQuantity: number | null; reason: string; note: string };
type Props = {
  items: readonly ShiftChecklistItem[];
  drafts: Record<string, ShiftDraft>;
  family: string;
  colors: Array<{sku: string; label: string}>;
  colorSku: string;
  entered: number;
  total: number;
  remaining: number;
  date: string;
  reasons: string[];
  single: boolean;
  busy: boolean;
  onColor: (sku: string) => void;
  onDraft: (code: string, patch: Partial<ShiftDraft>) => void;
};
const fmt = (n: number) => n.toLocaleString("vi-VN");
const searchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi-VN");

export function ShiftFamilySearch({ families, busy, onFamily }: { families: string[]; busy: boolean; onFamily: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [filterOnTyping, setFilterOnTyping] = useState(false);
  const query = filterOnTyping ? searchText(search).trim() : "";
  const matches = families.filter(family => !query || searchText(family).includes(query));
  const showFamilies = () => { if (!busy) { setFilterOnTyping(false); setOpen(true); } };
  const selectFamily = (value: string) => { onFamily(value); setSearch(value.replace(/^khẩu trang\s*/i, "")); setFilterOnTyping(false); setOpen(false); };
  const submit = (value: string) => {
    const term = searchText(value).trim();
    const searchMatches = families.filter(family => searchText(family).includes(term));
    const exact = families.find(family => searchText(family) === term || searchText(family.replace(/^khẩu trang\s*/i, "")) === term);
    if (exact) selectFamily(exact);
    else if (term && searchMatches.length === 1) selectFamily(searchMatches[0]);
    else { setFilterOnTyping(Boolean(term)); setOpen(true); }
  };
  return <div className="hu-shift-family-search">
    <Space.Compact block>
    <AutoComplete value={search} open={open} disabled={busy}
      onOpenChange={nextOpen => { if (!nextOpen) setOpen(false); }}
      onChange={value => { setSearch(value); setFilterOnTyping(true); setOpen(true); }}
      onSelect={selectFamily} onFocus={showFamilies}
      options={matches.map(value => ({value, label: value.replace(/^khẩu trang\s*/i, "")}))}
      notFoundContent="Không có dòng sản phẩm cần kiểm phù hợp" popupMatchSelectWidth={true}>
      <Input aria-label="Tìm dòng sản phẩm cần kiểm" placeholder="Tìm 5D Thịnh Phát, 3D Monji..." allowClear
        onClick={showFamilies}
        onKeyDownCapture={event => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          submit(search);
        }} />
    </AutoComplete>
    <Button type="primary" disabled={busy} onClick={() => submit(search)}>Tìm kiếm</Button>
    </Space.Compact>
  </div>;
}

export default function HandlingUnitShiftChecklist(props: Props) {
  const visibleItems = props.items;
  return <div className="hu-shift-workspace">
    {!props.single && <div className="hu-shift-toolbar">
      <span className="hu-shift-current-family">Dòng sản phẩm <b>{props.family.replace(/^khẩu trang\s*/i, "")}</b></span>
      <div className="hu-shift-color-filters" role="group" aria-label="Lọc màu trong dòng sản phẩm">
        {[{sku: "all", label: "Tất cả"}, ...props.colors].map(color => <button type="button" key={color.sku}
          disabled={props.busy} aria-pressed={props.colorSku === color.sku} onClick={() => props.onColor(color.sku)}>{color.label}</button>)}
      </div>
      <span className="hu-shift-progress">{props.date} · Đã nhập <b>{props.entered}/{props.total}</b></span>
    </div>}
    <Alert type="info" showIcon title="Nhập số lượng đếm thực tế theo từng kiện"
      description={`${props.single ? "Kiểm lại đúng kiện được chọn." : "Chỉ kiểm kiện đang khui hoặc chờ kiểm chốt."} Số kiện theo từng màu khớp với danh sách bên ngoài; mã kiện giúp xác định đúng kiện. Số đếm để trống đến khi bạn đếm xong.`} />
    {!props.single && <p className="hu-shift-scope-note">Đang xem {visibleItems.length}/{props.total} kiện của {props.family.replace(/^khẩu trang\s*/i, "")}. Hoàn tất kiểm sẽ lưu tất cả màu của dòng này; chuyển màu để nhập những kiện còn lại.</p>}
    {props.remaining > 0 && <Alert type="warning" showIcon title={`Đợt này kiểm ${props.total} kiện. Còn ${props.remaining} kiện; hoàn tất rồi mở Kiểm cuối ca để kiểm tiếp.`} />}
    <div className="hu-shift-checklist" aria-label="Các kiện cần kiểm">
      {visibleItems.length === 0 && <Empty description="Màu này không có kiện đang khui hoặc chờ kiểm cần đối chiếu" />}
      {visibleItems.map(item => {
        const {unit} = item;
        const draft = props.drafts[unit.id];
        const actual = draft?.actualQuantity;
        const entered = actual != null;
        const variance = entered ? actual - unit.currentPcs : null;
        const difference = variance != null && variance !== 0;
        const pending = ["Chờ kiểm", "pending_check"].includes(unit.status);
        const identity = `Kiện ${item.packageNumber ? String(item.packageNumber).padStart(2, "0") : unit.id} · ${item.color || unit.skuName}`;
        return <article className="hu-shift-check-row" key={unit.id} aria-label={`${identity} · ${item.displayName}`}>
          <div className="hu-shift-package-number"><small>Kiện</small><strong>{item.packageNumber ? String(item.packageNumber).padStart(2, "0") : "—"}</strong></div>
          <div className="hu-shift-package-identity">
            <h3>{item.displayName || unit.skuName}</h3>
            <div className="hu-shift-identity-tags"><Tag color="green">{identity}</Tag><Tag color={pending ? "orange" : "blue"}>{pending ? "Chờ kiểm chốt" : ["sealed", "Nguyên niêm phong"].includes(unit.status) ? "Nguyên niêm phong" : "Đang khui"}</Tag></div>
            <p>Mã kiện: <b>{unit.id}</b></p>
            <small>{unit.skuName} · {unit.packageType} · <EnvironmentOutlined /> {unit.location?.zone || "Chưa phân khu"}{unit.location?.rack ? ` / ${unit.location.rack}` : ""}</small>
            <small className="hu-shift-movement">{item.withdrawalCount > 0 ? `Đã lấy ${fmt(item.withdrawnQuantity)} ${unit.unitName} · ${item.withdrawalCount} lần` : "Không phát sinh lấy hàng mới"}</small>
          </div>
          <div className="hu-shift-expected"><span>Tồn dự kiến</span><strong>{fmt(unit.currentPcs)}</strong><small>{unit.unitName}</small></div>
          <label className="hu-shift-actual">Đếm thực tế<InputNumber aria-label={`Đếm thực tế ${identity}`} disabled={props.busy} min={0} max={unit.initialPcs} precision={0}
            placeholder="Nhập số đếm" value={actual} addonAfter={unit.unitName}
            onChange={value => props.onDraft(unit.id, {actualQuantity: value, ...(value === unit.currentPcs ? {reason: "", note: ""} : {})})} /></label>
          <div className="hu-shift-variance"><span>Chênh lệch</span><Tag color={variance == null ? undefined : variance === 0 ? "green" : "red"}>{variance == null ? "Chưa nhập" : variance === 0 ? "Khớp" : `${variance > 0 ? "+" : ""}${fmt(variance)}`}</Tag></div>
          <div className="hu-shift-reason">
            <label>Lý do chênh lệch<Select aria-label={`Lý do ${identity}`} disabled={props.busy || !difference} allowClear value={draft?.reason || undefined}
              placeholder={!entered ? "Chưa nhập số đếm" : difference ? "Chọn lý do" : "Không cần"} options={props.reasons.map(value => ({value, label: value}))}
              onChange={value => props.onDraft(unit.id, {reason: value || ""})} /></label>
            <label>Ghi chú{draft?.reason === "Khác" ? " (bắt buộc)" : " (tuỳ chọn)"}<Input aria-label={`Ghi chú ${identity}`} disabled={props.busy || !difference} allowClear
              value={draft?.note || ""} placeholder="Ghi chú thêm" onChange={event => props.onDraft(unit.id, {note: event.target.value})} /></label>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
