import { useMemo, useState } from "react";
import {
  ArrowCounterClockwise, ArrowLeft, BoxArrowDown, CaretLeft, CaretRight,
  Check, CheckCircle, ClipboardText, ClockCounterClockwise, Cube, Database,
  LockKey, MagnifyingGlass, Package, PaperPlaneTilt, ShieldCheck, Sparkle,
  WarningCircle, Warehouse,
} from "@phosphor-icons/react";

const fmt = (value) => Number(value || 0).toLocaleString("vi-VN");
const now = () => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date());

const scenarios = {
  standard: {
    label: "Luồng bán hết kiện",
    description: "Rút hết màu Trắng, kiểm thực tế rồi khui kiện FIFO tiếp theo.",
    units: [
      ["KN-DUNI-07", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 40, 1000, "opened", 1],
      ["KN-DUNI-08", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 1200, 1200, "sealed", 2],
      ["KN-DUNI-09", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 1200, 1200, "sealed", 3],
      ["KN-DUNI-03", "5D UNICARE", "1-5DUNI-DEN", "Đen", 125, 1200, "opened", 1],
      ["KN-DUNI-05", "5D UNICARE", "1-5DUNI-BE", "Be", 869, 1200, "opened", 1],
      ["KN-PFHO-04", "UNICARE UPF UV", "1-UPF-HONG", "Hồng", 33, 500, "opened", 1],
      ["KN-PFDE-10", "UNICARE UPF UV", "1-UPF-DEN", "Đen", 420, 500, "opened", 1],
      ["KN-INIE-05", "Túi Niêm Phong", "TUI-NIEM-PHONG-SIZE25X35", "Size 25×35", 17, 25, "opened", 1],
    ],
  },
  pending: {
    label: "Đang chờ kiểm",
    description: "Một kiện tồn 0 khóa phân loại cho tới khi kiểm thực tế.",
    units: [
      ["KN-DUNI-01", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 0, 1000, "pending", 1],
      ["KN-DUNI-08", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 1200, 1200, "sealed", 2],
      ["KN-DUNI-09", "5D UNICARE", "1-5DUNI-TRANG", "Trắng", 1200, 1200, "sealed", 3],
      ["KN-DUNI-03", "5D UNICARE", "1-5DUNI-DEN", "Đen", 125, 1200, "opened", 1],
      ["KN-DUNI-05", "5D UNICARE", "1-5DUNI-BE", "Be", 869, 1200, "opened", 1],
      ["KN-PFHO-04", "UNICARE UPF UV", "1-UPF-HONG", "Hồng", 33, 500, "opened", 1],
    ],
  },
  large: {
    label: "Kho nhiều kiện",
    description: "30 kiện kín để thử danh mục cha và phân trang FIFO.",
    units: [
      ...["Trắng", "Đen", "Be", "Hồng", "Xám", "Xanh"].flatMap((variant, variantIndex) =>
        Array.from({ length: 5 }, (_, index) => [
          `KN-5D-${String(variantIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
          "5D UNICARE", `1-5DUNI-${variant.toUpperCase()}`, variant, 1200, 1200, "sealed", variantIndex * 10 + index,
        ]),
      ),
      ["KN-PFDE-10", "UNICARE UPF UV", "1-UPF-DEN", "Đen", 42, 500, "opened", 1],
    ],
  },
};

const hydrate = (row) => ({
  code: row[0], product: row[1], sku: row[2], variant: row[3], quantity: row[4],
  initial: row[5], status: row[6], createdAt: row[7],
});
const cloneUnits = (key) => scenarios[key].units.map((row) => hydrate(row));
const statusLabel = (status) => ({ opened: "Đang mở", sealed: "Niêm phong", pending: "Chờ kiểm", empty: "Đã hết" }[status]);
const previewParams = new URLSearchParams(window.location.search);
const initialScenarioKey = scenarios[previewParams.get("scenario")] ? previewParams.get("scenario") : "standard";
const initialScreen = previewParams.get("view") === "blocked"
  ? { name: "blocked", product: "5D UNICARE", sku: "1-5DUNI-TRANG", unitCode: "KN-DUNI-01" }
  : { name: "products" };

function ActionButton({ icon: Icon, children, onClick, tone = "default", disabled = false }) {
  return <button className={`tg-action tg-action--${tone}`} onClick={onClick} disabled={disabled}>{Icon && <Icon size={17} weight="bold" />}<span>{children}</span></button>;
}

function BotMessage({ title, children, actions = [], tone = "default" }) {
  return <div className={`message-row message-row--bot message-row--${tone}`}><div className="bot-avatar">Q</div><div className="message-stack"><article className="message-bubble bot-bubble"><div className="bot-name">quanlykienhang</div>{title && <h3>{title}</h3>}<div className="message-copy">{children}</div><time>{now()}</time></article>{actions.length > 0 && <div className="action-grid">{actions}</div>}</div></div>;
}

function UserMessage({ children }) {
  return <div className="message-row message-row--user"><article className="message-bubble user-bubble"><div>{children}</div><time>{now()} <Check size={13} weight="bold" /></time></article></div>;
}

export function App() {
  const [scenarioKey, setScenarioKey] = useState(initialScenarioKey);
  const [units, setUnits] = useState(() => cloneUnits(initialScenarioKey));
  const [screen, setScreen] = useState(initialScreen);
  const [events, setEvents] = useState([{ label: "Khởi tạo", detail: scenarios[initialScenarioKey].label, tone: "info" }]);
  const [lastCallback, setLastCallback] = useState("menu_rut");
  const [checkValue, setCheckValue] = useState("0");
  const [customValue, setCustomValue] = useState("");
  const [page, setPage] = useState(0);

  const activeUnits = useMemo(() => units.filter((unit) => unit.status !== "empty"), [units]);
  const products = useMemo(() => [...new Set(activeUnits.map((unit) => unit.product))], [activeUnits]);
  const addEvent = (label, detail, tone = "info") => setEvents((current) => [{ label, detail, tone }, ...current].slice(0, 16));
  const go = (next, callback) => { setLastCallback(callback); setScreen(next); };
  const reset = (key = scenarioKey) => {
    setScenarioKey(key); setUnits(cloneUnits(key)); setScreen({ name: "products" });
    setEvents([{ label: "Reset dữ liệu", detail: scenarios[key].label, tone: "info" }]);
    setLastCallback("menu_rut"); setCheckValue("0"); setCustomValue(""); setPage(0);
  };

  const variantsFor = (product) => {
    const groups = new Map();
    activeUnits.filter((unit) => unit.product === product).forEach((unit) => {
      if (!groups.has(unit.sku)) groups.set(unit.sku, []);
      groups.get(unit.sku).push(unit);
    });
    return [...groups.entries()].map(([sku, grouped]) => ({ sku, variant: grouped[0].variant, units: grouped }));
  };
  const skuUnits = (sku) => units.filter((unit) => unit.sku === sku);

  const openVariant = (product, sku) => {
    const grouped = skuUnits(sku);
    const variant = grouped[0]?.variant || "";
    setLastCallback(`rut_variant:${sku}`);
    setPage(0);
    setScreen({ name: "packages", product, sku, variant });
  };

  const selectPackage = (unit) => {
    setLastCallback(`select_unit:${unit.code}`);
    if (unit.status === "pending") {
      return setScreen({ name: "blocked", product: unit.product, sku: unit.sku, unitCode: unit.code });
    }
    if (unit.status === "opened") {
      const pending = units.find((item) => item.sku === unit.sku && item.status === "pending");
      if (pending) {
        return setScreen({ name: "blocked", product: unit.product, sku: unit.sku, unitCode: pending.code });
      }
      return setScreen({ name: "pick", product: unit.product, sku: unit.sku, unitCode: unit.code });
    }
    if (unit.status === "sealed") {
      const pending = units.find((item) => item.sku === unit.sku && item.status === "pending");
      if (pending) {
        return setScreen({ name: "blocked", product: unit.product, sku: unit.sku, unitCode: pending.code });
      }
      const opened = units.find((item) => item.sku === unit.sku && item.status === "opened");
      if (opened) {
        return setScreen({
          name: "sealedBlocked",
          product: unit.product,
          sku: unit.sku,
          unitCode: unit.code,
          openedCode: opened.code,
          openedQty: opened.quantity,
        });
      }
      return setScreen({ name: "suggest", product: unit.product, sku: unit.sku, unitCode: unit.code });
    }
  };

  const pick = (code, rawAmount) => {
    const amount = Math.floor(Number(rawAmount || 0));
    const target = units.find((unit) => unit.code === code);
    if (!target || amount < 1 || amount > target.quantity) return;
    const remaining = target.quantity - amount;
    setUnits((current) => current.map((unit) => unit.code === code ? { ...unit, quantity: remaining, status: remaining === 0 ? "pending" : "opened" } : unit));
    setLastCallback(`do_pick:${code}:${amount}`);
    addEvent("Rút hàng", `${code}: -${fmt(amount)} gói, còn ${fmt(remaining)}`, "success");
    setScreen({ name: "pickSuccess", product: target.product, sku: target.sku, unitCode: code, amount, remaining });
    setCustomValue("");
  };

  const finalizeCheck = (code) => {
    const actual = Math.max(0, Math.floor(Number(checkValue || 0)));
    const target = units.find((unit) => unit.code === code);
    if (!target) return;
    setUnits((current) => current.map((unit) => unit.code === code ? { ...unit, quantity: actual, status: actual === 0 ? "empty" : "opened" } : unit));
    setLastCallback(`final_check:${code}:${actual}`);
    addEvent("Kiểm thực tế", `${code}: ${fmt(actual)} gói`, actual === 0 ? "success" : "warning");
    if (actual > 0) return setScreen({ name: "checkMismatch", product: target.product, sku: target.sku, unitCode: code, actual });
    const suggested = units.filter((unit) => unit.sku === target.sku && unit.status === "sealed").sort((a, b) => a.createdAt - b.createdAt)[0];
    setScreen(suggested ? { name: "suggest", product: target.product, sku: target.sku, unitCode: suggested.code, checkedCode: code } : { name: "empty", product: target.product, sku: target.sku });
  };

  const unseal = (code) => {
    const target = units.find((unit) => unit.code === code);
    if (!target) return;
    setUnits((current) => current.map((unit) => unit.code === code ? { ...unit, status: "opened" } : unit));
    setLastCallback(`unseal_unit:${code}`); addEvent("Khui kiện", `${code} chuyển sang Đang mở`, "success");
    setScreen({ name: "unsealSuccess", product: target.product, sku: target.sku, unitCode: code });
  };

  const backToProduct = (product) => <ActionButton key="back-to-product" icon={ArrowLeft} tone="secondary" onClick={() => go({ name: "variants", product }, `rut_group:${product}`)}>Quay lại {product}</ActionButton>;

  const backToPackages = (product, sku, variant) => (
    <ActionButton
      key="back-to-packages"
      icon={ArrowLeft}
      tone="secondary"
      onClick={() => {
        setPage(0);
        go({ name: "packages", product, sku, variant }, `rut_variant:${sku}`);
      }}
    >
      Quay lại danh sách kiện
    </ActionButton>
  );

  const renderScreen = () => {
    if (screen.name === "products") return <><UserMessage>/rut@quanlykienhang_bot</UserMessage><BotMessage title={<><Warehouse size={19} weight="fill" /> CHỌN DÒNG SẢN PHẨM</>} actions={[
      ...products.map((product) => { const variants = variantsFor(product); const allLocked = variants.every((item) => item.units.some((unit) => unit.status === "pending")); return <ActionButton key={product} icon={allLocked ? LockKey : Package} onClick={() => go({ name: "variants", product }, `rut_group:${product}`)}>{product}<small>{variants.length} phân loại</small></ActionButton>; }),
      <ActionButton key="stock" icon={ClipboardText} tone="secondary" onClick={() => go({ name: "inventory" }, "menu_ton")}>Xem báo cáo tồn</ActionButton>,
    ]}>Chọn danh mục cha để xem các màu hoặc kích thước đang mở.</BotMessage></>;

    if (screen.name === "variants") return <BotMessage title={<><Package size={19} weight="fill" /> {screen.product}</>} actions={[
      ...variantsFor(screen.product).map(({ sku, variant, units: grouped }) => { const pending = grouped.find((unit) => unit.status === "pending"); const opened = grouped.find((unit) => unit.status === "opened"); const sealed = grouped.filter((unit) => unit.status === "sealed"); return <ActionButton key={sku} icon={pending ? LockKey : Cube} tone={pending ? "warning" : "default"} onClick={() => openVariant(screen.product, sku)}>{variant}<small>{grouped.length} kiện · {pending ? "Chờ kiểm" : opened ? `${fmt(opened.quantity)} gói mở` : `${sealed.length} kiện kín`}</small></ActionButton>; }),
      <ActionButton key="back" icon={ArrowLeft} tone="secondary" onClick={() => go({ name: "products" }, "menu_rut")}>Quay lại danh mục</ActionButton>,
    ]}>Chọn màu hoặc phân loại cần xem danh sách kiện hàng.</BotMessage>;

    if (screen.name === "packages") {
      const currentUnits = skuUnits(screen.sku);
      const variantName = screen.variant || currentUnits[0]?.variant || "";
      const sealedUnits = currentUnits.filter((u) => u.status === "sealed").sort((a, b) => a.createdAt - b.createdAt);
      const fifoUnit = sealedUnits[0];
      const pageSize = 5;
      const totalPages = Math.max(1, Math.ceil(currentUnits.length / pageSize));
      const safePage = Math.min(page, totalPages - 1);
      const visible = currentUnits.slice(safePage * pageSize, (safePage + 1) * pageSize);

      return (
        <BotMessage
          title={<><Package size={19} weight="fill" /> KIỆN HÀNG · {variantName.toUpperCase()}</>}
          actions={[
            ...visible.map((unit) => {
              const isPending = unit.status === "pending";
              const isOpened = unit.status === "opened";
              const isSealed = unit.status === "sealed";
              const isFifo = isSealed && fifoUnit && unit.code === fifoUnit.code;
              const icon = isPending ? LockKey : isOpened ? BoxArrowDown : isFifo ? Sparkle : Cube;
              const tone = isPending ? "warning" : isOpened ? "success" : "default";
              const badge = isPending
                ? "Chờ kiểm · 0 gói"
                : isOpened
                ? `Đang mở · ${fmt(unit.quantity)} gói`
                : `Niêm phong · ${fmt(unit.quantity)} gói${isFifo ? " · FIFO" : ""}`;

              return (
                <ActionButton
                  key={unit.code}
                  icon={icon}
                  tone={tone}
                  onClick={() => selectPackage(unit)}
                >
                  {unit.code}
                  <small>{badge}</small>
                </ActionButton>
              );
            }),
            totalPages > 1 && (
              <div className="pager" key="pager">
                <button disabled={safePage === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}><CaretLeft size={18} /></button>
                <span>{safePage + 1}/{totalPages}</span>
                <button disabled={safePage === totalPages - 1} onClick={() => setPage((v) => Math.min(totalPages - 1, v + 1))}><CaretRight size={18} /></button>
              </div>
            ),
            <ActionButton key="back-to-variants" icon={ArrowLeft} tone="secondary" onClick={() => go({ name: "variants", product: screen.product }, `rut_group:${screen.product}`)}>
              Quay lại chọn màu ({screen.product})
            </ActionButton>,
          ].filter(Boolean)}
        >
          Danh sách kiện hàng của màu <strong>{variantName}</strong> ({screen.product}). Chạm vào kiện để rút hàng hoặc kiểm tra trạng thái:
        </BotMessage>
      );
    }

    if (screen.name === "sealedBlocked") {
      const unit = units.find((item) => item.code === screen.unitCode);
      return (
        <BotMessage
          tone="warning"
          title={<><WarningCircle size={19} weight="fill" /> KIỆN ĐANG NIÊM PHONG</>}
          actions={[
            <ActionButton key="pick-opened" icon={BoxArrowDown} tone="success" onClick={() => go({ name: "pick", product: screen.product, sku: screen.sku, unitCode: screen.openedCode }, `pick_unit:${screen.openedCode}`)}>
              Rút từ kiện đang mở {screen.openedCode}
            </ActionButton>,
            backToPackages(screen.product, screen.sku, unit?.variant),
          ]}
        >
          Kiện <strong>{screen.unitCode}</strong> đang niêm phong ({fmt(unit?.quantity)} gói).
          <p>Phân loại này hiện đang có kiện <strong>{screen.openedCode}</strong> đang mở (còn {fmt(screen.openedQty)} gói). Theo quy tắc kho, bạn cần rút hết kiện đang mở trước khi khui kiện mới.</p>
        </BotMessage>
      );
    }

    if (screen.name === "blocked") { const unit = units.find((item) => item.code === screen.unitCode); return <BotMessage tone="danger" title={<><WarningCircle size={19} weight="fill" /> KHÔNG THỂ RÚT HÀNG</>} actions={[
      <ActionButton key="check" icon={ClipboardText} tone="warning" onClick={() => go({ ...screen, name: "check" }, `check_unit:${unit.code}`)}>Kiểm thực tế {unit.code}</ActionButton>,
      backToPackages(screen.product, screen.sku, unit?.variant),
    ]}>Chưa thể rút hàng. SKU <strong>{unit.sku}</strong> có kiện <strong>{unit.code}</strong> đang ở trạng thái Chờ kiểm, tồn theo sổ: 0 gói.</BotMessage>; }

    if (screen.name === "pick") { const unit = units.find((item) => item.code === screen.unitCode); const options = [10, 20, 40, 50].filter((value) => value <= unit.quantity); return <BotMessage title={<><BoxArrowDown size={19} weight="fill" /> RÚT HÀNG TỪ KIỆN</>} actions={[
      ...options.map((amount) => <ActionButton key={amount} icon={BoxArrowDown} onClick={() => pick(unit.code, amount)}>Rút {fmt(amount)} gói{amount === unit.quantity && <small>Hết kiện</small>}</ActionButton>),
      <div className="custom-action" key="custom"><input value={customValue} onChange={(event) => setCustomValue(event.target.value.replace(/\D/g, ""))} placeholder="Số lượng tùy chọn" inputMode="numeric" /><button onClick={() => pick(unit.code, customValue)} disabled={!customValue || Number(customValue) > unit.quantity}><PaperPlaneTilt size={18} weight="fill" /></button></div>,
      backToPackages(screen.product, screen.sku, unit.variant),
    ]}><dl className="message-facts"><div><dt>Mã kiện</dt><dd>{unit.code}</dd></div><div><dt>Phân loại</dt><dd>{unit.variant}</dd></div><div><dt>Tồn trong kiện</dt><dd>{fmt(unit.quantity)} gói</dd></div><div><dt>Vị trí</dt><dd>A1 · Kệ đóng gói</dd></div></dl></BotMessage>; }

    if (screen.name === "pickSuccess") { const unit = units.find((item) => item.code === screen.unitCode); return <BotMessage tone="success" title={<><CheckCircle size={19} weight="fill" /> RÚT HÀNG THÀNH CÔNG</>} actions={screen.remaining === 0 ? [
      <ActionButton key="check" icon={ClipboardText} tone="warning" onClick={() => go({ ...screen, name: "check" }, `check_unit:${unit.code}`)}>Kiểm thực tế để chốt kiện</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant),
    ] : [<ActionButton key="continue" icon={BoxArrowDown} onClick={() => go({ ...screen, name: "pick" }, `pick_unit:${unit.code}`)}>Rút tiếp từ kiện này</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant)]}>Đã rút <strong>{fmt(screen.amount)} gói</strong> từ {unit.code}. Còn lại <strong>{fmt(screen.remaining)} gói</strong>.{screen.remaining === 0 && <p className="inline-alert"><LockKey size={16} weight="fill" /> Kiện đã chuyển sang Chờ kiểm.</p>}</BotMessage>; }

    if (screen.name === "check") { const unit = units.find((item) => item.code === screen.unitCode); return <BotMessage title={<><ClipboardText size={19} weight="fill" /> KIỂM THỰC TẾ KIỆN</>} actions={[
      <div className="check-form" key="form"><label>Số lượng đếm thực tế</label><div><input value={checkValue} onChange={(event) => setCheckValue(event.target.value.replace(/\D/g, ""))} inputMode="numeric" /><span>gói</span></div></div>,
      <ActionButton key="confirm" icon={ShieldCheck} tone="success" onClick={() => finalizeCheck(unit.code)}>Xác nhận kết quả kiểm</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant),
    ]}>Kiện <strong>{unit.code}</strong> đang có tồn phần mềm bằng 0. Hãy nhập số lượng thực tế vừa đếm.</BotMessage>; }

    if (screen.name === "suggest") { const unit = units.find((item) => item.code === screen.unitCode); const alternatives = units.filter((item) => item.sku === unit.sku && item.status === "sealed").sort((a, b) => a.createdAt - b.createdAt); return <BotMessage tone="success" title={<><Sparkle size={19} weight="fill" /> KIỆN ĐƯỢC ĐỀ XUẤT</>} actions={[
      <ActionButton key="confirm" icon={CheckCircle} tone="success" onClick={() => unseal(unit.code)}>Xác nhận khui {unit.code}</ActionButton>,
      alternatives.length > 1 && <ActionButton key="others" icon={MagnifyingGlass} tone="secondary" onClick={() => { setPage(0); go({ ...screen, name: "sealedList" }, `khui_units:${unit.code}:0`); }}>Xem {alternatives.length - 1} kiện khác</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant),
    ].filter(Boolean)}>{screen.checkedCode && <p className="inline-success"><CheckCircle size={16} weight="fill" /> Đã chốt hết kiện {screen.checkedCode}.</p>}<dl className="message-facts"><div><dt>Mã kiện</dt><dd>{unit.code}</dd></div><div><dt>Phân loại</dt><dd>{unit.variant}</dd></div><div><dt>Số lượng</dt><dd>{fmt(unit.quantity)} gói</dd></div><div><dt>Nguyên tắc</dt><dd>FIFO · nhập trước</dd></div></dl></BotMessage>; }

    if (screen.name === "sealedList") { const anchor = units.find((item) => item.code === screen.unitCode); const alternatives = units.filter((item) => item.sku === anchor.sku && item.status === "sealed").sort((a, b) => a.createdAt - b.createdAt); const size = 5; const pages = Math.max(1, Math.ceil(alternatives.length / size)); const safePage = Math.min(page, pages - 1); const visible = alternatives.slice(safePage * size, (safePage + 1) * size); return <BotMessage title={<><Database size={19} weight="fill" /> KIỆN NGUYÊN · {anchor.variant}</>} actions={[
      ...visible.map((unit, index) => <ActionButton key={unit.code} icon={index === 0 && safePage === 0 ? Sparkle : LockKey} onClick={() => go({ ...screen, name: "suggest", unitCode: unit.code }, `khui_sku:${unit.code}`)}>{unit.code}<small>{fmt(unit.quantity)} gói{index === 0 && safePage === 0 ? " · FIFO" : ""}</small></ActionButton>),
      pages > 1 && <div className="pager" key="pager"><button disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><CaretLeft size={18} /></button><span>{safePage + 1}/{pages}</span><button disabled={safePage === pages - 1} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}><CaretRight size={18} /></button></div>,
      <ActionButton key="back" icon={ArrowLeft} tone="secondary" onClick={() => go({ ...screen, name: "suggest", unitCode: alternatives[0]?.code || anchor.code }, `khui_sku:${anchor.code}`)}>Về kiện đề xuất</ActionButton>,
      backToPackages(screen.product, anchor.sku, anchor.variant),
    ].filter(Boolean)}>Danh sách sắp xếp theo thời điểm nhập kho. Kiện đầu tiên được ưu tiên khui.</BotMessage>; }

    if (screen.name === "unsealSuccess") { const unit = units.find((item) => item.code === screen.unitCode); return <BotMessage tone="success" title={<><CheckCircle size={19} weight="fill" /> KHUI KIỆN THÀNH CÔNG</>} actions={[
      <ActionButton key="pick" icon={BoxArrowDown} onClick={() => go({ ...screen, name: "pick" }, `pick_unit:${unit.code}`)}>Rút hàng ngay từ {unit.code}</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant),
    ]}>Kiện <strong>{unit.code}</strong> đã chuyển sang Đang mở, tồn <strong>{fmt(unit.quantity)} gói</strong>.</BotMessage>; }

    if (screen.name === "checkMismatch") { const unit = units.find((item) => item.code === screen.unitCode); return <BotMessage tone="warning" title={<><WarningCircle size={19} weight="fill" /> PHÁT HIỆN TỒN THỰC TẾ</>} actions={[<ActionButton key="pick" icon={BoxArrowDown} onClick={() => go({ ...screen, name: "pick" }, `pick_unit:${unit.code}`)}>Tiếp tục rút kiện cũ</ActionButton>, backToPackages(screen.product, screen.sku, unit.variant)]}>Đã cập nhật kiện {unit.code} còn <strong>{fmt(screen.actual)} gói</strong>. Hệ thống chưa đề xuất khui kiện mới.</BotMessage>; }

    if (screen.name === "inventory") { const counts = units.reduce((acc, unit) => ({ ...acc, [unit.status]: (acc[unit.status] || 0) + 1 }), {}); return <BotMessage title={<><ClipboardText size={19} weight="fill" /> BÁO CÁO TỒN MÔ PHỎNG</>} actions={[<ActionButton key="back" icon={ArrowLeft} tone="secondary" onClick={() => go({ name: "products" }, "menu_rut")}>Quay lại rút hàng</ActionButton>]}><dl className="message-facts"><div><dt>Tổng kiện</dt><dd>{units.length}</dd></div><div><dt>Đang mở</dt><dd>{counts.opened || 0}</dd></div><div><dt>Niêm phong</dt><dd>{counts.sealed || 0}</dd></div><div><dt>Chờ kiểm</dt><dd>{counts.pending || 0}</dd></div><div><dt>Tổng sản phẩm</dt><dd>{fmt(units.reduce((sum, unit) => sum + unit.quantity, 0))} gói</dd></div></dl></BotMessage>; }
    return <BotMessage title="KHÔNG CÒN KIỆN">Phân loại này không còn kiện để thao tác.</BotMessage>;
  };

  return <main className="simulator-shell">
    <aside className="control-panel"><div className="brand-mark"><Package size={25} weight="duotone" /><span>WMS Flow Lab</span></div><div className="control-heading"><span className="eyebrow">Telegram simulator</span><h1>Thử luồng kho mà không chạm dữ liệu thật.</h1><p>Mọi thao tác chỉ tồn tại trong tab trình duyệt này.</p></div><section className="control-section"><div className="section-label">Kịch bản thử nghiệm</div><div className="scenario-list">{Object.entries(scenarios).map(([key, scenario]) => <button key={key} className={key === scenarioKey ? "scenario-card active" : "scenario-card"} onClick={() => reset(key)}><span>{scenario.label}</span><small>{scenario.description}</small></button>)}</div></section><button className="reset-button" onClick={() => reset()}><ArrowCounterClockwise size={18} weight="bold" /> Reset kịch bản hiện tại</button><div className="safety-note"><ShieldCheck size={20} weight="fill" /><div><strong>Sandbox an toàn</strong><span>Không gọi Telegram API hoặc database.</span></div></div></aside>
    <section className="telegram-stage"><div className="telegram-window"><header className="telegram-header"><div className="header-avatar">Q</div><div><strong>QUANLYKIENHANG-AIRCLEAN</strong><span><i /> @quanlykienhang_bot · trực tuyến</span></div><button title="Reset hội thoại" onClick={() => reset()}><ArrowCounterClockwise size={21} /></button></header><div className="chat-date">Mô phỏng hôm nay</div><div className="chat-stream">{renderScreen()}</div><footer className="composer"><span>Viết tin nhắn...</span><PaperPlaneTilt size={21} weight="fill" /></footer></div></section>
    <aside className="inspector-panel"><section className="callback-card"><span className="eyebrow">Callback gần nhất</span><code>{lastCallback}</code><p>Giá trị tương ứng với callback_data Telegram thật.</p></section><section className="event-panel"><div className="event-title"><ClockCounterClockwise size={20} weight="bold" /><span>Nhật ký mô phỏng</span></div><div className="event-list">{events.map((event, index) => <div className={`event-item event-item--${event.tone}`} key={`${event.label}-${index}`}><i /><div><strong>{event.label}</strong><span>{event.detail}</span></div></div>)}</div></section><section className="state-panel"><div className="section-label">Trạng thái kiện</div><div className="state-list">{activeUnits.slice(0, 8).map((unit) => <div key={unit.code}><span>{unit.code}</span><b className={`state-${unit.status}`}>{statusLabel(unit.status)}</b></div>)}{activeUnits.length > 8 && <small>+ {activeUnits.length - 8} kiện khác</small>}</div></section></aside>
  </main>;
}
