import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal as AntModal,
  Popover,
  QRCode,
  Radio,
  Segmented,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  TagsOutlined,
  InboxOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  SwapOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  UnlockOutlined,
  LockOutlined,
  RightOutlined,
  QrcodeOutlined,
  PrinterOutlined,
  CompassOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ExclamationCircleFilled,
  MoreOutlined,
  UploadOutlined,
  TagOutlined,
  DownOutlined,
  ScissorOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { Warehouse2DMap } from "../components/Warehouse2DMap";
import Modal from "../components/HandlingUnitModal";
import HandlingUnitPrintLabel from "../components/HandlingUnitPrintLabel";
import { prepareHandlingUnitPrintUnits } from "../lib/handlingUnitPrintNumbers";
import HandlingUnitStockHistory from "../components/HandlingUnitStockHistory";
import { useAuth } from "../contexts/AuthContext";
import PrepackManagement from "./PrepackManagement";
import type { PackingLot } from "../types/packagePacking";
import { compareHandlingUnitPickOrder } from "../../electron/handling-unit-pick-order.mjs";
import sealedSackImage from "../assets/warehouse-sack-sealed.webp";
import openedSackImage from "../assets/warehouse-sack-opened.webp";
import plainCartonImage from "../assets/plain-kraft-carton.webp";
import maskPouchImage from "../assets/unbranded-mask-pouch.webp";
import "./HandlingUnits.css";

type CatalogItem = {
  productId?: number;
  purchaseOrderId?: number;
  purchaseItemId?: number;
  sku: string;
  productGroup: string;
  variantName: string;
  color?: string;
  factory?: string;
  unitName: string;
  stock: number;
  cost?: number;
};
type UnitRow = {
  id: string;
  sequenceNumber?: number;
  productId?: number;
  purchaseOrderId?: number;
  purchaseItemId?: number;
  productGroup?: string;
  variantName?: string;
  color?: string;
  factory?: string;
  receiptCode?: string;
  skuName: string;
  packageType: string;
  packageLabel?: string;
  unitName: string;
  status: string;
  location?: { zone?: string; rack?: string };
  initialPcs: number;
  currentPcs: number;
  conversionFactor?: number;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  hasWithdrawalHistory?: boolean;
  returnReference?: string;
  qrPayload?: string;
  parentUnitCode?: string;
  childUnits?: Array<{ code: string; quantity: number }>;
};
type QuickScanLine = {
  id: string;
  qrCode: string;
  source?: "QR" | "MANUAL";
  sku: string;
  productName: string;
  loads: number;
  conversionFactor: number;
  packagingName: string;
  baseUnit: string;
  supplierName: string;
  supplierId?: number | null;
  location?: { zone?: string; rack?: string };
};
type QuickReceiptRow = QuickScanLine & { quantity: number };
type LocationItem = {
  id: number;
  code: string;
  name: string;
  type: string;
  description?: string;
  isActive: boolean;
};
type Workspace = {
  packedInventory: PackingLot[];
  catalog: CatalogItem[];
  register: UnitRow[];
  packagingSpecs: any[];
  qrLabels: any[];
  suppliers: Array<{ id: number; code?: string; name: string }>;
  locations: LocationItem[];
  recentTransactions: any[];
  shiftCheckPolicy?: {
    date: string;
    effectiveDate: string;
    fineAmount: number;
    assignedTo: string;
    nextAssignedTo: string;
    deadline: string;
    todayRemaining: number;
    outstanding: Array<{ code: string; requiredAt: string; date: string }>;
    trackedCodes: string[];
  };
};
type ShiftCheckCandidate = {
  packed?: boolean;
  unit: UnitRow;
  withdrawnQuantity: number;
  withdrawalCount: number;
  lastWithdrawalAt: number;
};
type ShiftCheckDraft = {
  actualQuantity: number | null;
  reason: string;
  note: string;
};

const ALLOCATION_ZONE_CODE_BY_MAP_KEY: Record<string, string> = {
  TOP_1: "A1",
  TOP_2: "A2",
  TOP_3: "A3",
  TOP_4: "A4",
  CENTER: "CENTER",
  PACKING: "Đóng gói",
  OFFICE: "OFFICE",
};

function AllocationZonePicker({
  value,
  onChange,
  units,
}: {
  value?: string;
  onChange?: (value: string) => void;
  units: UnitRow[];
}) {
  return (
    <div className="hu-allocation-zone-picker">
      <Warehouse2DMap
        units={units}
        selectedZoneCode={value}
        selectionMode
        compact
        onSelectZone={(zoneKey) =>
          onChange?.(ALLOCATION_ZONE_CODE_BY_MAP_KEY[zoneKey] || zoneKey)
        }
      />
    </div>
  );
}

export function QrZonePicker({
  id,
  value,
  onChange,
  units,
  locations,
}: {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  units: UnitRow[];
  locations: LocationItem[];
}) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const activeLocations = locations.filter((location) => location.isActive);
  const selectedLocation = activeLocations.find((location) => location.code === value);
  const draftLocation = activeLocations.find((location) => location.code === draftValue);

  useEffect(() => {
    if (!open) setDraftValue(value);
  }, [open, value]);

  const selectMapZone = (zoneKey: string) => {
    setDraftValue(ALLOCATION_ZONE_CODE_BY_MAP_KEY[zoneKey] || zoneKey);
  };

  return (
    <>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`hu-qr-zone-trigger ${value ? "is-filled" : ""}`}
        onClick={() => {
          setDraftValue(value);
          setOpen(true);
        }}
      >
        <EnvironmentOutlined className="hu-qr-zone-trigger-icon" />
        <span className="hu-qr-zone-trigger-copy">
          <small>Khu vực lưu kho</small>
          <b>{selectedLocation ? `${selectedLocation.code} · ${selectedLocation.name}` : value ? `${value} · Chọn lại khu vực` : "Chọn khu vực trên sơ đồ"}</b>
        </span>
        <RightOutlined className="hu-qr-zone-trigger-arrow" />
      </button>
      <Modal
        open={open}
        centered
        destroyOnHidden
        width={1120}
        className="hu-qr-zone-modal"
        title={
          <div className="hu-qr-zone-modal-title">
            <EnvironmentOutlined />
            <div>
              <b>Chọn khu vực lưu kho</b>
              <small>Click trực tiếp vào khu vực trên bản đồ để gán vị trí cho tem QR.</small>
            </div>
          </div>
        }
        onCancel={() => setOpen(false)}
        footer={
          <Flex justify="space-between" align="center">
            <Typography.Text type="secondary">
              Đang chọn: <b>{draftLocation ? `${draftLocation.code} · ${draftLocation.name}` : draftValue ? "Khu vực không hoạt động — vui lòng chọn lại" : "Chưa chọn khu vực"}</b>
            </Typography.Text>
            <Flex gap={8}>
              <Button onClick={() => setOpen(false)}>Hủy</Button>
              <Button
                type="primary"
                disabled={!draftLocation}
                onClick={() => {
                  if (!draftLocation) return;
                  onChange?.(draftLocation.code);
                  setOpen(false);
                }}
              >
                Dùng khu vực này
              </Button>
            </Flex>
          </Flex>
        }
      >
        <div className="hu-qr-zone-modal-grid">
          <section className="hu-qr-zone-map-panel">
            <Warehouse2DMap
              units={units}
              selectedZoneCode={draftValue}
              selectionMode
              onSelectZone={selectMapZone}
            />
          </section>
          <aside className="hu-qr-zone-list-panel">
            <div className="hu-qr-zone-list-heading">
              <b>Khu vực đang hoạt động</b>
              <small>Chọn nhanh nếu khu vực chưa có trên sơ đồ.</small>
            </div>
            <div className="hu-qr-zone-list">
              {activeLocations.map((location) => (
                <button
                  type="button"
                  key={location.code}
                  className={`hu-qr-zone-list-item ${draftValue === location.code ? "is-selected" : ""}`}
                  onClick={() => setDraftValue(location.code)}
                >
                  <span className="hu-qr-zone-list-code">{location.code}</span>
                  <span className="hu-qr-zone-list-copy">
                    <b>{location.name}</b>
                    <small>{locationTypeMeta(location.type).label}</small>
                  </span>
                  {draftValue === location.code && <CheckCircleOutlined />}
                </button>
              ))}
            </div>
          </aside>
        </div>
      </Modal>
    </>
  );
}

const fmt = (value: number) =>
  Math.max(0, Number(value || 0)).toLocaleString("vi-VN");
const fmtSigned = (value: number) => {
  const amount = Number(value || 0);
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("vi-VN")}`;
};

const locationTypeMeta = (type?: string) => {
  switch (type) {
    case "STORAGE":
      return { label: "Lưu trữ chính", color: "blue" };
    case "LOOSE":
      return { label: "Hàng lẻ / Soạn hàng", color: "orange" };
    case "PACKING":
      return { label: "Đóng gói & Xuất", color: "green" };
    case "QUARANTINE":
      return { label: "Kiểm định / Chờ xử lý", color: "red" };
    default:
      return { label: "Khu vực kho", color: "default" };
  }
};
const imageFor = (unit?: UnitRow) => {
  const type = String(unit?.packageType || "").toLocaleLowerCase("vi-VN");
  if (type.includes("tải"))
    return unit?.status === "Đang sử dụng" ? openedSackImage : sealedSackImage;
  if (type.includes("thùng") || type.includes("carton"))
    return plainCartonImage;
  return maskPouchImage;
};
const locationFor = (unit: UnitRow) =>
  [unit.location?.zone, unit.location?.rack].filter(Boolean).join(" · ") ||
  "Chưa phân khu";
const isWithdrawalTransaction = (item: any) =>
  /^(rút hàng|lấy hàng|chuyển đóng gói sẵn|chuyển khu đóng gói|chuyển hàng lẻ|chuyển chờ xuất kho|chuyển khu kiểm hàng)/i.test(String(item?.type || ""));
const statusFor = (status: string) =>
  status === "Nguyên niêm phong" ? (
    <Tag color="green">Đã niêm phong</Tag>
  ) : status === "Đang sử dụng" ? (
    <Tag color="orange">Đang mở</Tag>
  ) : status === "Chờ kiểm" ? (
    <Tag className="hu-pending-status-tag" icon={<ExclamationCircleFilled />}>
      Chờ kiểm
    </Tag>
  ) : status === "Đã tách" ? (
    <Tag color="blue" icon={<ScissorOutlined />}>
      Đã tách
    </Tag>
  ) : (
    <Tag>Đã hết hàng</Tag>
  );

const getPackageCategory = (packageType?: string): "TAI" | "THUNG" | "LE" => {
  const t = (packageType || "").toLowerCase();
  if (t.includes("tải") || t.includes("sack")) return "TAI";
  if (t.includes("thùng") || t.includes("carton") || t.includes("box"))
    return "THUNG";
  return "LE";
};

const normalizeUnitName = (value?: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim()
    .toLocaleLowerCase("vi-VN");

const capacityForUnit = (unit: Pick<UnitRow, "initialPcs" | "conversionFactor">) =>
  Math.min(300, Math.max(0, Number(unit.initialPcs || unit.conversionFactor || 0)));

const packagingMethodForSpec = (spec?: any): "TAI" | "THUNG" | "LE" =>
  getPackageCategory(spec?.name) === "THUNG"
    ? "THUNG"
    : getPackageCategory(spec?.name) === "TAI"
      ? "TAI"
      : "LE";

const latestPackagingSpec = (specs: any[], sku?: string, method?: string) => {
  const candidates = (Array.isArray(specs) ? specs : [])
    .filter((spec) => spec?.sku === sku && spec?.status !== "retired")
    .filter((spec) => !method || packagingMethodForSpec(spec) === method)
    .sort((left, right) =>
      String(right?.lastUsedAt || right?.createdAt || right?.id || "").localeCompare(
        String(left?.lastUsedAt || left?.createdAt || left?.id || ""),
      ),
    );
  return candidates[0];
};

const getPendingCheckConflict = (
  targetUnit: UnitRow,
  allUnits: UnitRow[],
): UnitRow | null =>
  allUnits.find(
    (unit) =>
      unit.id?.toUpperCase() !== targetUnit.id?.toUpperCase() &&
      unit.skuName?.toUpperCase() === targetUnit.skuName?.toUpperCase() &&
      (unit.status === "Chờ kiểm" || unit.status === "pending_check"),
  ) || null;

const pendingCheckBlockText = (unit: UnitRow, conflict: UnitRow, action: string) =>
  `Không thể ${action}. SKU [${unit.skuName}] đang có kiện [${conflict.id}] chờ kiểm thực tế (tồn theo sổ: ${conflict.currentPcs} ${conflict.unitName}). Vui lòng vào tab Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`;

const getConflictingOpenedUnit = (
  targetUnit: UnitRow,
  allUnits: UnitRow[],
): UnitRow | null => {
  const cat = getPackageCategory(targetUnit.packageType);
  const sameSku = (u: UnitRow) =>
    u.id?.toUpperCase() !== targetUnit.id?.toUpperCase() &&
    u.skuName?.toUpperCase() === targetUnit.skuName?.toUpperCase();

  // Kiện đã về 0/chờ kiểm luôn khóa kiện mới cùng SKU, kể cả khác dạng bao bì.
  const pendingCheck = getPendingCheckConflict(targetUnit, allUnits);
  if (pendingCheck) return pendingCheck;

  // Riêng với hàng lẻ: không áp dụng quy tắc chỉ một kiện đang mở.
  if (cat === "LE") return null;

  return (
    allUnits.find((u) => {
      if (!sameSku(u) || u.status !== "Đang sử dụng") return false;
      return getPackageCategory(u.packageType) === cat;
    }) || null
  );
};

const getColorDot = (colorName?: string, sku?: string) => {
  const text = `${colorName || ""} ${sku || ""}`.toLowerCase();
  if (text.includes("đen") || text.includes("den") || text.includes("black")) {
    return { dot: "#18181b", border: "#18181b", label: "Đen" };
  }
  if (text.includes("hồng") || text.includes("hong") || text.includes("pink")) {
    return { dot: "#f43f5e", border: "#f43f5e", label: "Hồng" };
  }
  if (text.includes("xanh") || text.includes("blue")) {
    return { dot: "#0284c7", border: "#0284c7", label: "Xanh" };
  }
  if (text.includes("xám") || text.includes("xam") || text.includes("gray")) {
    return { dot: "#64748b", border: "#64748b", label: "Xám" };
  }
  return { dot: "#ffffff", border: "#cbd5e1", label: "Trắng" };
};

const normalizeSearch = (text: string) =>
  (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .trim();
const isReturnHandlingUnit = (unit?: UnitRow | null) =>
  normalizeSearch(unit?.packageType || "").includes("hang hoan");

const buildSplitQuantities = (total: number, targetSize: number) => {
  const normalizedTotal = Math.floor(Number(total || 0));
  const normalizedTarget = Math.floor(Number(targetSize || 0));
  if (
    normalizedTotal <= 1 ||
    normalizedTarget <= 0 ||
    normalizedTarget >= normalizedTotal
  ) {
    return [];
  }
  const fullUnits = Math.floor(normalizedTotal / normalizedTarget);
  const remainder = normalizedTotal % normalizedTarget;
  return [
    ...Array.from({ length: fullUnits }, () => normalizedTarget),
    ...(remainder > 0 ? [remainder] : []),
  ];
};

const historyActionMeta = (type?: string) => {
  const value = String(type || "Hoạt động khác");
  if (/^NHAP$/i.test(value)) return { label: "Nhập", color: "green" };
  if (/^POS$/i.test(value)) return { label: "POS", color: "blue" };
  if (/^TMDT$/i.test(value)) return { label: "TMĐT", color: "purple" };
  if (/^XUAT$/i.test(value)) return { label: "Xuất", color: "orange" };
  if (/^TRA$/i.test(value)) return { label: "Trả", color: "gold" };
  if (/^HOAN$/i.test(value)) return { label: "Hoàn", color: "cyan" };
  if (/^CAN_BANG$/i.test(value)) return { label: "Cân bằng", color: "geekblue" };
  if (/đồng bộ kiện/i.test(value)) return { label: "Đồng bộ", color: "default" };
  if (/chuyển chờ xuất kho tmdt/i.test(value)) return { label: "Xuất TMĐT", color: "blue" };
  if (/nhập kiện|tạo kiện/i.test(value)) return { label: "Nhập kiện", color: "green" };
  if (/lấy hàng|rút hàng|chuyển/i.test(value)) return { label: "Chuyển", color: "blue" };
  if (/khui|mở/i.test(value)) return { label: "Mở kiện", color: "orange" };
  if (/đóng|niêm phong/i.test(value)) return { label: "Đóng kiện", color: "cyan" };
  if (/tách kiện|nhận từ tách/i.test(value)) return { label: "Tách kiện", color: "blue" };
  if (/kiểm|điều chỉnh/i.test(value)) return { label: "Điều chỉnh", color: "gold" };
  if (/xóa/i.test(value)) return { label: "Xóa", color: "red" };
  return { label: value, color: "default" };
};

const formatHistoryTime = (value?: string) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const localDayKey = (value: string | number | Date) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });
};

const isCompletedCheckTransaction = (item: any) =>
  /kiểm cuối ca|kiểm khớp - chốt hết kiện|kiểm lệch - cập nhật tồn thực tế/i.test(
    String(item?.type || ""),
  );

const SHIFT_CHECK_REASONS = [
  "Xuất hàng chưa ghi nhận",
  "Trả hàng chưa ghi nhận",
  "Sai số kiểm đếm trước đó",
  "Hư hỏng / thất thoát",
  "Khác",
];

// Product groups come from the catalog with this generic category prefix.
// Keep it in the stored data, but omit it from the SKU browser label.
const displayProductGroup = (name: string) =>
  name.replace(/^\s*khẩu\s*trang\s*/i, "").trim() || name;

const workspaceLayoutDefaults: Workspace = {
  packedInventory: [],
  catalog: [
    {
      sku: "1-5DUNI-TRANG",
      productGroup: "Khẩu trang 5D UNICARE",
      variantName: "Khẩu trang 5D UNICARE - Trắng",
      color: "Trắng",
      unitName: "Gói",
      stock: 3690,
    },
    {
      sku: "1-5DUNI-DEN",
      productGroup: "Khẩu trang 5D UNICARE",
      variantName: "Khẩu trang 5D UNICARE - Đen",
      color: "Đen",
      unitName: "Gói",
      stock: 3255,
    },
    {
      sku: "1-5DUNI-HONG",
      productGroup: "Khẩu trang 5D UNICARE",
      variantName: "Khẩu trang 5D UNICARE - Hồng",
      color: "Hồng",
      unitName: "Gói",
      stock: 1200,
    },
    {
      sku: "1-UPF-DEN",
      productGroup: "Khẩu trang UNICARE UPF UV",
      variantName: "Khẩu trang UNICARE UPF UV - Đen",
      color: "Đen",
      unitName: "Gói",
      stock: 500,
    },
    {
      sku: "1-5DTP-TRANG",
      productGroup: "Khẩu trang 5D Thịnh Phát",
      variantName: "Khẩu trang 5D Thịnh Phát - Trắng",
      color: "Trắng",
      unitName: "Gói",
      stock: 2400,
    },
    {
      sku: "1-AMI-XANH",
      productGroup: "Khẩu trang AMI Y Tế",
      variantName: "Khẩu trang AMI 4 Lớp - Xanh",
      color: "Xanh",
      unitName: "Hộp",
      stock: 850,
    },
    {
      sku: "1-N95-DUYNGOC",
      productGroup: "Khẩu trang N95 Duy Ngọc",
      variantName: "Khẩu trang N95 Duy Ngọc - Có van",
      color: "Trắng",
      unitName: "Cái",
      stock: 420,
    },
  ],
  register: [
    {
      id: "KN-5DTR-01",
      receiptCode: "PNK-240816-01",
      skuName: "1-5DUNI-TRANG",
      packageType: "Tải dứa",
      packageLabel: "Tải dứa · 1.200 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A1", rack: "Kệ 01" },
      initialPcs: 1200,
      currentPcs: 1200,
      note: "Kiện nguyên nhập theo phiếu PNK-240816-01",
    },
    {
      id: "KN-5DTR-02",
      receiptCode: "PNK-240816-01",
      skuName: "1-5DUNI-TRANG",
      packageType: "Tải dứa",
      packageLabel: "Tải dứa · 1.200 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A1", rack: "Kệ 01" },
      initialPcs: 1200,
      currentPcs: 1200,
      note: "Kiện nguyên nhập theo phiếu PNK-240816-01",
    },
    {
      id: "KN-5DTR-03",
      receiptCode: "PNK-240816-01",
      skuName: "1-5DUNI-TRANG",
      packageType: "Tải dứa",
      packageLabel: "Tải dứa · 1.200 Gói",
      unitName: "Gói",
      status: "Đang sử dụng",
      location: { zone: "A1", rack: "Kệ 02" },
      initialPcs: 1200,
      currentPcs: 610,
      note: "Đang mở để xuất lẻ",
    },
    {
      id: "KN-5DTR-04",
      receiptCode: "PNK-240816-02",
      skuName: "1-5DUNI-TRANG",
      packageType: "Thùng carton",
      packageLabel: "Thùng carton · 250 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A1", rack: "Kệ 04" },
      initialPcs: 250,
      currentPcs: 250,
      note: "Kiện nguyên nhập theo phiếu PNK-240816-02",
    },
    {
      id: "KN-5DTR-05",
      receiptCode: "PNK-240816-02",
      skuName: "1-5DUNI-TRANG",
      packageType: "Túi lẻ",
      packageLabel: "Hàng túi rời · 300 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A1", rack: "Kệ 05" },
      initialPcs: 300,
      currentPcs: 300,
      note: "Hàng lẻ tách kiện chờ xuất",
    },
    {
      id: "KN-5DDEN-01",
      receiptCode: "PNK-240816-03",
      skuName: "1-5DUNI-DEN",
      packageType: "Thùng carton",
      packageLabel: "Thùng carton · 50 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A2", rack: "Kệ 02" },
      initialPcs: 50,
      currentPcs: 50,
      note: "Kiện nguyên nhập theo phiếu PNK-240816-03",
    },
    {
      id: "KN-5DHG-01",
      receiptCode: "PNK-240816-05",
      skuName: "1-5DUNI-HONG",
      packageType: "Tải dứa",
      packageLabel: "Tải dứa · 1.200 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A2", rack: "Kệ 03" },
      initialPcs: 1200,
      currentPcs: 1200,
      note: "Kiện nguyên nhập theo phiếu PNK-240816-05",
    },
    {
      id: "KN-UPFDEN-01",
      receiptCode: "PNK-240816-04",
      skuName: "1-UPF-DEN",
      packageType: "Gói lẻ",
      packageLabel: "Hàng lẻ · 50 Gói",
      unitName: "Gói",
      status: "Đang sử dụng",
      location: { zone: "Hàng lẻ" },
      initialPcs: 50,
      currentPcs: 50,
      note: "Hàng lẻ demo",
    },
    {
      id: "KN-5DTP-01",
      receiptCode: "PNK-240816-06",
      skuName: "1-5DTP-TRANG",
      packageType: "Tải dứa",
      packageLabel: "Tải dứa · 500 Gói",
      unitName: "Gói",
      status: "Nguyên niêm phong",
      location: { zone: "A1", rack: "Kệ 06" },
      initialPcs: 500,
      currentPcs: 500,
      note: "Kiện nguyên xưởng Thịnh Phát",
    },
    {
      id: "KN-AMI-01",
      receiptCode: "PNK-240816-07",
      skuName: "1-AMI-XANH",
      packageType: "Thùng carton",
      packageLabel: "Thùng carton · 50 Hộp",
      unitName: "Hộp",
      status: "Nguyên niêm phong",
      location: { zone: "A2", rack: "Kệ 05" },
      initialPcs: 50,
      currentPcs: 50,
      note: "Kiện AMI y tế",
    },
    {
      id: "KN-N95-01",
      receiptCode: "PNK-240816-08",
      skuName: "1-N95-DUYNGOC",
      packageType: "Thùng carton",
      packageLabel: "Thùng carton · 30 Cái",
      unitName: "Cái",
      status: "Nguyên niêm phong",
      location: { zone: "A2", rack: "Kệ 06" },
      initialPcs: 30,
      currentPcs: 30,
      note: "Khẩu trang N95",
    },
  ],
  packagingSpecs: [
    {
      id: 1,
      sku: "1-5DUNI-TRANG",
      name: "Tải",
      baseUnit: "Gói",
      conversionFactor: 1200,
      version: 1,
      status: "active",
    },
    {
      id: 2,
      sku: "1-5DUNI-DEN",
      name: "Thùng",
      baseUnit: "Gói",
      conversionFactor: 50,
      version: 1,
      status: "active",
    },
  ],
  qrLabels: [],
  suppliers: [],
  locations: [
    {
      id: 1,
      code: "A1",
      name: "Khu chứa hàng 1 (Dãy A1)",
      type: "STORAGE",
      description: "Lưu trữ thùng carton và tải dứa nguyên kiện chuẩn",
      isActive: true,
    },
    {
      id: 2,
      code: "A2",
      name: "Khu chứa hàng 2 (Dãy A2)",
      type: "STORAGE",
      description: "Lưu trữ thùng carton nhỏ và khẩu trang y tế",
      isActive: true,
    },
    {
      id: 3,
      code: "A3",
      name: "Khu chứa hàng 3 (Dãy A3)",
      type: "STORAGE",
      description: "Lưu trữ phụ kiện và hàng dự phòng",
      isActive: true,
    },
    {
      id: 4,
      code: "A4",
      name: "Khu chứa hàng 4 (Dãy A4)",
      type: "STORAGE",
      description: "Lưu trữ hàng hóa lưu kho dài hạn",
      isActive: true,
    },
    {
      id: 5,
      code: "CENTER",
      name: "Khu chứa hàng (Giữa)",
      type: "STORAGE",
      description: "Khu vực lưu trữ trung tâm giữa kho",
      isActive: true,
    },
    {
      id: 6,
      code: "Đóng gói",
      name: "Khu đóng gói hàng & xuất đơn",
      type: "PACKING",
      description:
        "Tập kết kiện hàng đã hoàn tất chuẩn bị giao Shopee / TikTok / POS",
      isActive: true,
    },
    {
      id: 7,
      code: "Hàng lẻ",
      name: "Khu vực soạn hàng & hàng lẻ",
      type: "LOOSE",
      description: "Vị trí bóc tách lấy hàng rời phục vụ đóng gói đơn lẻ",
      isActive: true,
    },
    {
      id: 8,
      code: "Kiểm hàng",
      name: "Khu vực tiếp nhận & kiểm định",
      type: "QUARANTINE",
      description: "Hàng mới nhập kho chờ phân loại và niêm phong kiện",
      isActive: true,
    },
    {
      id: 9,
      code: "OFFICE",
      name: "Phòng làm việc",
      type: "STORAGE",
      description: "Vị trí lưu kiện trong phòng làm việc / văn phòng điều hành",
      isActive: true,
    },
  ],
  recentTransactions: [],
};

// Product and handling-unit records are loaded only through the desktop IPC
// bridge. Locations remain local configuration for the warehouse floor plan.
const emptyWorkspace: Workspace = {
  packedInventory: [],
  ...workspaceLayoutDefaults,
  catalog: [],
  register: [],
  packagingSpecs: [],
  qrLabels: [],
  suppliers: [],
  recentTransactions: [],
};
let handlingUnitsWorkspaceCache: Pick<
  Workspace,
  "catalog" | "register" | "recentTransactions" | "packedInventory"
> | null = null;

export default function HandlingUnits({ onExit, initialTab = "units" }: { onExit?: () => void; initialTab?: "units" | "prepack" }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [activeModuleTab, setActiveModuleTab] = useState<"units" | "prepack" | "history">(initialTab);
  const moduleContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    moduleContentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeModuleTab]);
  const [historyScope, setHistoryScope] = useState<"units" | "prepack">(initialTab);
  const [prepackCreateRequest, setPrepackCreateRequest] = useState(0);
  const [workspace, setWorkspace] = useState(() =>
    handlingUnitsWorkspaceCache
      ? { ...emptyWorkspace, ...handlingUnitsWorkspaceCache }
      : emptyWorkspace,
  );
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(
    () =>
      Boolean(
        window.electronAPI?.handlingUnits?.getWorkspace &&
          !handlingUnitsWorkspaceCache,
      ),
  );
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [selectedSku, setSelectedSku] = useState(
    () => handlingUnitsWorkspaceCache?.catalog[0]?.sku || "",
  );
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<UnitRow | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printUnits, setPrintUnits] = useState<UnitRow[]>([]);
  const [printLabelSize, setPrintLabelSize] = useState<"A6" | "A7">(() =>
    window.localStorage.getItem("hu-print-label-size") === "A7" ? "A7" : "A6",
  );
  const [isExportingLabelPdf, setIsExportingLabelPdf] = useState(false);

  const updatePrintLabelSize = (value: "A6" | "A7") => {
    setPrintLabelSize(value);
    window.localStorage.setItem("hu-print-label-size", value);
  };

  const handlePrintLabels = (
    units: UnitRow[],
    size: "A6" | "A7",
  ) => {
    if (!units.length || isExportingLabelPdf) return;
    updatePrintLabelSize(size);
    setPrintUnits(prepareHandlingUnitPrintUnits(units, displaySequenceByUnitId));
    setIsExportingLabelPdf(true);
    setShowPrintModal(true);
  };

  useEffect(() => {
    if (!isExportingLabelPdf || !showPrintModal || !printUnits.length) return;

    let cancelled = false;
    let printStyle: HTMLStyleElement | null = null;
    let printRoot: HTMLElement | null = null;
    const cleanup = () => {
      document.body.classList.remove("hu-label-printing");
      printRoot?.remove();
      printStyle?.remove();
    };

    const exportPdf = async () => {
      const isA7 = printLabelSize === "A7";
      const pageWidth = isA7 ? "75mm" : "100mm";
      const pageHeight = isA7 ? "100mm" : "150mm";
      const pagePadding = isA7 ? "3mm" : "4mm";
      printStyle = document.createElement("style");
      printStyle.id = "hu-label-page-size";
      printStyle.textContent = `
        @media screen {
          .hu-print-pdf-root { display: none !important; }
        }
        @page { size: ${pageWidth} ${pageHeight} !important; margin: 0 !important; }
        @media print {
          html, body {
            width: ${pageWidth} !important;
            min-width: ${pageWidth} !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          body.hu-label-printing > *:not(.hu-print-pdf-root) {
            display: none !important;
          }
          body.hu-label-printing > .hu-print-pdf-root {
            position: static !important;
            display: block !important;
            visibility: visible !important;
            width: ${pageWidth} !important;
            min-width: ${pageWidth} !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }
          body.hu-label-printing > .hu-print-pdf-root,
          body.hu-label-printing > .hu-print-pdf-root * {
            visibility: visible !important;
          }
          body.hu-label-printing .hu-print-label {
            width: ${pageWidth} !important;
            min-width: ${pageWidth} !important;
            max-width: ${pageWidth} !important;
            height: ${pageHeight} !important;
            min-height: ${pageHeight} !important;
            max-height: ${pageHeight} !important;
            margin: 0 !important;
            padding: ${pagePadding} !important;
            box-sizing: border-box !important;
            transform: none !important;
          }
        }
      `;
      document.getElementById(printStyle.id)?.remove();
      document.head.appendChild(printStyle);

      try {
        await document.fonts?.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (cancelled) return;

        const preview = document.querySelector(
          ".hu-print-modal .hu-print-preview-wrapper",
        );
        if (!preview) {
          throw new Error("Không tìm thấy nội dung tem để tạo PDF.");
        }
        printRoot = preview.cloneNode(true) as HTMLElement;
        printRoot.classList.add("hu-print-pdf-root");
        document.body.appendChild(printRoot);
        document.body.classList.add("hu-label-printing");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (cancelled) return;

        const exportLabelsPdf = window.electronAPI?.handlingUnits?.exportLabelsPdf;
        if (!exportLabelsPdf) {
          throw new Error("Phiên bản ứng dụng hiện tại chưa hỗ trợ xuất PDF tem.");
        }
        const result = await exportLabelsPdf({
          fileName: `DBY-WMS-Tem-${printLabelSize}-${printUnits.length}-tem`,
          labelSize: printLabelSize,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Không thể tạo hoặc mở file PDF tem.");
        }

        const qrCodes = printUnits
          .map((unit) => String(unit.qrPayload || "").trim())
          .filter(Boolean);
        if (qrCodes.length) {
          try {
            setIsMarkingQrLabelsPrinted(true);
            const markResult =
              await window.electronAPI?.handlingUnits?.markQrLabelsPrinted?.(qrCodes);
            if (!markResult?.success) {
              throw new Error(markResult?.error || "Không thể cập nhật trạng thái tem.");
            }
            setIssuedQrLabels((previous) =>
              previous.map((label) =>
                qrCodes.includes(label.code) ? { ...label, status: "printed" } : label,
              ),
            );
            void loadWorkspace(true);
          } catch (error: any) {
            message.warning(
              `PDF đã mở nhưng chưa cập nhật được trạng thái tem: ${error?.message || "Lỗi không xác định"}`,
            );
          } finally {
            setIsMarkingQrLabelsPrinted(false);
          }
        }

        message.success(`Đã tạo và mở PDF ${printLabelSize} ${isA7 ? "75 × 100" : "100 × 150"} mm (${printUnits.length} tem).`);
      } catch (error: any) {
        message.error(error?.message || "Không thể tạo hoặc mở file PDF tem.");
      } finally {
        cleanup();
        if (!cancelled) {
          setIsExportingLabelPdf(false);
          setShowPrintModal(false);
        }
      }
    };

    void exportPdf();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isExportingLabelPdf, printLabelSize, printUnits, showPrintModal]);

  const [showLocations, setShowLocations] = useState(false);
  const [locationFocusUnit, setLocationFocusUnit] = useState<UnitRow | null>(null);
  const [showAllocation, setShowAllocation] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [allocationForm] = Form.useForm();
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [showQrSetup, setShowQrSetup] = useState(false);
  const [qrModalTab, setQrModalTab] = useState<"create" | "ledger">("create");
  const [isIssuingQrLabels, setIsIssuingQrLabels] = useState(false);
  const [isMarkingQrLabelsPrinted, setIsMarkingQrLabelsPrinted] = useState(false);
  const [issuedQrLabels, setIssuedQrLabels] = useState<any[]>([]);
  const [qrSetupForm] = Form.useForm();
  const [quickScanLines, setQuickScanLines] = useState<QuickScanLine[]>([]);
  const [showLegacyQrEntry, setShowLegacyQrEntry] = useState(false);
  const [quickManualSku, setQuickManualSku] = useState<string>();
  const [quickManualQuantity, setQuickManualQuantity] = useState<number>();
  const [quickManualSupplierId, setQuickManualSupplierId] = useState<number>();
  const [quickLastCode, setQuickLastCode] = useState("");
  const [quickScanError, setQuickScanError] = useState("");
  const [quickReceiptFileName, setQuickReceiptFileName] = useState("");
  const [quickReceiptFile, setQuickReceiptFile] = useState<File | null>(null);
  const [quickGoodsCompanies, setQuickGoodsCompanies] = useState<any[]>([]);
  const [quickCompanyIdBySku, setQuickCompanyIdBySku] = useState<Record<string, string>>({});
  const [quickPriceBySku, setQuickPriceBySku] = useState<Record<string, number>>({});
  const [isQuickConfirming, setIsQuickConfirming] = useState(false);
  const quickScanInputRef = useRef<any>(null);
  const quickReceiptInputRef = useRef<HTMLInputElement>(null);
  const quickSuccessSoundRef = useRef<HTMLAudioElement | null>(null);
  const quickFailSoundRef = useRef<HTMLAudioElement | null>(null);
  const quickReceivingOperationKeyRef = useRef("");

  useEffect(() => {
    const successSound = new Audio("./sounds/ting.wav");
    const failSound = new Audio("./sounds/alert_louder.wav");
    successSound.preload = "auto";
    failSound.preload = "auto";
    successSound.volume = 1;
    failSound.volume = 1;
    quickSuccessSoundRef.current = successSound;
    quickFailSoundRef.current = failSound;
    return () => {
      quickSuccessSoundRef.current = null;
      quickFailSoundRef.current = null;
    };
  }, []);

  const playQuickScanSound = (type: "success" | "fail") => {
    const source =
      type === "success"
        ? quickSuccessSoundRef.current
        : quickFailSoundRef.current;
    if (!source) return;
    try {
      const sound = source.cloneNode() as HTMLAudioElement;
      sound.volume = 1;
      sound.currentTime = 0;
      void sound.play().catch((error) => {
        console.warn("Không phát được âm báo quét QR:", error);
      });
    } catch (error) {
      console.warn("Không khởi tạo được âm báo quét QR:", error);
    }
  };

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [visibleUnitLimit, setVisibleUnitLimit] = useState(100);
  const [historySearch, setHistorySearch] = useState("");
  const [historyType, setHistoryType] = useState("all");
  const [historyFromDate, setHistoryFromDate] = useState("");
  const [historyToDate, setHistoryToDate] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | number | null>(null);
  const [ledgerHistory, setLedgerHistory] = useState<any[]>([]);
  const [ledgerHistoryLoading, setLedgerHistoryLoading] = useState(false);
  const [locModalView, setLocModalView] = useState<"map" | "list">("map");

  const [selectedLocationCode, setSelectedLocationCode] =
    useState<string>("A1");
  const [locationSearch, setLocationSearch] = useState<string>("");
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [addLocationForm] = Form.useForm();
  const [movingUnit, setMovingUnit] = useState<UnitRow | null>(null);
  const [moveLocationForm] = Form.useForm();
  // Kept for backwards-compatible data repair access; no action button exposes this in the new workflow.
  const [editingUnit, setEditingUnit] = useState<UnitRow | null>(null);
  const [editUnitForm] = Form.useForm();
  const [isSavingUnitEdit, setIsSavingUnitEdit] = useState(false);
  const [splittingUnit, setSplittingUnit] = useState<UnitRow | null>(null);
  const [splitTargetSize, setSplitTargetSize] = useState(500);
  const [isSplittingUnit, setIsSplittingUnit] = useState(false);
  const splitOperationKeyRef = useRef("");

  const showUnitLocation = (unit: UnitRow) => {
    setLocationFocusUnit(unit);
    setSelectedLocationCode(unit.location?.zone || "");
    setLocModalView("map");
    setShowLocations(true);
  };

  const [mergeReturnUnit, setMergeReturnUnit] = useState<UnitRow | null>(null);
  const [mergeTargetCode, setMergeTargetCode] = useState("");
  const [mergeQuantity, setMergeQuantity] = useState<number | null>(null);
  const [isMergingReturnUnit, setIsMergingReturnUnit] = useState(false);
  const mergeReturnOperationKeyRef = useRef("");
  const [deletingUnitCode, setDeletingUnitCode] = useState("");
  const workspaceLoadRequestRef = useRef(0);
  const workspaceLoadInFlightRef = useRef(false);
  const workspaceReloadQueuedRef = useRef(false);
  const workspaceResponseSignatureRef = useRef(
    handlingUnitsWorkspaceCache
      ? JSON.stringify(handlingUnitsWorkspaceCache)
      : "",
  );
  const [showFinalCheckModal, setShowFinalCheckModal] = useState(false);
  const [checkingUnit, setCheckingUnit] = useState<UnitRow | null>(null);
  const [finalCheckForm] = Form.useForm();
  const [isFinalizingCheck, setIsFinalizingCheck] = useState(false);
  const isFinalizingCheckRef = useRef(false);
  const finalPickVerification = Form.useWatch("finalVerification", finalCheckForm);
  const [showShiftCheckModal, setShowShiftCheckModal] = useState(false);
  const [shiftCheckScope, setShiftCheckScope] = useState<"all" | "mandatory">("all");
  const [shiftCheckFocusCode, setShiftCheckFocusCode] = useState<string | null>(null);
  const [shiftCheckDrafts, setShiftCheckDrafts] = useState<
    Record<string, ShiftCheckDraft>
  >({});
  const [isSubmittingShiftCheck, setIsSubmittingShiftCheck] = useState(false);
  const shiftCheckRequestIdRef = useRef("");

  const loadWorkspace = async (prioritizeFreshData = false) => {
    if (workspaceLoadInFlightRef.current) {
      if (prioritizeFreshData) {
        workspaceReloadQueuedRef.current = true;
      }
      return;
    }

    workspaceLoadInFlightRef.current = true;
    const requestId = ++workspaceLoadRequestRef.current;
    let loadTimer: ReturnType<typeof setTimeout>;
    let loadFailed = false;
    try {
      if (window.electronAPI?.handlingUnits?.getWorkspace) {
        const timeout = new Promise<never>((_, reject) => {
          loadTimer = setTimeout(() => reject(new Error("Tải dữ liệu kiện hàng quá lâu. Kiểm tra kết nối rồi thử lại.")), 20000);
        });
        const res = await Promise.race([
          window.electronAPI.handlingUnits.getWorkspace(),
          timeout,
        ]);
        if (requestId !== workspaceLoadRequestRef.current) return;
        if (res?.success && res.data) {
          setWorkspaceLoadError(null);
          const catalog = Array.isArray(res.data.catalog) ? res.data.catalog : [];
          const register = Array.isArray(res.data.register) ? res.data.register : [];
          const rawData = res.data as any;
          const recentTransactions = Array.isArray(rawData.recentTransactions)
            ? rawData.recentTransactions
            : [];
          const packagingSpecs = Array.isArray(rawData.packagingSpecs)
            ? rawData.packagingSpecs
            : [];
          const qrLabels = Array.isArray(rawData.qrLabels) ? rawData.qrLabels : [];
          const suppliers = Array.isArray(rawData.suppliers) ? rawData.suppliers : [];
          const shiftCheckPolicy = rawData.shiftCheckPolicy;
          const packedInventory = Array.isArray(rawData.packedInventory) ? rawData.packedInventory : [];
          // Avoid serializing the whole workspace on every refresh. The old
          // signature copied several hundred history/QR records before React
          // could paint; these revision hints still detect normal mutations
          // while keeping refresh work proportional to the response size.
          const compactSignature = (items: any[]) => items.map((item) => [
            item?.id || item?.code || item?.unitId || item?.sku || item?.name || item?.reference || "",
            item?.updatedAt || item?.createdAt || "",
            item?.status || "",
            item?.remainingQuantity ?? item?.currentPcs ?? item?.quantity ?? "",
            item?.name || item?.packagingName || item?.baseUnit || "",
            item?.location?.zone || item?.location || "",
          ].join("~")).join(";");
          const responseSignature = [
            compactSignature(catalog),
            compactSignature(register),
            compactSignature(recentTransactions),
            compactSignature(packagingSpecs),
            compactSignature(qrLabels),
            compactSignature(suppliers),
            compactSignature(packedInventory),
            JSON.stringify(shiftCheckPolicy || null),
          ].join("|");
          handlingUnitsWorkspaceCache = { catalog, register, recentTransactions, packedInventory };
          if (responseSignature === workspaceResponseSignatureRef.current) return;
          workspaceResponseSignatureRef.current = responseSignature;
          setWorkspace((prev) => ({
            ...prev,
            catalog,
            register,
            recentTransactions,
            packagingSpecs,
            qrLabels,
            suppliers,
            shiftCheckPolicy,
            packedInventory,
          }));
          setSelectedSku((current) =>
            catalog.some((item) => item.sku === current)
              ? current
              : catalog[0]?.sku || "",
          );
          setDetail((current) =>
            current
              ? register.find((unit) => unit.id?.toUpperCase() === current.id?.toUpperCase()) || null
              : null,
          );
        } else {
          throw new Error(res?.error || "Không tải được dữ liệu kiện hàng.");
        }
      }
    } catch (err) {
      loadFailed = true;
      console.warn("Load handling units error:", err);
      if (requestId === workspaceLoadRequestRef.current) {
        setWorkspaceLoadError(err instanceof Error ? err.message : "Không tải được dữ liệu kiện hàng.");
      }
    } finally {
      clearTimeout(loadTimer);
      workspaceLoadInFlightRef.current = false;
      setIsWorkspaceLoading(false);
      if (workspaceReloadQueuedRef.current) {
        workspaceReloadQueuedRef.current = false;
        if (!loadFailed) void loadWorkspace();
      }
    }
  };

  useEffect(() => {
    void loadWorkspace();
    const intervalTimer = setInterval(() => {
      if (document.visibilityState === "visible") void loadWorkspace();
    }, 120000);
    const unsub = window.electronAPI?.handlingUnits?.onChanged?.(() => {
      void loadWorkspace(true);
    });
    const unsubStock = window.electronAPI?.products?.onStockChanged?.(() => {
      void loadWorkspace(true);
    });
    return () => {
      clearInterval(intervalTimer);
      unsub?.();
      unsubStock?.();
    };
  }, []);

  useEffect(() => {
    if (isWorkspaceLoading) return;
    handlingUnitsWorkspaceCache = {
      catalog: workspace.catalog,
      register: workspace.register,
      recentTransactions: workspace.recentTransactions,
      packedInventory: workspace.packedInventory,
    };
  }, [
    isWorkspaceLoading,
    workspace.catalog,
    workspace.register,
    workspace.recentTransactions,
    workspace.packedInventory,
  ]);

  const handleUnsealUnit = async (unit: UnitRow): Promise<boolean> => {
    try {
      const conflict = getConflictingOpenedUnit(unit, workspace.register);
      if (conflict) {
        if (conflict.status === "Chờ kiểm" || conflict.status === "pending_check") {
          message.warning(pendingCheckBlockText(unit, conflict, "khui kiện mới"), 8);
          return false;
        }
        const catLabel =
          getPackageCategory(unit.packageType) === "TAI" ? "Tải" : "Thùng";
        message.warning(
          `⚠️ Không thể khui! SKU [${unit.skuName}] đang có kiện ${catLabel} [${conflict.id}] đang mở (còn ${fmt(conflict.currentPcs)} ${conflict.unitName}). Vui lòng dùng hết kiện cũ trước khi khui kiện ${catLabel} mới!`,
          6,
        );
        return false;
      }

      if (window.electronAPI?.handlingUnits?.unsealUnit) {
        const res = await window.electronAPI.handlingUnits.unsealUnit({
          code: unit.id,
        });
        if (!res.success)
          throw new Error(res.error || "Không thể mở niêm phong.");
      }
      setWorkspace((prev) => ({
        ...prev,
        register: prev.register.map((u) =>
          u.id === unit.id ? { ...u, status: "Đang sử dụng" } : u,
        ),
        recentTransactions: [
          {
            id: `TR-${Date.now()}`,
            unitId: unit.id,
            sku: unit.skuName,
            createdAt: new Date().toISOString(),
            type: "Khui kiện",
            quantity: 0,
            remaining: unit.currentPcs,
            actor: user?.username || "Hệ thống",
            note: "Đã khui",
          },
          ...prev.recentTransactions,
        ],
      }));
      if (detail && detail.id === unit.id) {
        setDetail({ ...detail, status: "Đang sử dụng" });
      }
      message.success(
        `Đã khui kiện ${unit.id} thành công (chuyển sang Đang sử dụng)!`,
      );
      return true;
    } catch (err: any) {
      message.error(err?.message || "Lỗi khui kiện");
      return false;
    }
  };

  const openSplitUnit = (unit: UnitRow) => {
    if (
      !["Nguyên niêm phong", "Đang sử dụng"].includes(unit.status) ||
      unit.currentPcs <= 1 ||
      isReturnHandlingUnit(unit)
    ) {
      message.warning("Kiện này không ở trạng thái có thể tách.");
      return;
    }
    const defaultTarget =
      unit.currentPcs > 300
        ? 300
        : Math.max(1, Math.floor(unit.currentPcs / 2));
    setSplitTargetSize(defaultTarget);
    splitOperationKeyRef.current = `split-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setSplittingUnit(unit);
  };

  const handleSplitUnit = async () => {
    if (!splittingUnit || isSplittingUnit) return;
    const childQuantities = buildSplitQuantities(
      splittingUnit.currentPcs,
      splitTargetSize,
    );
    if (childQuantities.length < 2) {
      message.warning("Kích thước kiện con phải nhỏ hơn tồn hiện tại.");
      return;
    }
    if (childQuantities.length > 20) {
      message.warning(
        "Một lần chỉ tách tối đa 20 kiện con. Hãy tăng kích thước mỗi kiện.",
      );
      return;
    }

    setIsSplittingUnit(true);
    try {
      const splitUnit = window.electronAPI?.handlingUnits?.splitUnit;
      if (!splitUnit) {
        throw new Error("Phiên bản ứng dụng hiện tại chưa hỗ trợ tách kiện.");
      }
      const result = await splitUnit({
        code: splittingUnit.id,
        childQuantities,
        packagingName: splittingUnit.packageType,
        location: splittingUnit.location,
        expectedRemainingQuantity: splittingUnit.currentPcs,
        idempotencyKey: splitOperationKeyRef.current,
      });
      if (!result?.success || !result.data) {
        throw new Error(result?.error || "Không thể tách kiện.");
      }

      const createdChildren: UnitRow[] = (result.data.children || []).map(
        (child: any) => {
          let location = splittingUnit.location;
          try {
            location = JSON.parse(child.zone || "{}");
          } catch {}
          return {
            id: child.code,
            sequenceNumber: child.sequenceNumber,
            productId: child.productId,
            purchaseOrderId: child.purchaseOrderId,
            purchaseItemId: child.purchaseItemId,
            productGroup: splittingUnit.productGroup,
            variantName: splittingUnit.variantName,
            color: child.color || splittingUnit.color,
            factory: splittingUnit.factory,
            receiptCode: splittingUnit.receiptCode,
            skuName: child.sku || splittingUnit.skuName,
            packageType: child.packagingName || splittingUnit.packageType,
            packageLabel: `1 ${child.packagingName || splittingUnit.packageType} (${fmt(child.initialQuantity)} ${child.baseUnit || splittingUnit.unitName})`,
            unitName: child.baseUnit || splittingUnit.unitName,
            status: "Nguyên niêm phong",
            location,
            initialPcs: Number(child.initialQuantity || 0),
            currentPcs: Number(child.remainingQuantity || 0),
            parentUnitCode: splittingUnit.id,
            updatedAt: child.updatedAt,
          };
        },
      );

      setDetail(null);
      setSplittingUnit(null);
      await loadWorkspace(true);
      message.success(
        `Đã tách ${splittingUnit.id} thành ${createdChildren.length} kiện con. Tổng tồn SKU không thay đổi.`,
      );
      if (createdChildren.length) {
        handlePrintLabels(createdChildren, printLabelSize);
      }
    } catch (error: any) {
      message.error(error?.message || "Không thể tách kiện.");
    } finally {
      setIsSplittingUnit(false);
    }
  };

  const unitHasWithdrawalHistory = (unit: UnitRow) =>
    Boolean(unit.hasWithdrawalHistory) || workspace.recentTransactions.some(
      (item) =>
        String(item?.unitId || "").toUpperCase() === unit.id.toUpperCase() &&
        isWithdrawalTransaction(item),
    );

  const handleDeleteUnit = (unit: UnitRow) => {
    if (!isAdmin) return;
    const hasQuantityChanges = unit.currentPcs !== unit.initialPcs;
    const hasWithdrawalHistory = unitHasWithdrawalHistory(unit);
    const lockedForNonAdmin = !isAdmin && hasWithdrawalHistory;
    AntModal.confirm({
      title: `Xóa kiện ${unit.id}?`,
      icon: <DeleteOutlined style={{ color: "#dc2626" }} />,
      content: lockedForNonAdmin
        ? "Kiện đã có lịch sử rút hàng. Chỉ tài khoản admin mới có quyền xóa kiện này."
        : hasQuantityChanges
        ? "Kiện đã phát sinh biến động số lượng nên không thể xóa. Hãy giữ kiện để bảo toàn lịch sử kho."
        : "Kiện sẽ bị xóa khỏi danh sách quản lý. Thao tác này vẫn được ghi lại trong lịch sử hệ thống.",
      okText: "Xóa kiện",
      okButtonProps: { danger: true, disabled: hasQuantityChanges || lockedForNonAdmin },
      cancelText: "Hủy",
      centered: true,
      async onOk() {
        if (hasQuantityChanges || lockedForNonAdmin) return;
        setDeletingUnitCode(unit.id);
        try {
          const result = await window.electronAPI?.handlingUnits?.deleteUnit({
            code: unit.id,
            reason: "Xóa kiện tạo nhầm từ màn Quản lý kiện hàng",
          });
          if (!result?.success) {
            throw new Error(result?.error || "Không thể xóa kiện.");
          }
          setWorkspace((previous) => ({
            ...previous,
            register: previous.register.filter((item) => item.id !== unit.id),
          }));
          setDetail((current) => (current?.id === unit.id ? null : current));
          message.success(`Đã xóa kiện ${unit.id}.`);
        } catch (error: any) {
          message.error(error?.message || "Không thể xóa kiện.");
          throw error;
        } finally {
          setDeletingUnitCode("");
        }
      },
    });
  };

  const getTransferCandidates = (source: UnitRow) => workspace.register.filter(unit =>
    unit.skuName.trim().toUpperCase() === source.skuName.trim().toUpperCase()
    && normalizeUnitName(unit.unitName) === normalizeUnitName(source.unitName)
    && (unit.status === "Đang sử dụng" || (unit.status === "Nguyên niêm phong" && getPackageCategory(unit.packageType) === "LE"))
  );

  const getReturnMergeTargets = (source: UnitRow) =>
    workspace.register.filter((candidate) =>
      candidate.id.trim().toUpperCase() !== source.id.trim().toUpperCase()
      && candidate.skuName.trim().toUpperCase() === source.skuName.trim().toUpperCase()
      && (candidate.status === "Đang sử dụng" || (candidate.status === "Nguyên niêm phong" && getPackageCategory(candidate.packageType) === "LE"))
      && !isReturnHandlingUnit(candidate)
      && normalizeUnitName(candidate.unitName) === normalizeUnitName(source.unitName)
      && capacityForUnit(candidate) > Number(candidate.currentPcs || 0)
    );

  const getTransferMaximumQuantity = (source: UnitRow | null, targetCode: string) => {
    if (!source || !targetCode) return 0;
    const target = getReturnMergeTargets(source).find(unit => unit.id === targetCode);
    return target
      ? Math.min(Number(source.currentPcs), Math.max(0, capacityForUnit(target) - Number(target.currentPcs)))
      : 0;
  };

  const openMergeReturnUnit = (source: UnitRow) => {
    const pendingConflict = getPendingCheckConflict(source, workspace.register);
    if (pendingConflict) {
      message.warning(pendingCheckBlockText(source, pendingConflict, "chuyển kiện"), 8);
      return;
    }
    const targets = getReturnMergeTargets(source);
    const candidates = getTransferCandidates(source);
    if (!targets.length && candidates.length !== 2) {
      const sameSkuOpened = workspace.register.some((candidate) =>
        candidate.id.trim().toUpperCase() !== source.id.trim().toUpperCase()
        && candidate.skuName.trim().toUpperCase() === source.skuName.trim().toUpperCase()
        && (candidate.status === "Đang sử dụng" || (candidate.status === "Nguyên niêm phong" && getPackageCategory(candidate.packageType) === "LE"))
        && !isReturnHandlingUnit(candidate)
      );
      message.warning(
        sameSkuOpened
          ? `SKU ${source.skuName} có kiện đang khui nhưng khác đơn vị ${source.unitName} hoặc đã hết sức chứa. Hãy chọn kiện đích phù hợp rồi thử chuyển lại.`
          : `SKU ${source.skuName} chưa có kiện lẻ hoặc kiện đã khui còn sức chứa. Kiện nguyên phải khui trước; kiện đích không vượt số lượng ban đầu và tối đa 300.`,
      );
      return;
    }
    setMergeReturnUnit(source);
    setMergeTargetCode(candidates.length === 2 ? candidates.find(unit => unit.id !== source.id)?.id || "" : "");
    setMergeQuantity(null);
    mergeReturnOperationKeyRef.current = `merge-return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const handleMergeReturnUnit = async () => {
    if (!mergeReturnUnit || !mergeTargetCode || !Number.isSafeInteger(mergeQuantity) || !mergeQuantity || isMergingReturnUnit) return;
    const target = getReturnMergeTargets(mergeReturnUnit).find(unit => unit.id === mergeTargetCode);
    if (!target) {
      message.warning("Kiện đích không còn hợp lệ. Vui lòng chọn lại.");
      return;
    }
    if (mergeQuantity > getTransferMaximumQuantity(mergeReturnUnit, mergeTargetCode)) {
      message.warning("Số lượng chuyển vượt tồn kiện nguồn hoặc sức chứa kiện nhận.");
      return;
    }
    setIsMergingReturnUnit(true);
    try {
      const result = await window.electronAPI?.handlingUnits?.mergeReturnUnit?.({
        sourceCode: mergeReturnUnit.id,
        targetCode: target.id,
        quantity: mergeQuantity,
        idempotencyKey: mergeReturnOperationKeyRef.current,
      });
      if (!result?.success) throw new Error(result?.error || "Không thể chuyển kiện.");

      message.success(`Đã chuyển ${fmt(mergeQuantity)} ${mergeReturnUnit.unitName} từ ${mergeReturnUnit.id} sang ${target.id}.`);
      setMergeReturnUnit(null);
      setMergeTargetCode("");
      setMergeQuantity(null);
      setDetail(null);
      await loadWorkspace(true);
    } catch (error: any) {
      message.error(error?.message || "Không thể chuyển kiện.");
    } finally {
      setIsMergingReturnUnit(false);
    }
  };

  const openFinalCheck = (unit: UnitRow) => {
    setCheckingUnit(unit);
    finalCheckForm.resetFields();
    finalCheckForm.setFieldsValue({ finalVerification: "MATCH" });
    setShowFinalCheckModal(true);
  };

  const handleFinalCheckSubmit = async () => {
    if (isFinalizingCheckRef.current || !checkingUnit) return;
    isFinalizingCheckRef.current = true;
    setIsFinalizingCheck(true);
    try {
      const values = await finalCheckForm.validateFields();
      const isMatched = values.finalVerification === "MATCH";
      const actualQuantity = isMatched
        ? 0
        : Number(values.actualQuantity);
      if (!isMatched && actualQuantity <= 0) {
        throw new Error("Nếu thực tế còn 0, hãy chọn Khớp để chốt hết kiện.");
      }
      const res = await window.electronAPI?.handlingUnits?.finalizePick({
        code: checkingUnit.id,
        actualQuantity,
        destination: "PACKING",
        note: values.note,
        idempotencyKey: `HU-FINAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      if (!res?.success) throw new Error(res?.error || "Không thể chốt kiểm kiện.");
      setWorkspace((prev) => ({
        ...prev,
        register: prev.register.map((unit) =>
          unit.id === checkingUnit.id
            ? {
                ...unit,
                currentPcs: actualQuantity,
                status: actualQuantity > 0 ? "Đang sử dụng" : "Đã hết",
              }
            : unit,
        ),
      }));
      setDetail((current) =>
        current?.id === checkingUnit.id
          ? {
              ...current,
              currentPcs: actualQuantity,
              status: actualQuantity > 0 ? "Đang sử dụng" : "Đã hết",
            }
          : current,
      );
      message.success(
        actualQuantity > 0
          ? `Đã cập nhật kiện ${checkingUnit.id} còn thực tế ${fmt(actualQuantity)} ${checkingUnit.unitName}.`
          : `Đã kiểm và chốt hết kiện ${checkingUnit.id}.`,
      );
      setShowFinalCheckModal(false);
      setCheckingUnit(null);
    } catch (err: any) {
      if (!err?.errorFields) message.error(err?.message || "Không thể chốt kiểm kiện.");
    } finally {
      isFinalizingCheckRef.current = false;
      setIsFinalizingCheck(false);
    }
  };

  const filteredLocations = useMemo(() => {
    const term = locationSearch.trim().toLowerCase();
    if (!term) return workspace.locations;
    return workspace.locations.filter(
      (l) =>
        l.code.toLowerCase().includes(term) ||
        l.name.toLowerCase().includes(term) ||
        (l.description && l.description.toLowerCase().includes(term)),
    );
  }, [workspace.locations, locationSearch]);

  const activeLocation = useMemo(() => {
    return (
      workspace.locations.find((l) => l.code === selectedLocationCode) ||
      workspace.locations[0]
    );
  }, [workspace.locations, selectedLocationCode]);

  const unitsInActiveLocation = useMemo(() => {
    if (!activeLocation) return [];
    return workspace.register.filter(
      (u) => u.location?.zone === activeLocation.code,
    );
  }, [workspace.register, activeLocation]);

  const totalPcsInActiveLocation = useMemo(() => {
    return unitsInActiveLocation.reduce((sum, u) => sum + u.currentPcs, 0);
  }, [unitsInActiveLocation]);

  const skusInActiveLocation = useMemo(() => {
    const skuSet = new Set(unitsInActiveLocation.map((u) => u.skuName));
    return Array.from(skuSet);
  }, [unitsInActiveLocation]);

  const handleAddLocation = async () => {
    try {
      const values = await addLocationForm.validateFields();
      const code = String(values.code || "")
        .trim()
        .toUpperCase();
      const name = String(values.name || "").trim();
      if (workspace.locations.some((l) => l.code.toUpperCase() === code)) {
        throw new Error(`Mã khu vực "${code}" đã tồn tại trong danh sách.`);
      }
      const newLoc: LocationItem = {
        id: Date.now(),
        code,
        name,
        type: values.type || "STORAGE",
        description: values.description || "",
        isActive: true,
      };
      setWorkspace((prev) => ({
        ...prev,
        locations: [...prev.locations, newLoc],
      }));
      message.success(`Đã thêm khu vực ${code} (${name}) thành công!`);
      addLocationForm.resetFields();
      setShowAddLocationModal(false);
      setSelectedLocationCode(code);
    } catch (err: any) {
      if (!err?.errorFields) {
        message.error(err?.message || "Không thể tạo khu vực.");
      }
    }
  };

  const handleMoveUnitSubmit = async () => {
    try {
      const values = await moveLocationForm.validateFields();
      if (!movingUnit) return;
      const targetZone = values.targetZone;
      const targetRack = values.targetRack || "";
      const prevZone = movingUnit.location?.zone || "Chưa phân khu";

      setWorkspace((prev) => ({
        ...prev,
        register: prev.register.map((unit) =>
          unit.id === movingUnit.id
            ? {
                ...unit,
                location: {
                  zone: targetZone,
                  rack: targetRack || unit.location?.rack,
                },
              }
            : unit,
        ),
        recentTransactions: [
          {
            id: `TR-${Date.now()}`,
            unitId: movingUnit.id,
            createdAt: new Date().toISOString(),
            type: "Chuyển vị trí",
            quantity: 0,
            note: `Điều chuyển từ khu vực ${prevZone} sang ${targetZone}${targetRack ? ` (${targetRack})` : ""}`,
          },
          ...prev.recentTransactions,
        ],
      }));

      message.success(
        `Đã chuyển kiện ${movingUnit.id} sang khu vực ${targetZone}!`,
      );
      setMovingUnit(null);
      moveLocationForm.resetFields();
    } catch (err: any) {
      if (!err?.errorFields) {
        message.error(err?.message || "Không thể chuyển vị trí kiện.");
      }
    }
  };

  const openEditUnit = (unit: UnitRow) => {
    setEditingUnit(unit);
    editUnitForm.setFieldsValue({
      packagingName: unit.packageType,
      initialQuantity: unit.initialPcs,
      remainingQuantity: unit.currentPcs,
      zone: unit.location?.zone || "A1",
      rack: unit.location?.rack || "",
      note: "",
    });
  };

  const handleEditUnitSubmit = async () => {
    if (!editingUnit || isSavingUnitEdit) return;
    setIsSavingUnitEdit(true);
    try {
      const values = await editUnitForm.validateFields();
      const result = await window.electronAPI?.handlingUnits?.updateUnit({
        code: editingUnit.id,
        packagingName: values.packagingName,
        initialQuantity: Number(values.initialQuantity),
        remainingQuantity: Number(values.remainingQuantity),
        location: { zone: values.zone, rack: values.rack || "" },
        note: values.note,
      });
      if (!result?.success) throw new Error(result?.error || "Không thể cập nhật kiện.");

      const remaining = Number(values.remainingQuantity);
      let nextStatus = editingUnit.status;
      if (remaining === 0 && nextStatus !== "Chờ kiểm") nextStatus = "Đã hết";
      if (remaining > 0 && (nextStatus === "Đã hết" || nextStatus === "Chờ kiểm")) nextStatus = "Đang sử dụng";
      const updatedUnit: UnitRow = {
        ...editingUnit,
        packageType: values.packagingName,
        packageLabel: `1 ${values.packagingName} (${fmt(Number(values.initialQuantity))} ${editingUnit.unitName})`,
        initialPcs: Number(values.initialQuantity),
        currentPcs: remaining,
        status: nextStatus,
        location: { zone: values.zone, rack: values.rack || undefined },
      };

      setWorkspace((previous) => ({
        ...previous,
        register: previous.register.map((unit) => unit.id === updatedUnit.id ? updatedUnit : unit),
      }));
      setDetail(updatedUnit);
      setEditingUnit(null);
      editUnitForm.resetFields();
      message.success(`Đã cập nhật kiện ${updatedUnit.id}.`);
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.message || "Không thể cập nhật kiện.");
    } finally {
      setIsSavingUnitEdit(false);
    }
  };

  const matchingSkus = useMemo(() => {
    const term = normalizeSearch(search);
    if (!term) return workspace.catalog;
    return workspace.catalog.filter((item) => {
      const skuNorm = normalizeSearch(item.sku);
      const nameNorm = normalizeSearch(item.variantName);
      const groupNorm = normalizeSearch(item.productGroup);
      const colorNorm = normalizeSearch(item.color || "");
      return (
        skuNorm.includes(term) ||
        nameNorm.includes(term) ||
        groupNorm.includes(term) ||
        colorNorm.includes(term)
      );
    });
  }, [workspace.catalog, search]);

  const unitsBySku = useMemo(() => {
    const index = new Map<string, UnitRow[]>();
    workspace.register.forEach((unit) => {
      const items = index.get(unit.skuName);
      if (items) items.push(unit);
      else index.set(unit.skuName, [unit]);
    });
    return index;
  }, [workspace.register]);

  const packedBySku = useMemo(() => {
    const totals = new Map<string, number>();
    for (const lot of workspace.packedInventory) for (const component of lot.components) {
      totals.set(component.sku, (totals.get(component.sku) || 0) + Math.max(0, lot.packedQty - (lot.issuedQty || 0)) * component.quantity);
    }
    return totals;
  }, [workspace.packedInventory]);
  const allocationGaps = useMemo(() =>
    workspace.catalog
      .map((item) => {
        const allocated = (unitsBySku.get(item.sku) || []).reduce(
          (total, unit) => total + Math.max(0, Number(unit.currentPcs || 0)),
          0,
        );
        return {
          ...item,
          allocated,
          missingQuantity: Math.max(0, Number(item.stock || 0) - allocated - (packedBySku.get(item.sku) || 0)),
        };
      })
      .filter((item) => item.missingQuantity > 0)
      .sort((a, b) => b.missingQuantity - a.missingQuantity),
  [workspace.catalog, unitsBySku, packedBySku]);
  const allocationGapBySku = useMemo(
    () => new Map(allocationGaps.map((item) => [item.sku, item.missingQuantity])),
    [allocationGaps],
  );
  const unitsByLocation = useMemo(() => {
    const index = new Map<string, UnitRow[]>();
    workspace.register.forEach((unit) => {
      const code = unit.location?.zone || "";
      const items = index.get(code);
      if (items) items.push(unit);
      else index.set(code, [unit]);
    });
    return index;
  }, [workspace.register]);

  const openedUnitBySkuAndCategory = useMemo(() => {
    const index = new Map<string, UnitRow>();
    workspace.register.forEach((unit) => {
      if (unit.status !== "Đang sử dụng" && unit.status !== "Chờ kiểm") return;
      const category = getPackageCategory(unit.packageType);
      if (category === "LE") return;
      const key = `${unit.skuName.toUpperCase()}::${category}`;
      if (!index.has(key)) index.set(key, unit);
    });
    return index;
  }, [workspace.register]);

  const getIndexedConflict = (unit: UnitRow) => {
    const pendingConflict = workspace.register.find((candidate) =>
      candidate.id.toUpperCase() !== unit.id.toUpperCase()
      && candidate.skuName.toUpperCase() === unit.skuName.toUpperCase()
      && candidate.status === "Chờ kiểm",
    );
    if (pendingConflict) return pendingConflict;
    const category = getPackageCategory(unit.packageType);
    if (category === "LE") return null;
    const conflict = openedUnitBySkuAndCategory.get(
      `${unit.skuName.toUpperCase()}::${category}`,
    );
    return conflict && conflict.id.toUpperCase() !== unit.id.toUpperCase()
      ? conflict
      : null;
  };

  // Nhóm SKU theo productGroup: Cha → Con (màu)
  const skuGroups = useMemo(() => {
    const groups: Array<{
      groupName: string;
      children: typeof matchingSkus;
      withdrawnQuantity: number;
      lastWithdrawalAt: number;
    }> = [];
    const skuByUnitCode = new Map(
      workspace.register.map((unit) => [
        unit.id.trim().toUpperCase(),
        unit.skuName,
      ]),
    );
    const withdrawnBySku = new Map<string, number>();
    const lastWithdrawalBySku = new Map<string, number>();
    workspace.recentTransactions.forEach((transaction) => {
      if (!isWithdrawalTransaction(transaction)) return;
      const sku = String(
        transaction?.sku ||
          skuByUnitCode.get(
            String(transaction?.unitId || "").trim().toUpperCase(),
          ) ||
          "",
      ).trim();
      if (!sku) return;
      withdrawnBySku.set(
        sku,
        (withdrawnBySku.get(sku) || 0) +
          Math.abs(Number(transaction?.quantity || 0)),
      );
      lastWithdrawalBySku.set(
        sku,
        Math.max(
          lastWithdrawalBySku.get(sku) || 0,
          new Date(transaction?.createdAt || 0).getTime() || 0,
        ),
      );
    });
    const map = new Map<string, typeof matchingSkus>();
    matchingSkus.forEach((item) => {
      const key = item.productGroup || "Khác";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    map.forEach((children, groupName) => {
      const sortedChildren = [...children].sort((a, b) => {
        const quantityDifference =
          (withdrawnBySku.get(b.sku) || 0) -
          (withdrawnBySku.get(a.sku) || 0);
        if (quantityDifference !== 0) return quantityDifference;
        const recencyDifference =
          (lastWithdrawalBySku.get(b.sku) || 0) -
          (lastWithdrawalBySku.get(a.sku) || 0);
        if (recencyDifference !== 0) return recencyDifference;
        return a.sku.localeCompare(b.sku, "vi", { numeric: true, sensitivity: "base" });
      });
      groups.push({
        groupName,
        children: sortedChildren,
        withdrawnQuantity: sortedChildren.reduce(
          (total, item) => total + (withdrawnBySku.get(item.sku) || 0),
          0,
        ),
        lastWithdrawalAt: sortedChildren.reduce(
          (latest, item) => Math.max(latest, lastWithdrawalBySku.get(item.sku) || 0),
          0,
        ),
      });
    });
    return groups.sort((a, b) => {
      const quantityDifference = b.withdrawnQuantity - a.withdrawnQuantity;
      if (quantityDifference !== 0) return quantityDifference;
      const recencyDifference = b.lastWithdrawalAt - a.lastWithdrawalAt;
      if (recencyDifference !== 0) return recencyDifference;
      return a.groupName.localeCompare(b.groupName, "vi", { numeric: true, sensitivity: "base" });
    });
  }, [matchingSkus, workspace.register, workspace.recentTransactions]);

  const toggleGroup = (groupName: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const chooseSku = (sku: string) => {
    setSelectedSku(sku);
    // Tự mở nhóm cha khi chọn SKU
    const parentGroup = workspace.catalog.find(
      (c) => c.sku === sku,
    )?.productGroup;
    if (parentGroup) {
      setOpenGroups((prev) => ({ ...prev, [parentGroup]: true }));
    }
  };

  const selected = useMemo(() => {
    if (matchingSkus.length === 0) return null;
    const found = matchingSkus.find((item) => item.sku === selectedSku);
    return found || matchingSkus[0];
  }, [matchingSkus, selectedSku]);
  const selectedUnits = useMemo(
    () => (selected ? unitsBySku.get(selected.sku) || [] : []),
    [selected, unitsBySku],
  );
  const orderedSelectedUnits = useMemo(() => {
    const pickView = (unit: UnitRow) => ({ code: unit.id, quantity: unit.currentPcs, createdAt: unit.createdAt,
      status: unit.status === "Đang sử dụng" ? "opened" : unit.status === "Nguyên niêm phong" ? "sealed" : unit.status });
    return [...selectedUnits].sort((a, b) => compareHandlingUnitPickOrder(pickView(a), pickView(b)));
  }, [selectedUnits]);
  const activeSelectedUnits = useMemo(
    () => orderedSelectedUnits.filter(
      (unit) => unit.status !== "Đã hết" && unit.status !== "Đã tách",
    ),
    [orderedSelectedUnits],
  );
  const displaySequenceByUnitId = useMemo(() => {
    // Show a compact pick queue; completed or split history must not leave
    // gaps such as 1, 3 in the active warehouse view.
    return new Map(activeSelectedUnits.map((unit, index) => [unit.id, index + 1] as const));
  }, [activeSelectedUnits]);
  const selectedStats = useMemo(
    () =>
      selectedUnits.reduce(
        (stats, unit) => {
          stats.allocated += unit.currentPcs;
          if (unit.status === "Nguyên niêm phong") stats.sealed += 1;
          else if (unit.status === "Đang sử dụng") stats.opened += 1;
          else if (unit.status === "Chờ kiểm") stats.pendingCheck += 1;
          else if (unit.status === "Đã hết") stats.empty += 1;
          else if (unit.status === "Đã tách") stats.split += 1;
          return stats;
        },
        { allocated: 0, sealed: 0, opened: 0, pendingCheck: 0, empty: 0, split: 0 },
      ),
    [selectedUnits],
  );
  const sealedCount = selectedStats.sealed;
  const openedCount = selectedStats.opened;
  const pendingCheckCount = selectedStats.pendingCheck;
  const emptyCount = selectedStats.empty;
  const splitCount = selectedStats.split;
  const activeSequenceCount = activeSelectedUnits.length;

  const displayedUnits = useMemo(() => {
    if (statusFilter === "all")
      return orderedSelectedUnits.filter((u) => u.status !== "Đã hết");
    return orderedSelectedUnits.filter((u) => u.status === statusFilter);
  }, [orderedSelectedUnits, statusFilter]);

  useEffect(() => {
    setVisibleUnitLimit(100);
  }, [selected?.sku, statusFilter]);

  const visibleUnits = useMemo(
    () => displayedUnits.slice(0, visibleUnitLimit),
    [displayedUnits, visibleUnitLimit],
  );

  const selectedSkuTransactions = useMemo(() => {
    return ledgerHistory;
  }, [ledgerHistory]);

  useEffect(() => {
    let cancelled = false;
    const sku = String(selected?.sku || "").trim();
    if (!sku || activeModuleTab !== "history") return undefined;
    setLedgerHistoryLoading(true);
    void window.electronAPI.inventoryLogs.getBySku({ sku, limit: 500 })
      .then((result) => {
        if (!cancelled) setLedgerHistory(result.success && Array.isArray(result.data) ? result.data : []);
      })
      .catch(() => { if (!cancelled) setLedgerHistory([]); })
      .finally(() => { if (!cancelled) setLedgerHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.sku, activeModuleTab]);

  const historyTypes = useMemo(
    () =>
      [...new Set(selectedSkuTransactions.map((item) => String(item.referenceType || item.type || "Hoạt động khác")))].sort(),
    [selectedSkuTransactions],
  );

  useEffect(() => {
    setHistoryType("all");
  }, [selected?.sku]);

  const selectedSkuHistory = useMemo(() => {
    const term = normalizeSearch(historySearch);
    const fromTime = historyFromDate ? new Date(`${historyFromDate}T00:00:00`).getTime() : 0;
    const toTime = historyToDate ? new Date(`${historyToDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return selectedSkuTransactions
      .filter((item) => {
        const createdAt = new Date(item.createdAt || 0).getTime();
        const content = normalizeSearch(
          [item.unitId, item.sku, item.type, item.referenceType, item.reference, item.note, item.actor, item.destination]
            .filter(Boolean)
            .join(" "),
        );
        return (
          (!term || content.includes(term)) &&
          (historyType === "all" || (item.referenceType || item.type) === historyType) &&
          createdAt >= fromTime &&
          createdAt <= toTime
        );
      })
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [selectedSkuTransactions, historySearch, historyType, historyFromDate, historyToDate]);

  // Index history once instead of re-scanning every transaction for every
  // handling unit when calculating the end-of-shift checklist.
  const transactionsByUnitId = useMemo(() => {
    const index = new Map<string, any[]>();
    workspace.recentTransactions.forEach((transaction) => {
      const code = String(transaction?.unitId || "").trim().toUpperCase();
      if (!code) return;
      const entries = index.get(code);
      if (entries) entries.push(transaction);
      else index.set(code, [transaction]);
    });
    return index;
  }, [workspace.recentTransactions]);

  const shiftCheckCandidates = useMemo<ShiftCheckCandidate[]>(() => {
    const todayKey = workspace.shiftCheckPolicy?.date || localDayKey(new Date());
    const outstanding = new Map((workspace.shiftCheckPolicy?.outstanding || []).map((entry) => [entry.code, entry]));
    const packedCandidates: ShiftCheckCandidate[] = workspace.packedInventory.flatMap(lot => {
      const code = `PACKED:${lot.assignmentId}`.toUpperCase();
      const duty = outstanding.get(code);
      if (!duty) return [];
      return [{ packed: true, unit: { id: code, skuName: lot.components.map(component => `${component.quantity} ${component.sku}`).join(' + '), variantName: lot.code, packageType: 'Combo đóng sẵn', unitName: 'combo', status: 'Đóng sẵn', initialPcs: 100000, currentPcs: Math.max(0, lot.packedQty - (lot.issuedQty || 0)), updatedAt: lot.updatedAt }, withdrawalCount: 0, withdrawnQuantity: 0, lastWithdrawalAt: new Date(duty.requiredAt).getTime() }];
    });
    return workspace.register
      .map((unit) => {
        if (unit.status === "Đã tách" || unit.status === "split") return null;
        const code = unit.id.trim().toUpperCase();
        const obligation = outstanding.get(code);
        const history = transactionsByUnitId.get(unit.id.trim().toUpperCase()) || [];
        const isPendingCheck = unit.status === "Chờ kiểm" || unit.status === "pending_check";
        const obligationRequiredToday = Boolean(
          obligation && obligation.date === todayKey,
        );
        const latestCompletedCheck = history
          .filter(isCompletedCheckTransaction)
          .reduce(
            (latest, item) =>
              Math.max(latest, new Date(item.createdAt || 0).getTime() || 0),
            0,
          );
        const withdrawals = history.filter((item) => {
          const createdAt = new Date(item.createdAt || 0).getTime() || 0;
          return (
            isWithdrawalTransaction(item) &&
            createdAt > latestCompletedCheck &&
            (isPendingCheck || localDayKey(item.createdAt) === todayKey)
          );
        });
        // A pending package remains actionable across day boundaries. The old
        // today-only filter made carried-over pending packages disappear from
        // the end-of-shift badge even though they still blocked the same SKU.
        // A package that the TMDT physical allocation has depleted is already
        // verified at zero. Historical tracking must not resurrect it in the
        // end-of-shift checklist; only an outstanding duty or a new movement
        // can make it actionable again.
        if ((unit.status === "Đã hết" || unit.status === "empty") && !obligation) return null;
        // An opened package that was left unchecked on an older day must not
        // keep resurfacing as a fresh check every morning. A new withdrawal
        // creates a new obligation with today's requiredAt; pending packages
        // remain visible until they are explicitly finalized.
        if (!isPendingCheck && !obligationRequiredToday && withdrawals.length === 0) return null;
        return {
          unit,
          withdrawalCount: withdrawals.length,
          withdrawnQuantity: withdrawals.reduce(
            (total, item) => total + Math.abs(Number(item.quantity || 0)),
            0,
          ),
          lastWithdrawalAt: withdrawals.reduce(
            (latest, item) =>
              Math.max(latest, new Date(item.createdAt || 0).getTime() || 0),
            obligation ? new Date(obligation.requiredAt).getTime() : isPendingCheck ? new Date(unit.updatedAt || 0).getTime() || 0 : 0,
          ),
        };
      })
      .filter((item): item is ShiftCheckCandidate => Boolean(item))
      .concat(packedCandidates)
      .sort((a, b) => b.lastWithdrawalAt - a.lastWithdrawalAt);
  }, [workspace.register, workspace.packedInventory, workspace.shiftCheckPolicy, transactionsByUnitId]);

  const mandatoryShiftCheckCandidates = useMemo(
    () => shiftCheckCandidates.filter(({ unit }) => unit.status === "Chờ kiểm" || unit.status === "pending_check"),
    [shiftCheckCandidates],
  );

  const scopedShiftCheckCandidates = shiftCheckScope === "mandatory"
    ? mandatoryShiftCheckCandidates
    : shiftCheckCandidates;
  const visibleShiftCheckCandidates = (shiftCheckFocusCode
    ? scopedShiftCheckCandidates.filter(({ unit }) => unit.id === shiftCheckFocusCode)
    : scopedShiftCheckCandidates
  ).slice(0, 100);

  const shiftCheckEnteredCount = visibleShiftCheckCandidates.filter(({ unit }) => {
    const actual = shiftCheckDrafts[unit.id]?.actualQuantity;
    return actual !== null && actual !== undefined;
  }).length;
  const canSubmitShiftCheck = visibleShiftCheckCandidates.length > 0 && visibleShiftCheckCandidates.every(({ unit }) => {
    const draft = shiftCheckDrafts[unit.id];
    const actual = draft?.actualQuantity;
    if (actual === null || actual === undefined || !Number.isSafeInteger(actual) || actual < 0 || actual > unit.initialPcs) return false;
    if (actual !== unit.currentPcs && (!draft.reason || (draft.reason === "Khác" && !draft.note.trim()))) return false;
    return true;
  });

  const openShiftCheck = (scope: "all" | "mandatory" = "all") => {
    const candidates = scope === "mandatory"
      ? mandatoryShiftCheckCandidates
      : shiftCheckCandidates;
    if (candidates.length === 0) {
      message.info(
        scope === "mandatory"
          ? "Không có kiện nào đang chờ kiểm."
          : "Hôm nay không có kiện nào phát sinh rút hàng cần kiểm.",
      );
      return;
    }
    setShiftCheckScope(scope);
    setShiftCheckFocusCode(null);
    setShiftCheckDrafts(
      Object.fromEntries(
        candidates.map(({ unit }) => [
          unit.id,
          // The expected balance is reference-only. Never prefill the physical count.
          { actualQuantity: null, reason: "", note: "" },
        ]),
      ),
    );
    shiftCheckRequestIdRef.current = `HU-SHIFT-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    setShowShiftCheckModal(true);
  };

  const openShiftCheckForUnit = (unit: UnitRow) => {
    const candidate = shiftCheckCandidates.find((entry) => entry.unit.id === unit.id);
    if (!candidate) {
      message.info("Kiện này hiện chưa phát sinh nghĩa vụ kiểm cuối ca.");
      return;
    }
    setShiftCheckScope("all");
    setShiftCheckFocusCode(unit.id);
    shiftCheckRequestIdRef.current = `HU-SHIFT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setShiftCheckDrafts({
      // Require the assignee to count this package instead of confirming the software balance.
      [unit.id]: { actualQuantity: null, reason: "", note: "" },
    });
    setShowShiftCheckModal(true);
  };

  const updateShiftCheckDraft = (
    code: string,
    patch: Partial<ShiftCheckDraft>,
  ) => {
    setShiftCheckDrafts((previous) => ({
      ...previous,
      [code]: { ...previous[code], ...patch },
    }));
  };

  const submitShiftCheck = async () => {
    if (isSubmittingShiftCheck) return;
    try {
      const items = visibleShiftCheckCandidates.map(({ unit }) => {
        const draft = shiftCheckDrafts[unit.id];
        if (draft?.actualQuantity === null || draft?.actualQuantity === undefined) {
          throw new Error(`Hãy nhập tồn thực tế của kiện ${unit.id}.`);
        }
        const actualQuantity = Number(draft?.actualQuantity);
        if (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0) {
          throw new Error(`Hãy nhập tồn thực tế của kiện ${unit.id}.`);
        }
        if (actualQuantity > unit.initialPcs) {
          throw new Error(
            `Tồn thực tế kiện ${unit.id} không thể lớn hơn ${fmt(unit.initialPcs)}.`,
          );
        }
        const variance = actualQuantity - unit.currentPcs;
        if (variance !== 0 && !draft?.reason) {
          throw new Error(`Hãy chọn lý do chênh lệch của kiện ${unit.id}.`);
        }
        if (variance !== 0 && draft.reason === "Khác" && !draft.note.trim()) {
          throw new Error(`Hãy nhập ghi chú cho kiện ${unit.id}.`);
        }
        return {
          code: unit.id,
          expectedQuantity: unit.currentPcs,
          expectedUpdatedAt: unit.id.startsWith('PACKED:') ? unit.updatedAt : undefined,
          actualQuantity,
          reason: draft?.reason || "",
          note: draft?.note || "",
        };
      });

      setIsSubmittingShiftCheck(true);
      const response = await window.electronAPI?.handlingUnits?.finalizeShiftCheck({
        items,
        idempotencyKey: shiftCheckRequestIdRef.current,
      });
      if (!response?.success) {
        throw new Error(response?.error || "Không thể hoàn tất kiểm cuối ca.");
      }
      if (response.data?.duplicate) return;
      const resultByCode = new Map(
        (response.data?.items || []).map((item: any) => [item.code, item]),
      );
      setWorkspace((previous) => ({
        ...previous,
        register: previous.register.map((unit) => {
          const result: any = resultByCode.get(unit.id);
          if (!result) return unit;
          return {
            ...unit,
            currentPcs: result.actualQuantity,
            status: result.actualQuantity === 0 ? "Đã hết" : "Đang sử dụng",
          };
        }),
      }));
      const varianceCount = items.filter(
        (item) => item.actualQuantity !== item.expectedQuantity,
      ).length;
      message.success(
        varianceCount > 0
          ? `Đã kiểm ${items.length} kiện; ghi nhận ${varianceCount} kiện chênh lệch.`
          : `Đã kiểm khớp ${items.length} kiện cuối ca.`,
      );
      setShowShiftCheckModal(false);
      setShiftCheckDrafts({});
      setShiftCheckFocusCode(null);
      void loadWorkspace(true);
    } catch (error: any) {
      message.error(error?.message || "Không thể hoàn tất kiểm cuối ca.");
    } finally {
      setIsSubmittingShiftCheck(false);
    }
  };

  const watchAllocSku = Form.useWatch("sku", allocationForm);
  const watchAllocMethod =
    Form.useWatch("packageMethod", allocationForm) || "TAI";
  const watchAllocCount = Form.useWatch("packageCount", allocationForm) ?? 1;
  const watchAllocFactor =
    Form.useWatch("conversionFactor", allocationForm) ?? 1200;
  const watchAllocLooseQty = Form.useWatch("looseQty", allocationForm) ?? 50;

  const currentAllocProduct = useMemo(() => {
    const targetSku = watchAllocSku || selected?.sku;
    return (
      workspace.catalog.find((c) => c.sku === targetSku) ||
      selected ||
      workspace.catalog[0]
    );
  }, [workspace.catalog, watchAllocSku, selected]);

  const currentAllocSpec = useMemo(
    () => latestPackagingSpec(
      workspace.packagingSpecs,
      currentAllocProduct?.sku,
      watchAllocMethod,
    ),
    [workspace.packagingSpecs, currentAllocProduct?.sku, watchAllocMethod],
  );
  const currentAllocUnitName = String(
    normalizeUnitName(currentAllocProduct?.unitName).includes("hop")
      ? currentAllocProduct?.unitName
      : currentAllocSpec?.baseUnit || currentAllocProduct?.unitName || "Gói",
  ).trim() || "Gói";

  const currentAllocAllocated = useMemo(() => {
    if (!currentAllocProduct) return 0;
    return (packedBySku.get(currentAllocProduct.sku) || 0) + (unitsBySku.get(currentAllocProduct.sku) || []).reduce(
      (sum, unit) => sum + unit.currentPcs,
      0,
    );
  }, [currentAllocProduct, unitsBySku, packedBySku]);

  const currentAllocDifference = useMemo(() => {
    if (!currentAllocProduct) return 0;
    return currentAllocAllocated - Number(currentAllocProduct.stock || 0);
  }, [currentAllocProduct, currentAllocAllocated]);

  const totalCalculatedQuantity = useMemo(() => {
    if (watchAllocMethod === "LE") {
      return Math.max(1, Number(watchAllocLooseQty || 0));
    }
    return (
      Math.max(1, Number(watchAllocCount || 0)) *
      Math.max(1, Number(watchAllocFactor || 0))
    );
  }, [watchAllocMethod, watchAllocCount, watchAllocFactor, watchAllocLooseQty]);

  const allocateUnits = async () => {
    try {
      if (isAllocating) return;
      setIsAllocating(true);
      const values = await allocationForm.validateFields();
      const targetSku =
        workspace.catalog.find((c) => c.sku === values.sku) || selected;
      if (!targetSku) throw new Error("Vui lòng chọn mã SKU / sản phẩm.");

      const method = values.packageMethod || "TAI";
      const spec = latestPackagingSpec(workspace.packagingSpecs, targetSku.sku, method);
      const unitName = String(
        normalizeUnitName(targetSku.unitName).includes("hop")
          ? targetSku.unitName
          : spec?.baseUnit || targetSku.unitName || "Gói",
      ).trim() || "Gói";
      const zone = values.zone || "A1";
      const rack = values.rack ? String(values.rack).trim() : "";
      const receiptCode = values.receiptCode
        ? String(values.receiptCode).trim()
        : `PNK-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}`;
      const note = values.note ? String(values.note).trim() : "";

      let created: UnitRow[] = [];
      const unitIdentity = {
        productId: targetSku.productId,
        purchaseOrderId: targetSku.purchaseOrderId,
        purchaseItemId: targetSku.purchaseItemId,
        productGroup: targetSku.productGroup,
        variantName: targetSku.variantName,
        color: targetSku.color,
        factory: targetSku.factory,
      };
      const skuPrefix =
        targetSku.sku
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(2, 6)
          .toUpperCase() || "KN";
      const codePrefix = `KN-${skuPrefix}-`;
      const usedCodes = new Set(
        workspace.register.map((unit) => unit.id.trim().toUpperCase()),
      );
      let nextSequence = 1;
      const nextUnitCode = () => {
        let code = "";
        do {
          code = `${codePrefix}${String(nextSequence).padStart(2, "0")}`;
          nextSequence += 1;
        } while (usedCodes.has(code));
        usedCodes.add(code);
        return code;
      };

      if (method === "TAI") {
        const count = Math.max(1, Number(values.packageCount || 1));
        const factor = Math.max(1, Number(values.conversionFactor || spec?.conversionFactor || 1200));
        created = Array.from({ length: count }, () => {
          return {
            ...unitIdentity,
            id: nextUnitCode(),
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Tải dứa",
            packageLabel: `Tải dứa · ${fmt(factor)} ${unitName}`,
            unitName,
            status: "Nguyên niêm phong",
            location: { zone, rack: rack || undefined },
            initialPcs: factor,
            currentPcs: factor,
            note: note || `Tạo kiện tải từ phiếu ${receiptCode}`,
          };
        });
      } else if (method === "THUNG") {
        const count = Math.max(1, Number(values.packageCount || 1));
        const factor = Math.max(1, Number(values.conversionFactor || spec?.conversionFactor || 50));
        created = Array.from({ length: count }, () => {
          return {
            ...unitIdentity,
            id: nextUnitCode(),
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Thùng carton",
            packageLabel: `Thùng carton · ${fmt(factor)} ${unitName}`,
            unitName,
            status: "Nguyên niêm phong",
            location: { zone, rack: rack || undefined },
            initialPcs: factor,
            currentPcs: factor,
            note: note || `Tạo kiện thùng từ phiếu ${receiptCode}`,
          };
        });
      } else {
        // Hàng lẻ
        const qty = Math.max(1, Number(values.looseQty || 1));
        created = [
          {
            ...unitIdentity,
            id: nextUnitCode(),
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Túi lẻ",
            packageLabel: `Hàng túi lẻ · ${fmt(qty)} ${unitName}`,
            unitName,
            status: "Nguyên niêm phong",
            location: { zone: zone || "Hàng lẻ", rack: rack || undefined },
            initialPcs: qty,
            currentPcs: qty,
            note: note || `Túi hàng lẻ từ phiếu ${receiptCode}`,
          },
        ];
      }

      const totalPcs = created.reduce((s, u) => s + u.currentPcs, 0);
      const nextRegister = [...workspace.register, ...created];

      const createUnits = window.electronAPI?.handlingUnits?.createUnits;
      const saveRegister = window.electronAPI?.handlingUnits?.saveRegister;
      if (!createUnits && !saveRegister) {
        throw new Error("Không kết nối được dịch vụ lưu dữ liệu kiện hàng.");
      }
      const usesIncrementalCreate = Boolean(createUnits);
      const saveResult = createUnits
        ? await createUnits(created)
        : await saveRegister!(nextRegister);
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || "Supabase không lưu được kiện mới.");
      }

      setWorkspace((previous) => ({
        ...previous,
        register: nextRegister,
        recentTransactions: usesIncrementalCreate
          ? previous.recentTransactions
          : [
              ...created.map((u) => ({
                id: `TR-${Date.now()}-${u.id}`,
                unitId: u.id,
                createdAt: new Date().toISOString(),
                type: "Nhập kiện",
                quantity: u.initialPcs,
                note: `Tạo kiện mới ${u.id} (${u.packageLabel}) tại ${zone}`,
              })),
              ...previous.recentTransactions,
            ],
      }));

      message.success(
        `Đã tạo thành công ${created.length} kiện (quy đổi tổng ${fmt(totalPcs)} ${unitName})!`,
      );
      setShowAllocation(false);
      allocationForm.resetFields();
      setPrintUnits(Array.isArray(saveResult.data) ? saveResult.data as UnitRow[] : created);
      void loadWorkspace(true);
    } catch (error: any) {
      if (!error?.errorFields)
        message.error(error?.message || "Không tạo được kiện.");
    } finally {
      setIsAllocating(false);
    }
  };

  const openCreatePackageModal = (targetSku?: string) => {
    const skuToUse = targetSku || selected?.sku || workspace.catalog[0]?.sku;
    const product = workspace.catalog.find((item) => item.sku === skuToUse);
    const spec = latestPackagingSpec(workspace.packagingSpecs, skuToUse);
    const method = normalizeUnitName(product?.unitName).includes("hop")
      ? "THUNG"
      : spec
        ? packagingMethodForSpec(spec)
        : "TAI";
    const methodSpec = latestPackagingSpec(workspace.packagingSpecs, skuToUse, method);
    const factor = methodSpec?.conversionFactor || (method === "THUNG" ? 50 : 1200);

    allocationForm.setFieldsValue({
      sku: skuToUse,
      packageMethod: method,
      packageCount: 1,
      conversionFactor: methodSpec?.conversionFactor || factor,
      looseQty: undefined,
      zone: "A1",
    });
    setShowAllocation(true);
  };

  const openQuickCreate = () => {
    // Quét QR là luồng nhập kiện chính; vẫn giữ thêm thủ công cho kiện lẻ.
    setShowLegacyQrEntry(true);
    quickReceivingOperationKeyRef.current = `quick-receive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setQuickScanLines([]);
    setQuickManualSku(undefined);
    setQuickManualQuantity(undefined);
    setQuickManualSupplierId(undefined);
    setQuickLastCode("");
    setQuickScanError("");
    setQuickReceiptFileName("");
    setQuickReceiptFile(null);
    setQuickCompanyIdBySku({});
    setQuickPriceBySku({});
    void window.electronAPI?.goodsCompanies?.getAll?.().then((result) => {
      if (result?.success) setQuickGoodsCompanies(result.data || []);
    });
    setShowQuickCreate(true);
  };

  const latestQrSuggestion = (sku?: string) => {
    const matches = workspace.packagingSpecs
      .filter((spec) => spec?.sku === sku && spec?.status !== "retired")
      .sort((left, right) => String(left?.lastUsedAt || left?.createdAt || left?.id || "").localeCompare(String(right?.lastUsedAt || right?.createdAt || right?.id || "")));
    return matches[matches.length - 1];
  };

  const openQrSetup = () => {
    void loadWorkspace(true);
    const initialSku = selected?.sku || workspace.catalog[0]?.sku;
    const existingSpec = latestQrSuggestion(initialSku);
    qrSetupForm.setFieldsValue({
      sku: initialSku,
      packagingName: existingSpec?.name || undefined,
      baseUnit: existingSpec?.baseUnit || selected?.unitName || "Gói",
      conversionFactor: existingSpec?.conversionFactor || undefined,
      quantity: 1,
      supplierId: existingSpec?.supplierId || undefined,
      zone: existingSpec?.location?.zone || undefined,
    });
    setIssuedQrLabels([]);
    setQrModalTab("create");
    setShowQrSetup(true);
  };

  const qrLabelLocation = (label: any) => {
    const labelZone = String(label?.location?.zone || "").trim();
    if (labelZone && labelZone !== "Chưa phân khu") return label.location;
    const spec = [...workspace.packagingSpecs]
      .reverse()
      .find((candidate) =>
        Number(candidate?.id) === Number(label?.packagingSpecId) ||
        (candidate?.sku === label?.sku &&
          candidate?.name === label?.packagingName &&
          candidate?.baseUnit === label?.baseUnit &&
          Number(candidate?.conversionFactor) === Number(label?.conversionFactor)),
      );
    const specZone = String(spec?.location?.zone || "").trim();
    return specZone && specZone !== "Chưa phân khu" ? spec.location : label?.location;
  };

  const openQrLabelPrint = (label: any, size: "A6" | "A7") => {
    handlePrintLabels([{
      id: label.code,
      sequenceNumber: label.sequenceNumber,
      skuName: label.sku,
      color: label.color,
      packageType: label.packagingName,
      packageLabel: `${label.packagingName} · ${fmt(Number(label.conversionFactor))} ${label.baseUnit}`,
      unitName: label.baseUnit,
      status: "Chờ in",
      initialPcs: Number(label.conversionFactor),
      currentPcs: Number(label.conversionFactor),
      location: qrLabelLocation(label),
      qrPayload: label.code,
    }], size);
  };

  const issueQrLabels = async () => {
    try {
      if (isIssuingQrLabels) return;
      setIsIssuingQrLabels(true);
      const values = await qrSetupForm.validateFields();
      const result = await window.electronAPI?.handlingUnits?.issueQrLabels?.({
        sku: values.sku,
        packagingName: String(values.packagingName || "").trim(),
        baseUnit: String(values.baseUnit || "").trim(),
        conversionFactor: Number(values.conversionFactor),
        quantity: Number(values.quantity),
        supplierId: values.supplierId ? Number(values.supplierId) : undefined,
        location: { zone: String(values.zone || "").trim() },
      });
      if (!result?.success || !result.data) {
        throw new Error(result?.error || "Không thể phát hành tem QR.");
      }
      const labels = result.data.labels || [];
      setIssuedQrLabels(labels);
      setPrintUnits(
        labels.map((label: any) => ({
          id: label.code,
          sequenceNumber: label.sequenceNumber,
          skuName: label.sku,
          color: label.color,
          packageType: label.packagingName,
          packageLabel: `${label.packagingName} · ${fmt(label.conversionFactor)} ${label.baseUnit}`,
          unitName: label.baseUnit,
          status: "Chưa nhập kho",
          initialPcs: Number(label.conversionFactor),
          currentPcs: Number(label.conversionFactor),
          location: qrLabelLocation(label),
          qrPayload: label.code,
        })),
      );
      message.success(`Đã phát hành ${labels.length} tem QR trong lô ${result.data.batchCode}.`);
      void loadWorkspace(true);
    } catch (error: any) {
      if (!error?.errorFields) message.error(error?.message || "Không thể phát hành tem QR.");
    } finally {
      setIsIssuingQrLabels(false);
    }
  };

  const quickQrRegistry = useMemo(
    () => new Map(
      workspace.qrLabels.map((label) => [String(label?.code || "").trim().toUpperCase(), label]),
    ),
    [workspace.qrLabels],
  );

  const clearQuickScanInput = () => {
    const input = quickScanInputRef.current?.input as HTMLInputElement | undefined;
    if (input) input.value = "";
  };

  const addQuickScan = (rawCode?: string) => {
    const input = quickScanInputRef.current?.input as HTMLInputElement | undefined;
    const scannedValue = String(rawCode ?? input?.value ?? "").trim();
    const telegramPayload = scannedValue.match(/[?&]start=khui[_-]([^&]+)/i)?.[1];
    let code = scannedValue;
    if (telegramPayload) {
      try {
        code = decodeURIComponent(telegramPayload).replace(/_/g, "-");
      } catch {}
    }
    if (!code) return;
    if (quickScanLines.some((line) => line.qrCode.toLowerCase() === code.toLowerCase())) {
      setQuickScanError("Mã QR này đã có trong danh sách tạm.");
      playQuickScanSound("fail");
      clearQuickScanInput();
      quickScanInputRef.current?.focus?.();
      return;
    }
    const label = quickQrRegistry.get(code.toUpperCase());
    if (!label) {
      const existingUnit = workspace.register.find(
        (unit) => unit.id.toUpperCase() === code.toUpperCase(),
      );
      setQuickScanError(existingUnit?.status === "Đã tách"
        ? `Kiện ${existingUnit.id} đã được tách thành ${existingUnit.childUnits?.map((child) => child.code).join(", ") || "các kiện nhỏ"}. Mã QR cũ không thể dùng lại.`
        : existingUnit
          ? `Mã QR ${existingUnit.id} đã gắn với kiện trong kho, không thể nhập lại.`
          : `Mã QR “${code}” không hợp lệ, đã dùng hoặc chưa được phát hành.`);
      playQuickScanSound("fail");
      setQuickLastCode("");
      clearQuickScanInput();
      quickScanInputRef.current?.focus?.();
      return;
    }
    const product = workspace.catalog.find((item) => item.sku === label.sku);
    const factor = Math.floor(Number(label.conversionFactor || 0));
    if (!product || !Number.isFinite(factor) || factor <= 0) {
      setQuickScanError(`Mã QR ${label.code} thiếu SKU hoặc quy cách hợp lệ.`);
      playQuickScanSound("fail");
      return;
    }
    if (factor > 300 && label.packagingName !== "Lẻ") {
      setQuickScanError(`Kiện ${label.code} có ${factor} ${label.baseUnit}; tối đa 300. Hãy tách kiện trước khi nhập.`);
      playQuickScanSound("fail");
      return;
    }
    setQuickScanLines((previous) => [
      ...previous,
      {
        id: `${label.code}-${Date.now()}`,
        qrCode: label.code,
        source: "QR",
        sku: product.sku,
        productName: product.variantName,
        loads: 1,
        conversionFactor: factor,
        packagingName: label.packagingName,
        baseUnit: label.baseUnit,
        supplierName: label.supplierName || "",
        supplierId: label.supplierId || null,
        location: label.location,
      },
    ]);
    setQuickPriceBySku((previous) => (
      previous[product.sku] !== undefined
        ? previous
        : { ...previous, [product.sku]: Number(product.cost || 0) }
    ));
    setQuickScanError("");
    setQuickLastCode(label.code);
    clearQuickScanInput();
    playQuickScanSound("success");
    window.setTimeout(() => quickScanInputRef.current?.focus?.(), 0);
  };

  const addQuickManualLine = () => {
    const product = workspace.catalog.find((item) => item.sku === quickManualSku);
    const supplier = workspace.suppliers.find(
      (item: any) => Number(item.id) === Number(quickManualSupplierId),
    );
    const quantity = Math.floor(Number(quickManualQuantity || 0));
    if (!product) {
      message.error("Vui lòng chọn SKU hàng nhập thủ công.");
      return;
    }
    if (quantity <= 0) {
      message.error("Số lượng hàng thủ công phải lớn hơn 0.");
      return;
    }
    if (quantity > 300) {
      message.error("Mỗi kiện tối đa 300. Hãy tách thực tế và thêm riêng từng kiện (ví dụ 300, 300, 300, 100).");
      return;
    }
    if (!supplier) {
      message.error("Vui lòng chọn nhà cung cấp cho hàng nhập thủ công.");
      return;
    }
    setQuickScanLines((previous) => [
      ...previous,
      {
        id: `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        qrCode: "",
        source: "MANUAL",
        sku: product.sku,
        productName: product.variantName,
        loads: 1,
        conversionFactor: quantity,
        packagingName: "Hàng lẻ",
        baseUnit: product.unitName || "đơn vị",
        supplierName: supplier.name,
        supplierId: Number(supplier.id),
      },
    ]);
    setQuickPriceBySku((previous) =>
      previous[product.sku] !== undefined
        ? previous
        : { ...previous, [product.sku]: Number(product.cost || 0) },
    );
    setQuickManualSku(undefined);
    setQuickManualQuantity(undefined);
    message.success(`Đã thêm ${fmt(quantity)} ${product.unitName || "đơn vị"} ${product.variantName}.`);
  };

  const quickQrLines = quickScanLines.filter((line) => line.source !== "MANUAL");
  const quickManualLines = quickScanLines.filter((line) => line.source === "MANUAL");
  const quickLineQuantity = (line: QuickScanLine) => line.loads * line.conversionFactor;
  const quickLoadTotal = quickScanLines.reduce((total, line) => total + line.loads, 0);
  const quickPieceTotal = quickScanLines.reduce(
    (total, line) => total + quickLineQuantity(line),
    0,
  );
  const quickManualSummary = Array.from(
    quickManualLines.reduce((map, line) => {
      map.set(line.baseUnit, (map.get(line.baseUnit) || 0) + quickLineQuantity(line));
      return map;
    }, new Map<string, number>()),
  ).map(([unitName, quantity]) => `${fmt(quantity)} ${unitName}`).join(" + ");
  const quickReceiptRows = Array.from(
    quickScanLines.reduce((map, line) => {
      const key = `${line.supplierId || "none"}:${line.sku}`;
      const current = map.get(key);
      if (current) current.quantity += quickLineQuantity(line);
      else map.set(key, { ...line, quantity: quickLineQuantity(line) });
      return map;
    }, new Map<string, QuickReceiptRow>()).values(),
  );
  const quickSupplierNames = Array.from(
    new Set(quickScanLines.map((line) => line.supplierName).filter(Boolean)),
  );
  const quickBaseUnit =
    Array.from(new Set(quickScanLines.map((line) => line.baseUnit).filter(Boolean))).length === 1
      ? quickScanLines[0]?.baseUnit || "đơn vị cơ sở"
      : "đơn vị cơ sở";

  const quickCompanyForSku = (sku: string) => {
    const productId = workspace.catalog.find((item) => item.sku === sku)?.productId;
    const selectedCompanyId = quickCompanyIdBySku[sku];
    const selectedCompany = selectedCompanyId
      ? quickGoodsCompanies.find((company) => String(company.id) === selectedCompanyId)
      : null;
    if (selectedCompany) return selectedCompany.name;
    return quickGoodsCompanies.find((company) =>
      Array.isArray(company?.productIds) && company.productIds.map(Number).includes(Number(productId)),
    )?.name || "";
  };
  const quickCompanyIdForSku = (sku: string) => {
    if (quickCompanyIdBySku[sku]) return quickCompanyIdBySku[sku];
    const productId = workspace.catalog.find((item) => item.sku === sku)?.productId;
    return String(quickGoodsCompanies.find((company) =>
      Array.isArray(company?.productIds) && company.productIds.map(Number).includes(Number(productId)),
    )?.id || "");
  };
  const quickReceiptCompanyGroups = Array.from(
    quickReceiptRows.reduce((groups, line) => {
      const companyName = quickCompanyForSku(line.sku) || "Chưa gán công ty";
      const rows = groups.get(companyName) || [];
      rows.push(line);
      groups.set(companyName, rows);
      return groups;
    }, new Map<string, QuickReceiptRow[]>()),
  )
    .map(([companyName, rows]) => ({
      companyName,
      rows,
      total: rows.reduce(
        (sum, line) => sum + line.quantity * Number(quickPriceBySku[line.sku] || 0),
        0,
      ),
    }))
    .sort((left, right) => {
      if (left.companyName === "Chưa gán công ty") return 1;
      if (right.companyName === "Chưa gán công ty") return -1;
      return left.companyName.localeCompare(right.companyName, "vi");
    });
  const changeQuickSkuCompany = async (sku: string, companyId: string) => {
    const previousCompanyId = quickCompanyIdForSku(sku);
    setQuickCompanyIdBySku((previous) => ({ ...previous, [sku]: companyId }));
    const productId = workspace.catalog.find((item) => item.sku === sku)?.productId;
    if (!productId) return;
    try {
      const result = await window.electronAPI?.goodsCompanies?.setProductCompany?.({
        productId,
        companyId,
      });
      if (!result?.success) throw new Error(result?.error || "Không thể lưu công ty hàng hóa.");
      const refreshed = await window.electronAPI?.goodsCompanies?.getAll?.();
      if (refreshed?.success) setQuickGoodsCompanies(refreshed.data || []);
      const selectedCompany = quickGoodsCompanies.find(
        (company) => String(company.id) === String(companyId),
      );
      message.success(
        `Đã ghi nhớ công ty ${selectedCompany?.name || "hàng hóa"} cho SKU ${sku}.`,
      );
    } catch (error: any) {
      setQuickCompanyIdBySku((previous) => ({ ...previous, [sku]: previousCompanyId }));
      message.error(error?.message || "Không thể lưu công ty hàng hóa.");
    }
  };
  const quickReceiptTotal = quickReceiptRows.reduce(
    (total, line) => total + line.quantity * Number(quickPriceBySku[line.sku] || 0),
    0,
  );
  const quickFileToBase64 = (file: File) => new Promise<{ fileBase64: string; fileName: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileBase64: String(reader.result || "").split(",")[1] || "", fileName: file.name });
    reader.onerror = () => reject(new Error("Không thể đọc file."));
    reader.readAsDataURL(file);
  });

  const confirmQuickReceiving = async () => {
    if (!quickScanLines.length || !quickReceiptFile) {
      message.error("Cần thêm ít nhất một mặt hàng và tải Phiếu nhập kho.");
      return;
    }
    const missingCompany = quickReceiptRows.find((line) => !quickCompanyForSku(line.sku));
    if (missingCompany) {
      message.error(`SKU ${missingCompany.sku} chưa được gán công ty hàng hóa.`);
      return;
    }
    const missingPrice = quickReceiptRows.find((line) => Number(quickPriceBySku[line.sku] || 0) <= 0);
    if (missingPrice) {
      message.error(`Cần kiểm tra giá nhập cho SKU ${missingPrice.sku} trước khi tạo phiếu.`);
      return;
    }
    const supplierGroups = new Map<number, QuickScanLine[]>();
    for (const line of quickScanLines) {
      if (!line.supplierId) {
        message.error(
          line.source === "MANUAL"
            ? `Hàng thủ công ${line.sku} chưa chọn nhà cung cấp.`
            : `Kiện ${line.qrCode} chưa có nhà cung cấp từ QR.`,
        );
        return;
      }
      const group = supplierGroups.get(line.supplierId) || [];
      group.push(line);
      supplierGroups.set(line.supplierId, group);
    }
    try {
      setIsQuickConfirming(true);
      const receiptFile = await quickFileToBase64(quickReceiptFile);
      const operationBaseKey = quickReceivingOperationKeyRef.current
        || `quick-receive-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      quickReceivingOperationKeyRef.current = operationBaseKey;
      const result = await window.electronAPI?.handlingUnits?.quickReceive?.({
        idempotencyKey: operationBaseKey,
        receiptFile,
        lines: quickScanLines.map((line) => ({
          source: line.source,
          qrCode: line.qrCode,
          sku: line.sku,
          supplierId: line.supplierId,
          quantity: quickLineQuantity(line),
          unitPrice: Number(quickPriceBySku[line.sku]),
          companyGroup: quickCompanyForSku(line.sku),
          packagingName: line.packagingName,
          baseUnit: line.baseUnit,
          conversionFactor: line.conversionFactor,
          location: line.location,
        })),
      });
      if (!result?.success || !result.data) {
        throw new Error(result?.error || "Không thể hoàn tất nhập nhanh.");
      }
      const purchaseCount = result.data.purchases?.length || 0;
      const unitCount = result.data.unitCodes?.length || 0;
      message.success(
        `Đã tạo ${purchaseCount} Phiếu nhập kho${unitCount ? `, ${unitCount} kiện` : ""}${quickManualLines.length ? ` và ${quickManualLines.length} dòng hàng thủ công` : ""}; chứng từ đã lưu trên Cloudflare R2.`,
      );
      setShowQuickCreate(false);
      void loadWorkspace(true);
      const receivedUnits = (result.data as any).units;
      if (Array.isArray(receivedUnits) && receivedUnits.length) {
        handlePrintLabels(receivedUnits.map((unit: any) => ({
          id: unit.code, sequenceNumber: unit.sequenceNumber, skuName: unit.sku,
          color: unit.color,
          packageType: unit.packagingName, unitName: unit.baseUnit,
          initialPcs: unit.initialQuantity, currentPcs: unit.remainingQuantity,
          status: "Nguyên niêm phong",
        })), "A6");
      }
    } catch (error: any) {
      message.error(error?.message || "Không thể xác nhận nhập kho.");
    } finally {
      setIsQuickConfirming(false);
    }
  };

  if (isWorkspaceLoading && !workspaceLoadError) {
    return (
      <main className="hu-home">
        <div className="hu-workspace-loading">
          <img
            className="hu-workspace-loading-logo"
            src="./logo_splash.png"
            alt="DBY Software"
          />
          <span>Đang tải dữ liệu kiện hàng...</span>
          <div className="hu-workspace-loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      </main>
    );
  }

  if (workspaceLoadError && !workspace.catalog.length && !workspace.register.length) {
    return (
      <main className="hu-home">
        <div className="hu-workspace-loading">
          <img className="hu-workspace-loading-logo" src="./logo_splash.png" alt="DBY Software" />
          <span>{workspaceLoadError}</span>
          <Button type="primary" onClick={() => { setWorkspaceLoadError(null); setIsWorkspaceLoading(true); void loadWorkspace(true); }}>
            Thử lại
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="hu-home">
      {workspaceLoadError && <Alert type="warning" showIcon message={workspaceLoadError} description="Đang hiển thị dữ liệu đã tải trước đó." action={<Button onClick={() => void loadWorkspace(true)}>Thử lại</Button>} />}
      <nav className="hu-module-nav" aria-label="Điều hướng quản lý kiện hàng">
        <Flex align="center" gap={8}>
          {onExit ? (
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={onExit}
            >
              Quản lý kho
            </Button>
          ) : null}
          <span>/</span>
          <b>Quản lý kiện hàng</b>
        </Flex>
        <Flex align="center" gap={8}>
          {workspace.shiftCheckPolicy && (
            <Popover
              trigger="click"
              placement="bottomRight"
              title="Phân công kiểm cuối ca"
              content={
                <div style={{ maxWidth: "min(300px, calc(100vw - 48px))" }}>
                  <p><b>Hôm nay:</b> {workspace.shiftCheckPolicy.assignedTo}</p>
                  <p><b>Ngày mai:</b> {workspace.shiftCheckPolicy.nextAssignedTo}</p>
                  <p>Hạn kiểm: <b>23:59</b> (giờ Việt Nam).</p>
                  <p>
                    Tạm thời chưa áp dụng phạt kiểm kiện cuối ca.
                  </p>
                  <Typography.Paragraph type="secondary">
                    Kiện chưa kiểm chuyển sang ngày tiếp theo. Kết quả độc lập với Kiểm hàng trong Quản lý kho.
                  </Typography.Paragraph>
                </div>
              }
            >
              <button
                type="button"
                className="hu-shift-assignee"
                aria-label={`Người phụ trách kiểm cuối ca hôm nay: ${workspace.shiftCheckPolicy.assignedTo}`}
              >
                <span className="hu-shift-assignee-avatar" aria-hidden="true">
                  {workspace.shiftCheckPolicy.assignedTo.trim().charAt(0).toUpperCase()}
                </span>
                <span className="hu-shift-assignee-text">
                  <span className="hu-shift-assignee-label">Phụ trách kiểm</span>
                  <span className="hu-shift-assignee-name">{workspace.shiftCheckPolicy.assignedTo}</span>
                  <span className="hu-shift-assignee-fine">
                    Hạn kiểm 23:59 · Chưa áp dụng phạt
                  </span>
                </span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="hu-shift-assignee-chevron" aria-hidden="true">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </Popover>
          )}
          <Tooltip title="Sơ đồ 2D & quản lý vị trí khu vực kho">
            <Button
              size="small"
              icon={<EnvironmentOutlined style={{ color: "#059669", fontSize: 15 }} />}
              className="hu-nav-btn-location"
              onClick={() => setShowLocations(true)}
            />
          </Tooltip>
        </Flex>
      </nav>
      <section className="hu-browser">
        <aside className="hu-sku-panel">
          <Flex
            justify="space-between"
            align="center"
            className="hu-panel-heading"
          >
            <div>
              <Typography.Title level={5}>Danh mục SKU</Typography.Title>
              <Typography.Text type="secondary">
                {search.trim()
                  ? `Tìm thấy: ${matchingSkus.length}/${workspace.catalog.length} SKU`
                  : `Tổng: ${workspace.catalog.length} SKU`}
              </Typography.Text>
            </div>
            <TagsOutlined />
          </Flex>
          <Input.Search
            className="hu-catalog-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onSearch={(value) => setSearch(value)}
            allowClear
            placeholder="Tìm theo tên, mã SKU, màu sắc..."
          />
          <div className="hu-sku-list">
            {skuGroups.length > 0 ? (
              skuGroups.map((group) => {
                const isOpen =
                  openGroups[group.groupName] ??
                  group.children.some((c) => c.sku === selected?.sku);
                const groupUnitsCount = group.children.reduce(
                  (acc, c) =>
                    acc +
                    (unitsBySku.get(c.sku) || []).length,
                  0,
                );
                const groupUnallocatedCount = group.children.filter(
                  (item) => Number(allocationGapBySku.get(item.sku) || 0) > 0,
                ).length;
                return (
                  <div className="hu-sku-group" key={group.groupName}>
                    <button
                      type="button"
                      className={`hu-sku-group-header ${isOpen ? "is-open" : ""} ${group.children.some(item => item.sku === selected?.sku) ? "is-selected" : ""}`}
                      onClick={() => {
                        toggleGroup(group.groupName);
                      }}
                    >
                      <RightOutlined className="hu-sku-group-arrow" />
                      <span className="hu-sku-group-label">
                        {displayProductGroup(group.groupName)}
                      </span>
                      <span className="hu-sku-group-count">
                        {group.children.length} màu · {groupUnitsCount} kiện
                        {groupUnallocatedCount > 0 && (
                          <Tooltip title={`${groupUnallocatedCount} SKU trong nhóm còn hàng chưa phân kiện`}>
                            <ExclamationCircleFilled className="hu-unallocated-icon" />
                          </Tooltip>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="hu-sku-group-children">
                        {group.children.map((item) => {
                          const unitCount = (unitsBySku.get(item.sku) || [])
                            .length;
                          const colorInfo = getColorDot(item.color, item.sku);
                          const missingQuantity = Number(allocationGapBySku.get(item.sku) || 0);
                          // Each variant is identified by its actual SKU in the catalog.
                          const shortName = item.sku;
                          return (
                            <button
                              type="button"
                              className={`hu-sku-item ${selected?.sku === item.sku ? "is-active" : ""}`}
                              key={item.sku}
                              onClick={() => chooseSku(item.sku)}
                            >
                              <span
                                className="hu-sku-dot"
                                style={{
                                  backgroundColor: colorInfo.dot,
                                  borderColor: colorInfo.border,
                                }}
                              />
                              <div className="hu-sku-content">
                                <div className="hu-sku-name">
                                  <span className="hu-sku-name-text">{shortName}</span>
                                  {missingQuantity > 0 && (
                                    <Tooltip title={`Chưa phân ${fmt(missingQuantity)} ${item.unitName} vào kiện`}>
                                      <ExclamationCircleFilled className="hu-unallocated-icon hu-unallocated-icon-sku" />
                                    </Tooltip>
                                  )}
                                </div>
                                <div className="hu-sku-meta">
                                  <span className="hu-sku-stock">
                                    <b>{fmt(item.stock)}</b> {item.unitName} ·{" "}
                                    {unitCount} kiện
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="hu-sku-search-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span>
                      Không tìm thấy SKU nào cho "<b>{search}</b>"
                    </span>
                  }
                >
                  <Button size="small" onClick={() => setSearch("")}>
                    Xóa tìm kiếm
                  </Button>
                </Empty>
              </div>
            )}
          </div>
        </aside>
        <section className={`hu-selected-panel hu-selected-panel--${activeModuleTab}`}>
          <header className="hu-workspace-heading">
            <div>
              <Typography.Title level={2}>Quản lý kiện hàng</Typography.Title>
            </div>
            {activeModuleTab === "prepack" && (isAdmin || user?.role === "manager") && (
              <Button className="hu-packing-assign" type="primary" icon={<UserAddOutlined />} onClick={() => setPrepackCreateRequest(value => value + 1)}>Giao việc</Button>
            )}
          </header>
          <div className="hu-module-tabs" role="tablist" aria-label="Phân hệ quản lý kiện hàng">
            <button type="button" role="tab" id="hu-tab-units" aria-controls="hu-module-content" aria-selected={activeModuleTab === "units"} className={`hu-module-tab ${activeModuleTab === "units" ? "is-active" : ""}`} onClick={() => { setActiveModuleTab("units"); setHistoryScope("units"); }}>Kiện hàng</button>
            <button type="button" role="tab" id="hu-tab-prepack" aria-controls="hu-module-content" aria-selected={activeModuleTab === "prepack"} className={`hu-module-tab ${activeModuleTab === "prepack" ? "is-active" : ""}`} onClick={() => { setActiveModuleTab("prepack"); setHistoryScope("prepack"); }}>Đóng gói sẵn</button>
            <button type="button" role="tab" id="hu-tab-history" aria-controls="hu-module-content" aria-selected={activeModuleTab === "history"} className={`hu-module-tab ${activeModuleTab === "history" ? "is-active" : ""}`} onClick={() => setActiveModuleTab("history")}>Lịch sử</button>
          </div>
          <div ref={moduleContentRef} className="hu-tab-content" id="hu-module-content" role="tabpanel" aria-labelledby={`hu-tab-${activeModuleTab}`}>
          {activeModuleTab === "history" && <div className="hu-history-scope"><Segmented value={historyScope} onChange={value => setHistoryScope(value as "units" | "prepack")} options={[{ value: "units", label: "Kiện hàng" }, { value: "prepack", label: "Đóng gói sẵn" }]} /></div>}
          {(activeModuleTab === "prepack" || (activeModuleTab === "history" && historyScope === "prepack")) ? (
            <PrepackManagement view={activeModuleTab === "history" ? "history" : "report"} createRequest={prepackCreateRequest} onCreateHandled={() => setPrepackCreateRequest(0)} sourceUnits={workspace.register.map(unit => ({ id: unit.id, skuName: unit.skuName, unitName: unit.unitName, status: unit.status, currentPcs: unit.currentPcs, packageType: unit.packageType }))} productSkus={selected ? workspace.catalog.filter(item => item.productGroup === selected.productGroup).map(item => item.sku) : undefined} />
          ) : selected ? (
            <>
              <header className="hu-selected-header">
                <div className="hu-header-left">
                  <span
                    className="hu-header-color-dot"
                    style={{
                      backgroundColor: getColorDot(selected.color, selected.sku)
                        .dot,
                      borderColor: getColorDot(selected.color, selected.sku)
                        .border,
                    }}
                  />
                  <div className="hu-header-info">
                    <div className="hu-header-title-row">
                      <Typography.Title level={3} className="hu-product-name">
                        {selected.variantName}
                      </Typography.Title>
                      <span className="hu-sku-badge">
                        SKU: <strong>{selected.sku}</strong>
                      </span>
                    </div>
                    <div className="hu-header-metric-chips">
                      <Tooltip title="Số tồn duy nhất dùng cho bán hàng, lấy từ tồn SKU trên phần mềm; xuất TMDT sẽ cập nhật số này một lần.">
                        <div className="hu-metric-chip hu-chip-allocated">
                          <span className="hu-chip-label">Tồn kho:</span>
                          <span className="hu-chip-val">
                            <strong>{fmt(selected.stock)} {selected.unitName}</strong>
                          </span>
                        </div>
                      </Tooltip>
                    </div>
                  </div>
                </div>
                <div className="hu-header-right hu-selected-actions">
                  {shiftCheckCandidates.length > 0 && (
                    <Tooltip
                      title={`${shiftCheckCandidates.length} kiện chưa đối chiếu. Từ 30/09/2026 phải kiểm cuối ca trước hết ngày; kiện Chờ kiểm cần chốt ngay để tiếp tục thao tác.`}
                    >
                      <Button
                        icon={<CheckCircleOutlined />}
                        className="hu-btn-secondary hu-btn-shift-check"
                        onClick={() => openShiftCheck("all")}
                      >
                        Kiểm cuối ca
                        <span className="hu-shift-check-count">
                          {shiftCheckCandidates.length}
                        </span>
                      </Button>
                    </Tooltip>
                  )}
                  {(isAdmin || user?.role === "manager") && (
                    <Button
                      icon={<PrinterOutlined />}
                      className="hu-btn-secondary hu-btn-qr-setup"
                      onClick={openQrSetup}
                    >
                      Tạo mã QR
                    </Button>
                  )}
                  <Dropdown.Button
                    type="primary"
                    icon={<DownOutlined />}
                    className="hu-btn-split-create"
                    onClick={openQuickCreate}
                    menu={{
                      items: [
                        {
                          key: "standard-create",
                          icon: <PlusOutlined style={{ fontSize: 16, color: "#00b96b" }} />,
                          label: (
                            <div className="hu-split-menu-item">
                              <span className="hu-split-menu-title">Tạo kiện thông thường</span>
                              <span className="hu-split-menu-desc">Tạo từng kiện thủ công / chi tiết</span>
                            </div>
                          ),
                          onClick: () => openCreatePackageModal(),
                        },
                      ],
                    }}
                  >
                    <QrcodeOutlined /> Tạo kiện nhanh
                  </Dropdown.Button>
                </div>
              </header>
              <div className="hu-physical-toolbar">
                <div className="hu-toolbar-left">
                  <span className="hu-toolbar-title">
                    <b>{selectedUnits.length}</b> kiện đang quản lý
                  </span>
                  <div className="hu-filter-tabs">
                    <button
                      type="button"
                      className={`hu-filter-tab ${statusFilter === "all" ? "active" : ""}`}
                      onClick={() => setStatusFilter("all")}
                    >
                      Tất cả ({selectedUnits.length})
                    </button>
                    <button
                      type="button"
                      className={`hu-filter-tab ${statusFilter === "Nguyên niêm phong" ? "active" : ""}`}
                      onClick={() => setStatusFilter("Nguyên niêm phong")}
                    >
                      🟢 Nguyên niêm phong ({sealedCount})
                    </button>
                    <button
                      type="button"
                      className={`hu-filter-tab ${statusFilter === "Đang sử dụng" ? "active" : ""}`}
                      onClick={() => setStatusFilter("Đang sử dụng")}
                    >
                      🟠 Đang mở ({openedCount})
                    </button>
                    {pendingCheckCount > 0 && (
                      <button
                        type="button"
                        className={`hu-filter-tab pending-check ${statusFilter === "Chờ kiểm" ? "active" : ""}`}
                        onClick={() => setStatusFilter("Chờ kiểm")}
                      >
                        <ExclamationCircleFilled /> Chờ kiểm
                        <span className="hu-pending-count">{pendingCheckCount}</span>
                      </button>
                    )}
                    {emptyCount > 0 && (
                      <button
                        type="button"
                        className={`hu-filter-tab ${statusFilter === "Đã hết" ? "active" : ""}`}
                        onClick={() => setStatusFilter("Đã hết")}
                      >
                        ⚪ Đã hết ({emptyCount})
                      </button>
                    )}
                    {splitCount > 0 && (
                      <button
                        type="button"
                        className={`hu-filter-tab ${statusFilter === "Đã tách" ? "active" : ""}`}
                        onClick={() => setStatusFilter("Đã tách")}
                      >
                        🔵 Đã tách ({splitCount})
                      </button>
                    )}
                  </div>
                </div>
                <div className="hu-toolbar-right">
                  {(isAdmin || user?.role === "manager") && activeSelectedUnits.length > 0 && (
                    <Tooltip title={`In toàn bộ ${activeSelectedUnits.length} kiện đang hoạt động của SKU này · mỗi kiện một trang PDF ${printLabelSize}`}>
                      <Button
                        size="small"
                        icon={<PrinterOutlined />}
                        className="hu-btn-bulk-print"
                        loading={isExportingLabelPdf}
                        disabled={isExportingLabelPdf}
                        onClick={() => handlePrintLabels(activeSelectedUnits, printLabelSize)}
                      >
                        In hàng loạt ({activeSelectedUnits.length})
                      </Button>
                    </Tooltip>
                  )}
                  {activeSequenceCount > 0 && (
                    <span className="hu-sequence-order" title="Thứ tự lấy hàng: kiện đang mở, ít hàng trước; bằng số lượng thì lấy kiện cũ trước. Số thứ tự lấy hàng thay đổi theo tồn, số tem giữ nguyên.">
                      <LockOutlined /> <b>Ít hàng trước</b> · {activeSequenceCount} kiện đang hoạt động
                    </span>
                  )}
                </div>
              </div>
              <div
                className={`hu-package-grid ${displayedUnits.length <= 2 ? "is-sparse" : ""}`}
              >
                  {visibleUnits.map((unit) => {
                    const deleteLocked = unit.status === "Đã tách" || isReturnHandlingUnit(unit) || (!isAdmin && unitHasWithdrawalHistory(unit));
                    return (
                    <article
                      className={`hu-package-card ${unit.status === "Đang sử dụng" ? "opened" : ""} ${unit.status === "Chờ kiểm" ? "pending-check" : ""} ${unit.status === "Đã hết" ? "empty" : ""} ${unit.status === "Đã tách" ? "split" : ""}`}
                      key={unit.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetail(unit)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDetail(unit); } }}
                    >
                      <header>
                        <div className="hu-card-heading">
                          <span className="hu-sequence-badge" title="Thứ tự lấy hàng hiện tại">{String(displaySequenceByUnitId.get(unit.id) || 0)}</span>
                          <div className="hu-card-title-group">
                            <b className="hu-unit-code">{unit.id}</b>
                            <span className="hu-unit-spec-tag">
                              {unit.packageType}
                            </span>
                            {isReturnHandlingUnit(unit) && unit.returnReference && (
                              <span className="hu-return-reference" title={`Mã vận đơn: ${unit.returnReference}`}>
                                Mã vận đơn: {unit.returnReference}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="hu-card-header-actions">
                          {statusFor(unit.status)}
                          {isAdmin && (
                            <Tooltip title={unit.status === "Đã tách" ? "Kiện cha đã tách phải được giữ lại để tra cứu lịch sử và QR cũ" : isReturnHandlingUnit(unit) ? "Kiện hàng hoàn phải chuyển sang kiện khác để bảo toàn tồn kho, không được xóa" : deleteLocked ? "Kiện đã có lịch sử rút hàng — chỉ admin được xóa" : "Xóa kiện"}>
                              <button
                                type="button"
                                className="hu-card-delete-icon"
                                disabled={deletingUnitCode === unit.id || deleteLocked}
                                aria-label={`Xóa kiện ${unit.id}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteUnit(unit);
                                }}
                              >
                                <DeleteOutlined />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </header>
                      <img src={imageFor(unit)} alt={`Minh hoạ ${unit.id}`} />
                      <div className="hu-package-number">
                        <small>{unit.status === "Đã tách" ? "Đã chuyển sang kiện con" : `${unit.unitName} còn lại`}</small>
                        <strong>{unit.status === "Đã tách" ? `${unit.childUnits?.length || 0} kiện` : `${fmt(unit.currentPcs)} ${unit.unitName}`}</strong>
                      </div>
                      <div className="hu-package-meta">
                        <div className="hu-meta-row">
                          <span>Vị trí</span>
                          <b>{locationFor(unit)}</b>
                        </div>
                        {unit.receiptCode && (
                          <div className="hu-meta-row">
                            <span>Phiếu nhập</span>
                            <span className="hu-receipt-badge">
                              {unit.receiptCode}
                            </span>
                          </div>
                        )}
                        {unit.parentUnitCode && (
                          <div className="hu-meta-row">
                            <span>Tách từ kiện</span>
                            <b>{unit.parentUnitCode}</b>
                          </div>
                        )}
                      </div>
                      <footer>
                        <span className="hu-card-detail-link">
                          Chi tiết & lịch sử ›
                        </span>
                        {(unit.status === "Nguyên niêm phong" ||
                          unit.status === "Đang sử dụng" ||
                          unit.status === "Chờ kiểm") && (
                          <div
                            className="hu-card-actions-bar"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {unit.status === "Nguyên niêm phong" &&
                              (() => {
                                const conflict = getIndexedConflict(unit);
                                if (conflict) {
                                  const catLabel =
                                    getPackageCategory(unit.packageType) ===
                                    "TAI"
                                      ? "tải"
                                      : "thùng";
                                  return (
                                    <Tooltip
                                      title={conflict.status === "Chờ kiểm"
                                        ? pendingCheckBlockText(unit, conflict, "khui kiện mới")
                                        : `Đang có ${catLabel} [${conflict.id}] cùng SKU đang mở (còn ${fmt(conflict.currentPcs)} gói). Vui lòng dùng hết kiện cũ trước khi khui ${catLabel} mới.`}
                                    >
                                      <button
                                        className="hu-action-btn unseal"
                                        style={{
                                          opacity: 0.65,
                                          cursor: "not-allowed",
                                          background: "#f0f0f0",
                                          color: "#8c8c8c",
                                          borderColor: "#d9d9d9",
                                        }}
                                         onClick={() =>
                                          message.warning(
                                            conflict.status === "Chờ kiểm"
                                              ? pendingCheckBlockText(unit, conflict, "khui kiện mới")
                                              : `⚠️ SKU này đang có ${catLabel} [${conflict.id}] mở sẵn. Vui lòng dùng hết kiện cũ trước khi khui thêm ${catLabel}!`,
                                            8,
                                          )
                                        }
                                      >
                                        <LockOutlined /> Khóa khui
                                      </button>
                                    </Tooltip>
                                  );
                                }
                                return (
                                  <button
                                    className="hu-action-btn unseal"
                                    onClick={() => handleUnsealUnit(unit)}
                                  >
                                    <UnlockOutlined /> Khui kiện
                                  </button>
                                );
                              })()}
                            {unit.status === "Đang sử dụng" && shiftCheckCandidates.some(({ unit: candidate }) => candidate.id === unit.id) && (
                              <button
                                className="hu-action-btn pick"
                                onClick={() => openShiftCheckForUnit(unit)}
                              >
                                <CheckCircleOutlined /> Kiểm kiện
                              </button>
                            )}
                            {unit.status === "Chờ kiểm" && (
                              <button
                                className="hu-action-btn pick"
                                onClick={() => openFinalCheck(unit)}
                              >
                                <CheckCircleOutlined /> Kiểm thực tế
                              </button>
                            )}
                            {["Nguyên niêm phong", "Đang sử dụng"].includes(unit.status) &&
                              unit.currentPcs > 1 &&
                              !isReturnHandlingUnit(unit) && (
                                <button
                                  className="hu-action-btn split"
                                  onClick={() => openSplitUnit(unit)}
                                >
                                  <ScissorOutlined /> Tách kiện
                                </button>
                              )}
                          </div>
                        )}
                        <button
                          type="button"
                          className="hu-card-location-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            showUnitLocation(unit);
                          }}
                        >
                          <EnvironmentOutlined /> Xem vị trí trên sơ đồ
                        </button>
                      </footer>
                    </article>
                    );
                  })}
              </div>
              {activeModuleTab === "units" && visibleUnits.length < displayedUnits.length && (
                <Flex justify="center" style={{ padding: "0 0 18px" }}>
                  <Button
                    onClick={() => setVisibleUnitLimit((limit) => limit + 100)}
                  >
                    Xem thêm{" "}
                    {Math.min(100, displayedUnits.length - visibleUnits.length)} kiện
                  </Button>
                </Flex>
              )}
              <section className="hu-global-history" aria-labelledby="hu-sku-history-title">
                <header className="hu-global-history-header">
                  <div>
                    <Typography.Title level={5} id="hu-sku-history-title">
                      <HistoryOutlined /> Lịch sử {selected.color || selected.sku}
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      Hoạt động của SKU {selected.sku} · {selected.productGroup}
                    </Typography.Text>
                  </div>
                  <Tag color="blue" style={{ margin: 0 }}>
                    {selectedSkuHistory.length} dòng
                  </Tag>
                </header>
                <div className="hu-global-history-filters">
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    value={historySearch}
                    onChange={(event) => setHistorySearch(event.target.value)}
                    placeholder="Tìm kiện, SKU, ghi chú..."
                  />
                  <Select
                    value={historyType}
                    onChange={setHistoryType}
                    options={[
                      { value: "all", label: "Tất cả" },
                      ...historyTypes.map((type) => ({ value: type, label: type })),
                    ]}
                  />
                  <Input
                    aria-label="Từ ngày"
                    type="date"
                    value={historyFromDate}
                    onChange={(event) => setHistoryFromDate(event.target.value)}
                  />
                  <Input
                    aria-label="Đến ngày"
                    type="date"
                    value={historyToDate}
                    onChange={(event) => setHistoryToDate(event.target.value)}
                  />
                </div>
                <Table
                  key={selected.sku}
                  className="hu-global-history-table"
                  rowKey={(item) => item.id || `${item.unitId}-${item.createdAt}`}
                  size="middle"
                  dataSource={selectedSkuHistory}
                  loading={ledgerHistoryLoading}
                  tableLayout="fixed"
                  scroll={{ x: 1080 }}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`Chưa có hoạt động của ${selected.sku}`} /> }}
                  pagination={{
                    pageSize: 8,
                    size: "small",
                    showSizeChanger: false,
                    showTotal: (total) => `Tổng ${total} hoạt động`,
                  }}
                  expandable={{
                    expandedRowKeys: expandedHistoryId == null ? [] : [expandedHistoryId],
                    showExpandColumn: false,
                    expandedRowRender: (item) => (
                      <div className="hu-history-expanded">
                        <span><b>SKU:</b> {item.sku || selected.sku}</span>
                        <span><b>Người thao tác:</b> {item.actor || "Hệ thống"}</span>
                        <span><b>Mã tham chiếu:</b> {item.reference || item.destination || "--"}</span>
                        <span><b>Ghi chú:</b> {item.note || "--"}</span>
                      </div>
                    ),
                    rowExpandable: (item) => Boolean(item.note || item.actor || item.reference || item.destination),
                  }}
                  columns={[
                    {
                      title: "TG / NV",
                      dataIndex: "createdAt",
                      width: 145,
                      render: (value, item) => <div className="hu-history-ledger-meta"><span className="hu-history-time">{formatHistoryTime(value)}</span><span>👤 {item.actor || "Hệ thống"}</span></div>,
                    },
                    { title: "SKU", dataIndex: "sku", width: 145, render: (value) => <span className="hu-history-cell-ellipsis" title={String(value || selected.sku)}>{value || selected.sku}</span> },
                    {
                      title: "Loại",
                      dataIndex: "referenceType",
                      width: 165,
                      render: (value) => {
                        const meta = historyActionMeta(value || "");
                        return <Tag color={meta.color} title={String(value || "")}>{meta.label}</Tag>;
                      },
                    },
                    {
                      title: "Mã CT",
                      dataIndex: "reference",
                      width: 140,
                      render: (value, item) => value ? <span className="hu-history-reference" onClick={() => setExpandedHistoryId((item.id || `${item.unitId}-${item.createdAt}`) === expandedHistoryId ? null : (item.id || `${item.unitId}-${item.createdAt}`))}>{value}</span> : <span className="hu-history-muted">—</span>,
                    },
                    {
                      title: "Đầu",
                      dataIndex: "oldStock",
                      align: "right" as const,
                      width: 85,
                      render: (value) => value == null ? "—" : Number(value).toLocaleString("vi-VN"),
                    },
                    {
                      title: "±",
                      dataIndex: "quantity",
                      align: "right" as const,
                      width: 90,
                      render: (value) => <b className={Number(value) < 0 ? "is-negative" : "is-positive"}>{fmtSigned(Number(value || 0))}</b>,
                    },
                    {
                      title: "Cuối",
                      dataIndex: "newStock",
                      align: "right" as const,
                      width: 85,
                      render: (value) => value == null ? "—" : Number(value).toLocaleString("vi-VN"),
                    },
                    {
                      title: "Ghi chú",
                      dataIndex: "note",
                      ellipsis: true,
                      render: (value, item) => value || item.note || "—",
                    },
                  ]}
                />
              </section>
            </>
          ) : (
            <Empty description="Không tìm thấy SKU demo" />
          )}
          </div>
        </section>
      </section>
      <Modal
        className="hu-unit-detail-modal"
        title={detail ? `Chi tiết kiện hàng · ${detail.id}` : "Chi tiết kiện"}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Đóng</Button>}
        width={1180}
        destroyOnHidden
      >
        {detail && (
          <div className="hu-detail-modal">
            <div className="hu-detail-top">
              <img src={imageFor(detail)} alt="Minh hoạ kiện" />
              <div className="hu-detail-main-info">
                <Flex gap={6} align="center" wrap="wrap">
                  <Tag color="blue">{detail.packageType}</Tag>
                  {detail.receiptCode && (
                    <Tag color="cyan">Phiếu nhập: {detail.receiptCode}</Tag>
                  )}
                  {detail.skuName && (
                    <Tag color="purple">SKU: {detail.skuName}</Tag>
                  )}
                  {isReturnHandlingUnit(detail) && detail.returnReference && (
                    <Tag color="gold">Mã vận đơn: {detail.returnReference}</Tag>
                  )}
                </Flex>
                <Typography.Title level={3} style={{ margin: "6px 0 2px" }}>
                  {detail.id}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {detail.packageLabel || detail.packageType}
                </Typography.Text>
                <p>{detail.note || "Kiện hàng vật lý lưu trữ trong kho"}</p>
              </div>
              <div className="hu-detail-qr-box">
                <div className="hu-qr-canvas-wrap">
                  <QRCode
                    value={`https://t.me/quanlykienhang_bot?start=khui_${detail.id.replace(/[^A-Za-z0-9]/g, "_")}`}
                    size={115}
                    bordered={false}
                    color="#0f172a"
                  />
                </div>
                <code className="hu-qr-code-text">{detail.id}</code>
                {detail.status === "Đã tách" && (
                  <Typography.Text type="secondary" className="hu-split-old-qr-note">
                    QR cũ chỉ dùng tra cứu. Hãy sử dụng QR mới trên từng kiện con.
                  </Typography.Text>
                )}
                <div className="hu-label-direct-actions">
                  <Button
                    type="primary"
                    icon={<PrinterOutlined />}
                    size="middle"
                    loading={isExportingLabelPdf}
                    disabled={detail.status === "Đã tách"}
                    onClick={() => handlePrintLabels([detail], "A6")}
                    className="hu-btn-open-print"
                  >
                    PDF A6 · 100×150 mm
                  </Button>
                  <Button
                    icon={<PrinterOutlined />}
                    size="middle"
                    loading={isExportingLabelPdf}
                    disabled={detail.status === "Đã tách"}
                    onClick={() => handlePrintLabels([detail], "A7")}
                    className="hu-btn-open-print hu-btn-open-print-a7"
                  >
                    PDF A7 · 75×100 mm
                  </Button>
                </div>
              </div>
            </div>
            {detail.parentUnitCode && (
              <Alert
                type="info"
                showIcon
                icon={<ScissorOutlined />}
                message={`Kiện con được tách từ ${detail.parentUnitCode}`}
                style={{ marginBottom: 12 }}
              />
            )}
            {detail.status === "Đã tách" && detail.childUnits?.length ? (
              <Alert
                type="info"
                showIcon
                icon={<ScissorOutlined />}
                message={`Kiện cha đã tách thành ${detail.childUnits.length} kiện nhỏ`}
                description={
                  <Flex wrap gap={6} style={{ marginTop: 8 }}>
                    {detail.childUnits.map((child) => (
                      <Button
                        key={child.code}
                        size="small"
                        onClick={() => {
                          const childUnit = workspace.register.find(
                            (unit) => unit.id === child.code,
                          );
                          if (childUnit) setDetail(childUnit);
                        }}
                      >
                        {child.code} · {fmt(child.quantity)} {detail.unitName}
                      </Button>
                    ))}
                  </Flex>
                }
                style={{ marginBottom: 12 }}
              />
            ) : null}
            <div className="hu-detail-stats">
              <div>
                <small>CÒN LẠI</small>
                <b>
                  {fmt(detail.currentPcs)} {detail.unitName}
                </b>
              </div>
              <div>
                <small>BAN ĐẦU</small>
                <b>
                  {fmt(detail.initialPcs)} {detail.unitName}
                </b>
              </div>
              <div>
                <small>VỊ TRÍ</small>
                <b>{locationFor(detail)}</b>
              </div>
              <div>
                <small>TRẠNG THÁI</small>
                {statusFor(detail.status)}
              </div>
            </div>
            <div className="hu-detail-actions-row">
              {detail.status === "Đã tách" || detail.status === "Chờ kiểm" || isReturnHandlingUnit(detail) ? (
                <Typography.Text type="secondary" className="hu-detail-action-note">
                  {isReturnHandlingUnit(detail)
                    ? "Kiện hàng hoàn: chuyển sang kiện đang khui cùng SKU hoặc chuyển vị trí."
                    : detail.status === "Đã tách"
                      ? "Kiện cha đã khóa sau khi tách; theo dõi ở các kiện con."
                      : "Kiện đang chờ kiểm; nhập số thực tế bằng Kiểm kiện cuối ca."}
                </Typography.Text>
              ) : null}
              {detail.status === "Nguyên niêm phong" &&
                (() => {
                  const conflict = getIndexedConflict(detail);
                  if (conflict) {
                    const catLabel =
                      getPackageCategory(detail.packageType) === "TAI"
                        ? "tải"
                        : "thùng";
                    return (
                      <Tooltip
                        title={conflict.status === "Chờ kiểm"
                          ? pendingCheckBlockText(detail, conflict, "khui kiện mới")
                          : `SKU này đang có ${catLabel} [${conflict.id}] đang mở (còn ${fmt(conflict.currentPcs)} ${detail.unitName}). Hãy dùng hết kiện cũ trước.`}
                      >
                        <Button disabled icon={<LockOutlined />} size="middle">
                          {conflict.status === "Chờ kiểm"
                            ? `Khóa khui — cần kiểm ${conflict.id}`
                            : `Khóa khui (Chờ kiện ${conflict.id})`}
                        </Button>
                      </Tooltip>
                    );
                  }
                  return (
                    <Button
                      type="primary"
                      icon={<UnlockOutlined />}
                      size="middle"
                      style={{ background: "#00b96b", borderColor: "#00b96b" }}
                      onClick={() => handleUnsealUnit(detail)}
                    >
                      Khui kiện ngay (Mở niêm phong)
                    </Button>
                  );
                })()}
              {detail.status === "Đang sử dụng" && shiftCheckCandidates.some(({ unit }) => unit.id === detail.id) && (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  size="middle"
                  style={{ background: "#d48806", borderColor: "#d48806" }}
                  onClick={() => openShiftCheckForUnit(detail)}
                >
                  Kiểm kiện
                </Button>
              )}
              {detail.status === "Chờ kiểm" && (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  size="middle"
                  style={{ background: "#d48806", borderColor: "#d48806" }}
                  onClick={() => openFinalCheck(detail)}
                >
                  Kiểm và chốt hết kiện
                </Button>
              )}
              {["Nguyên niêm phong", "Đang sử dụng"].includes(detail.status) &&
                detail.currentPcs > 1 &&
                !isReturnHandlingUnit(detail) && (
                  <Button
                    icon={<ScissorOutlined />}
                    size="middle"
                    onClick={() => openSplitUnit(detail)}
                  >
                    Tách thành kiện nhỏ
                  </Button>
                )}
              {detail.status !== "Đã tách" && (
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      ...(detail.currentPcs > 0 &&
                        (detail.status === "Đang sử dụng" ||
                          (detail.status === "Nguyên niêm phong" && getPackageCategory(detail.packageType) === "LE"))
                        ? [{ key: "transfer", icon: <SwapOutlined />, label: "Chuyển kiện", onClick: () => openMergeReturnUnit(detail) }]
                        : []),
                      { key: "location", icon: <EnvironmentOutlined />, label: "Chuyển vị trí", onClick: () => {
                        setMovingUnit(detail);
                        moveLocationForm.setFieldsValue({
                          targetZone: detail.location?.zone || workspace.locations[0]?.code,
                          targetRack: detail.location?.rack || "",
                        });
                      } },
                    ],
                  }}
                >
                  <Button icon={<MoreOutlined />}>Thao tác khác</Button>
                </Dropdown>
              )}
            </div>
            <HandlingUnitStockHistory sku={detail.skuName} />
          </div>
        )}
      </Modal>
      <Modal
        title={
          <div className="hu-loc-modal-header">
            <div className="hu-loc-modal-title">
              <EnvironmentOutlined style={{ color: "#0f172a", fontSize: 18 }} />
              <div>
                <b>Khu vực & Vị trí lưu trữ kho</b>
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: 12 }}
                >
                  Tổng {workspace.locations.length} phân khu ·{" "}
                  {workspace.register.length} kiện hàng đang quản lý
                </Typography.Text>
              </div>
            </div>
            <Flex gap={12} align="center">
              <Segmented
                value={locModalView}
                onChange={(val) => setLocModalView(val as "map" | "list")}
                options={[
                  {
                    label: "Sơ đồ 2D trực quan",
                    value: "map",
                    icon: <CompassOutlined />,
                  },
                  {
                    label: "Danh sách quản lý",
                    value: "list",
                    icon: <AppstoreOutlined />,
                  },
                ]}
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setShowAddLocationModal(true)}
                style={{ background: "#0f172a", borderColor: "#0f172a" }}
              >
                Thêm khu vực
              </Button>
            </Flex>
          </div>
        }
        open={showLocations}
        onCancel={() => {
          setShowLocations(false);
          setLocationFocusUnit(null);
        }}
        footer={
          <Button
            onClick={() => {
              setShowLocations(false);
              setLocationFocusUnit(null);
            }}
          >
            Đóng
          </Button>
        }
        width={1060}
        destroyOnHidden
        className="hu-locations-manager-modal"
      >
        {locModalView === "map" ? (
          <div style={{ padding: "4px 0" }}>
            {locationFocusUnit && (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Đang định vị kiện ${locationFocusUnit.id}`}
                description={`Kiện này hiện nằm tại ${locationFor(locationFocusUnit)}. Khu tương ứng được tô nổi bật trên sơ đồ.`}
              />
            )}
            <Warehouse2DMap
              units={workspace.register}
              onSelectUnit={(u) => setDetail(u as UnitRow)}
              onUnsealUnit={(u) => handleUnsealUnit(u as UnitRow)}
              selectedZoneCode={selectedLocationCode}
              highlightedUnitId={locationFocusUnit?.id}
              onOpenZoneManager={(zoneCode) => {
                setSelectedLocationCode(zoneCode);
                setLocModalView("list");
              }}
            />
          </div>
        ) : (
          <div className="hu-locations-manager">
            <aside className="hu-locations-sidebar">
              <Input
                className="hu-loc-search"
                placeholder="Tìm khu vực..."
                prefix={<SearchOutlined />}
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                allowClear
              />
              <div className="hu-locations-list">
                {filteredLocations.map((loc) => {
                  const unitsInLoc = unitsByLocation.get(loc.code) || [];
                  const totalPcs = unitsInLoc.reduce(
                    (s, u) => s + u.currentPcs,
                    0,
                  );
                  const typeMeta = locationTypeMeta(loc.type);
                  const isSelected = activeLocation?.code === loc.code;

                  return (
                    <div
                      key={loc.id}
                      className={`hu-loc-item ${isSelected ? "is-active" : ""}`}
                      onClick={() => setSelectedLocationCode(loc.code)}
                    >
                      <div className="hu-loc-item-header">
                        <div className="hu-loc-item-code">
                          <b>{loc.code}</b>
                          <Tag color={typeMeta.color} style={{ margin: 0 }}>
                            {typeMeta.label}
                          </Tag>
                        </div>
                        <span
                          className={`hu-loc-badge ${unitsInLoc.length > 0 ? "has-units" : "is-empty"}`}
                        >
                          {unitsInLoc.length} kiện
                        </span>
                      </div>
                      <div className="hu-loc-item-name">{loc.name}</div>
                      <div className="hu-loc-item-meta">
                        <span>{fmt(totalPcs)} sản phẩm tồn</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>

            <section className="hu-locations-content">
              {activeLocation ? (
                <>
                  <div className="hu-loc-detail-banner">
                    <div className="hu-loc-detail-title">
                      <div>
                        <Flex gap={8} align="center">
                          <Tag
                            color="blue"
                            style={{ fontSize: 13, padding: "2px 8px" }}
                          >
                            Mã: {activeLocation.code}
                          </Tag>
                          <Tag
                            color={locationTypeMeta(activeLocation.type).color}
                          >
                            {locationTypeMeta(activeLocation.type).label}
                          </Tag>
                        </Flex>
                        <Typography.Title
                          level={4}
                          style={{ margin: "6px 0 2px" }}
                        >
                          {activeLocation.name}
                        </Typography.Title>
                        <Typography.Text type="secondary">
                          {activeLocation.description ||
                            "Chưa có mô tả chi tiết."}
                        </Typography.Text>
                      </div>
                    </div>

                    <div className="hu-loc-summary-grid">
                      <div className="hu-loc-summary-box">
                        <small>SỐ KIỆN ĐANG LƯU</small>
                        <b>{unitsInActiveLocation.length} kiện</b>
                      </div>
                      <div className="hu-loc-summary-box">
                        <small>TỔNG SẢN PHẨM TỒN</small>
                        <b>{fmt(totalPcsInActiveLocation)} đơn vị</b>
                      </div>
                      <div className="hu-loc-summary-box">
                        <small>SỐ SKU HIỆN DIỆN</small>
                        <b>{skusInActiveLocation.length} SKU</b>
                      </div>
                    </div>
                  </div>

                  <div className="hu-loc-units-section">
                    <Flex
                      justify="space-between"
                      align="center"
                      style={{ marginBottom: 10 }}
                    >
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        Danh sách kiện hàng tại {activeLocation.code} (
                        {unitsInActiveLocation.length})
                      </Typography.Title>
                    </Flex>

                    {unitsInActiveLocation.length > 0 ? (
                      <div className="hu-loc-units-list">
                        {unitsInActiveLocation.map((unit) => (
                          <div key={unit.id} className="hu-loc-unit-card">
                            <div className="hu-loc-unit-left">
                              <div className="hu-loc-unit-code-row">
                                <b>{unit.id}</b>
                                {statusFor(unit.status)}
                                {unit.receiptCode && (
                                  <span className="hu-receipt-badge">
                                    {unit.receiptCode}
                                  </span>
                                )}
                              </div>
                              <div className="hu-loc-unit-sku">
                                <strong>{unit.skuName}</strong> ·{" "}
                                {unit.packageLabel || unit.packageType}
                              </div>
                              <div className="hu-loc-unit-note">
                                {unit.location?.rack
                                  ? `Kệ / Ngăn: ${unit.location.rack}`
                                  : "Chưa gắn kệ cụ thể"}
                                {unit.note ? ` · ${unit.note}` : ""}
                              </div>
                            </div>
                            <div className="hu-loc-unit-right">
                              <div className="hu-loc-unit-qty">
                                <small>Còn lại</small>
                                <strong>{fmt(unit.currentPcs)}</strong>
                                <small>{unit.unitName}</small>
                              </div>
                              <Flex gap={6} align="center">
                                <Button
                                  size="small"
                                  icon={<SwapOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMovingUnit(unit);
                                    moveLocationForm.setFieldsValue({
                                      targetZone:
                                        unit.location?.zone ||
                                        workspace.locations[0]?.code,
                                      targetRack: unit.location?.rack || "",
                                    });
                                  }}
                                >
                                  Chuyển vị trí
                                </Button>
                                <Button
                                  size="small"
                                  type="primary"
                                  ghost
                                  icon={<EyeOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetail(unit);
                                  }}
                                >
                                  Chi tiết
                                </Button>
                              </Flex>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="Khu vực này hiện chưa có kiện hàng nào."
                      />
                    )}
                  </div>
                </>
              ) : (
                <Empty description="Chọn khu vực lưu trữ để xem chi tiết." />
              )}
            </section>
          </div>
        )}
      </Modal>

      <Modal
        title="Thêm khu vực lưu trữ mới"
        open={showAddLocationModal}
        onCancel={() => {
          addLocationForm.resetFields();
          setShowAddLocationModal(false);
        }}
        onOk={handleAddLocation}
        okText="Thêm khu vực"
        destroyOnHidden
      >
        <Form
          form={addLocationForm}
          layout="vertical"
          initialValues={{ type: "STORAGE" }}
        >
          <Form.Item
            name="code"
            label="Mã khu vực (Zone Code)"
            rules={[
              {
                required: true,
                message: "Nhập mã khu vực (ví dụ: A3, B1, LE-01)",
              },
            ]}
          >
            <Input placeholder="Ví dụ: A3, B1, KE-02" />
          </Form.Item>
          <Form.Item
            name="name"
            label="Tên khu vực"
            rules={[
              {
                required: true,
                message: "Nhập tên khu vực (ví dụ: Khu A3 - Kệ cao tầng 3)",
              },
            ]}
          >
            <Input placeholder="Ví dụ: Khu A3 - Kệ cao tầng 3" />
          </Form.Item>
          <Form.Item
            name="type"
            label="Loại khu vực"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "STORAGE", label: "Khu lưu trữ chính (Storage Zone)" },
                {
                  value: "LOOSE",
                  label: "Khu hàng lẻ / Soạn hàng (Loose / Picking)",
                },
                {
                  value: "PACKING",
                  label: "Khu đóng gói & xuất hàng (Packing / Staging)",
                },
                {
                  value: "QUARANTINE",
                  label: "Khu kiểm định / Chờ xử lý (Quarantine)",
                },
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="Mô tả / Ghi chú">
            <Input.TextArea
              rows={3}
              placeholder="Mô tả công năng và vị trí của khu vực..."
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          editingUnit ? `Sửa thông tin kiện · ${editingUnit.id}` : "Sửa kiện"
        }
        open={!!editingUnit}
        onCancel={() => {
          if (isSavingUnitEdit) return;
          setEditingUnit(null);
          editUnitForm.resetFields();
        }}
        onOk={handleEditUnitSubmit}
        okText="Lưu thay đổi"
        cancelText="Hủy"
        confirmLoading={isSavingUnitEdit}
        closable={!isSavingUnitEdit}
        maskClosable={!isSavingUnitEdit}
        destroyOnHidden
        width={640}
        className="hu-edit-unit-modal"
      >
        {editingUnit && (
          <Form form={editUnitForm} layout="vertical">
            <div className="hu-edit-unit-identity">
              <div>
                <small>MÃ KIỆN</small>
                <b>{editingUnit.id}</b>
              </div>
              <div>
                <small>SKU CỐ ĐỊNH</small>
                <b>{editingUnit.skuName}</b>
              </div>
              <Tag color="blue">{editingUnit.status}</Tag>
            </div>

            <Alert
              type="info"
              showIcon
              message="Mã kiện và SKU được khóa để bảo vệ lịch sử truy vết. Nếu chọn nhầm SKU, hãy tạo kiện đúng thay vì đổi danh tính kiện này."
              style={{ marginBottom: 16 }}
            />

            <Form.Item
              name="packagingName"
              label="Loại kiện / quy cách đóng gói"
              rules={[{ required: true, message: "Chọn loại kiện" }]}
            >
              <Select
                options={[
                  { value: "Tải dứa", label: "Tải dứa" },
                  { value: "Thùng carton", label: "Thùng carton" },
                  { value: "Túi lẻ", label: "Túi lẻ / hàng rời" },
                ]}
              />
            </Form.Item>

            <Flex gap={12}>
              <Form.Item
                name="initialQuantity"
                label={`Số lượng ban đầu (${editingUnit.unitName})`}
                rules={[
                  { required: true, message: "Nhập số lượng ban đầu" },
                  { type: "number", min: 1, message: "Tối thiểu là 1" },
                ]}
                style={{ flex: 1 }}
              >
                <InputNumber
                  min={1}
                  precision={0}
                  addonAfter={editingUnit.unitName}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item
                name="remainingQuantity"
                label={`Số lượng còn lại (${editingUnit.unitName})`}
                dependencies={["initialQuantity"]}
                rules={[
                  { required: true, message: "Nhập số lượng còn lại" },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      Number(value) >= 0 &&
                      Number(value) <= Number(getFieldValue("initialQuantity"))
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error("Phải từ 0 đến số lượng ban đầu"),
                          ),
                  }),
                ]}
                style={{ flex: 1 }}
              >
                <InputNumber
                  min={0}
                  precision={0}
                  addonAfter={editingUnit.unitName}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Flex>

            <Flex gap={12}>
              <Form.Item
                name="zone"
                label="Khu vực"
                rules={[{ required: true, message: "Chọn khu vực" }]}
                style={{ flex: 1 }}
              >
                <Select
                  showSearch
                  options={workspace.locations.map((location) => ({
                    value: location.code,
                    label: `${location.code} · ${location.name}`,
                  }))}
                />
              </Form.Item>
              <Form.Item name="rack" label="Kệ / ngăn" style={{ flex: 1 }}>
                <Input placeholder="Ví dụ: Kệ 02, tầng 1" />
              </Form.Item>
            </Flex>

            <Form.Item
              name="note"
              label="Lý do chỉnh sửa"
              rules={[{ required: true, message: "Nhập lý do để lưu lịch sử" }]}
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea
                rows={3}
                placeholder="Ví dụ: Nhập nhầm 50 gói, kiểm thực tế là 48 gói"
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={
          <div className="hu-shift-check-title">
            <span className="hu-shift-check-title-icon">
              <CheckCircleOutlined />
            </span>
            <div>
              <b>{shiftCheckScope === "mandatory" ? "Kiểm và chốt kiện" : "Kiểm cuối ca"}</b>
              <small>
                {shiftCheckScope === "mandatory"
                  ? "Chỉ gồm các kiện đang ở trạng thái Chờ kiểm"
                  : "Đối chiếu các kiện cần kiểm hôm nay, gồm cả kiện chưa kiểm từ ngày trước"}
              </small>
            </div>
          </div>
        }
        open={showShiftCheckModal}
        onCancel={() => {
          if (isSubmittingShiftCheck) return;
          setShowShiftCheckModal(false);
          setShiftCheckDrafts({});
          setShiftCheckFocusCode(null);
        }}
        onOk={submitShiftCheck}
        okText={`${shiftCheckScope === "mandatory" ? "Chốt" : "Hoàn tất kiểm"} ${shiftCheckEnteredCount}/${visibleShiftCheckCandidates.length} mục`}
        okButtonProps={{ disabled: !canSubmitShiftCheck }}
        cancelText="Để kiểm sau"
        confirmLoading={isSubmittingShiftCheck}
        closable={!isSubmittingShiftCheck}
        maskClosable={!isSubmittingShiftCheck}
        cancelButtonProps={{ disabled: isSubmittingShiftCheck }}
        centered
        width={1180}
        destroyOnHidden
        className="hu-shift-check-modal"
      >
        <Alert
          type="info"
          showIcon
          message={shiftCheckScope === "mandatory" ? "Nhập số lượng thực tế để chốt kiện" : "Nhập số lượng đếm thực tế trong từng kiện"}
          description={shiftCheckScope === "mandatory"
            ? "Kiện chỉ được mở lại thao tác sau khi đã chốt số thực tế."
            : "Đếm hàng còn trong kiện và số combo đóng sẵn chưa xuất; không tháo combo để đếm lại. Hạn kiểm 23:59; tạm thời chưa áp dụng phạt kiểm kiện cuối ca. Kết quả độc lập với Kiểm hàng trong Quản lý kho."}
          style={{ marginBottom: 14 }}
        />
        {scopedShiftCheckCandidates.length > 100 && (
          <Alert type="info" showIcon style={{ marginBottom: 14 }} message={`Đang kiểm 100/${scopedShiftCheckCandidates.length} kiện. Sau khi chốt đợt này, tiếp tục kiểm các kiện còn lại.`} />
        )}
        <Table
          rowKey={(item) => item.unit.id}
          dataSource={visibleShiftCheckCandidates}
          size="small"
          pagination={false}
          scroll={{ x: 1050, y: 480 }}
          locale={{ emptyText: "Không còn kiện nào cần kiểm" }}
          columns={[
            {
              title: "Kiện / SKU",
              width: 190,
              fixed: "left",
              render: (_, item) => (
                <div className="hu-shift-unit-cell">
                  <b>{item.packed ? item.unit.variantName : item.unit.id}</b>
                  <small>{item.unit.skuName}</small>
                </div>
              ),
            },
            {
              title: "Phát sinh rút",
              width: 140,
              render: (_, item) => (
                <div className="hu-shift-withdrawal-cell">
                  {item.packed ? (
                    <>
                      <b>Combo đóng sẵn</b>
                      <small>Chưa kiểm từ ngày trước · {formatHistoryTime(new Date(item.lastWithdrawalAt).toISOString())}</small>
                    </>
                  ) : item.withdrawalCount > 0 ? (
                    <>
                      <b>-{fmt(item.withdrawnQuantity)} {item.unit.unitName}</b>
                      <small>{item.withdrawalCount} lần · {formatHistoryTime(new Date(item.lastWithdrawalAt).toISOString())}</small>
                    </>
                  ) : (
                    <>
                      <b>Chưa kiểm từ ngày trước</b>
                      <small>Không có phát sinh rút mới · {formatHistoryTime(new Date(item.lastWithdrawalAt).toISOString())}</small>
                    </>
                  )}
                </div>
              ),
            },
            {
              title: "Tồn dự kiến",
              width: 105,
              align: "right" as const,
              render: (_, item) => (
                <b>{fmt(item.unit.currentPcs)}</b>
              ),
            },
            {
              title: "Đếm thực tế",
              width: 135,
              render: (_, item) => (
                <InputNumber
                  min={0}
                  max={item.unit.initialPcs}
                  precision={0}
                  placeholder="Nhập số đếm"
                  value={shiftCheckDrafts[item.unit.id]?.actualQuantity}
                  onChange={(value) =>
                    updateShiftCheckDraft(item.unit.id, {
                      actualQuantity: value,
                      ...(Number(value) === item.unit.currentPcs
                        ? { reason: "", note: "" }
                        : {}),
                    })
                  }
                  addonAfter={item.unit.unitName}
                  style={{ width: "100%" }}
                />
              ),
            },
            {
              title: "Chênh lệch",
              width: 105,
              align: "center" as const,
              render: (_, item) => {
                const actual = shiftCheckDrafts[item.unit.id]?.actualQuantity;
                if (actual === null || actual === undefined) return <Tag>Chưa nhập</Tag>;
                const variance = Number(actual) - item.unit.currentPcs;
                return (
                  <Tag color={variance === 0 ? "green" : variance > 0 ? "blue" : "red"}>
                    {variance === 0 ? "Khớp" : fmtSigned(variance)}
                  </Tag>
                );
              },
            },
            {
              title: "Lý do chênh lệch",
              width: 195,
              render: (_, item) => {
                const actual = shiftCheckDrafts[item.unit.id]?.actualQuantity;
                const hasVariance =
                  actual !== null &&
                  actual !== undefined &&
                  Number(actual) !== item.unit.currentPcs;
                return (
                  <Select
                    allowClear
                    disabled={!hasVariance}
                    value={shiftCheckDrafts[item.unit.id]?.reason || undefined}
                    placeholder={actual === null || actual === undefined ? "Chưa nhập số đếm" : hasVariance ? "Chọn lý do" : "Không cần"}
                    onChange={(value) =>
                      updateShiftCheckDraft(item.unit.id, { reason: value || "" })
                    }
                    options={SHIFT_CHECK_REASONS.map((reason) => ({
                      value: reason,
                      label: reason,
                    }))}
                    style={{ width: "100%" }}
                  />
                );
              },
            },
            {
              title: "Ghi chú",
              width: 190,
              render: (_, item) => {
                const actual = shiftCheckDrafts[item.unit.id]?.actualQuantity;
                const hasVariance =
                  actual !== null &&
                  actual !== undefined &&
                  Number(actual) !== item.unit.currentPcs;
                return (
                  <Input
                    allowClear
                    disabled={!hasVariance}
                    value={shiftCheckDrafts[item.unit.id]?.note}
                    placeholder={
                      shiftCheckDrafts[item.unit.id]?.reason === "Khác"
                        ? "Bắt buộc nhập"
                        : "Ghi chú thêm"
                    }
                    onChange={(event) =>
                      updateShiftCheckDraft(item.unit.id, {
                        note: event.target.value,
                      })
                    }
                  />
                );
              },
            },
          ]}
        />
      </Modal>

      <Modal
        title={
          checkingUnit ? (
            <div className="hu-final-check-title">
              <span className="hu-final-check-title-icon">
                <CheckCircleOutlined />
              </span>
              <div>
                <b>Kiểm thực tế cuối kiện</b>
                <small>Kiện {checkingUnit.id}</small>
              </div>
            </div>
          ) : (
            "Kiểm thực tế cuối kiện"
          )
        }
        open={showFinalCheckModal}
        onCancel={() => {
          if (isFinalizingCheck) return;
          setShowFinalCheckModal(false);
          setCheckingUnit(null);
          finalCheckForm.resetFields();
        }}
        onOk={handleFinalCheckSubmit}
        okText={
          finalPickVerification === "MISMATCH"
            ? "Cập nhật số còn lại"
            : "Xác nhận kiện đã hết"
        }
        cancelText="Để kiểm sau"
        confirmLoading={isFinalizingCheck}
        closable={!isFinalizingCheck}
        maskClosable={!isFinalizingCheck}
        cancelButtonProps={{ disabled: isFinalizingCheck }}
        destroyOnHidden
        centered
        width={620}
        className={`hu-final-check-modal ${finalPickVerification === "MISMATCH" ? "is-mismatch" : "is-match"}`}
      >
        {checkingUnit && (
          <Form form={finalCheckForm} layout="vertical">
            <div className="hu-final-check-hero">
              <div className="hu-final-check-hero-icon">!</div>
              <div>
                  <strong>Kiện đang ở trạng thái Chờ kiểm</strong>
                  <p>
                  Sổ kiện đã về <b>0 {checkingUnit.unitName}</b>. Hãy nhìn và
                  đếm trực tiếp trong kiện trước khi xác nhận.
                  </p>
              </div>
            </div>

            <div className="hu-final-check-summary">
              <div>
                <small>MÃ KIỆN</small>
                <b>{checkingUnit.id}</b>
              </div>
              <div>
                <small>SKU</small>
                <b>{checkingUnit.skuName}</b>
              </div>
              <div>
                <small>TỒN THEO SỔ</small>
                <b>0 {checkingUnit.unitName}</b>
              </div>
            </div>

            <Form.Item
              name="finalVerification"
              label="Kết quả kiểm đếm thực tế"
              rules={[{ required: true, message: "Hãy chọn kết quả kiểm kiện." }]}
              className="hu-final-check-result"
            >
              <Radio.Group className="hu-final-check-options">
                <Radio.Button value="MATCH" className="hu-final-check-option match">
                  <CheckCircleOutlined />
                  <span>
                    <b>Hết sạch, khớp sổ</b>
                    <small>Thực tế không còn gói nào</small>
                  </span>
                </Radio.Button>
                <Radio.Button value="MISMATCH" className="hu-final-check-option mismatch">
                  <InfoCircleOutlined />
                  <span>
                    <b>Vẫn còn hàng</b>
                    <small>Nhập lại số lượng tìm thấy</small>
                  </span>
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
            {finalPickVerification === "MISMATCH" && (
              <div className="hu-final-check-recount">
                <Form.Item
                  name="actualQuantity"
                  label="Số gói thực tế còn trong kiện"
                  rules={[
                    { required: true, message: "Hãy nhập số lượng thực tế còn lại." },
                    {
                      type: "number",
                      min: 1,
                      max: checkingUnit.initialPcs,
                      message: `Số lượng từ 1 đến ${checkingUnit.initialPcs}`,
                    },
                  ]}
                >
                  <InputNumber
                    min={1}
                    max={checkingUnit.initialPcs}
                    precision={0}
                    autoFocus
                    addonAfter={checkingUnit.unitName}
                    placeholder="Ví dụ: 1 hoặc 2"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <p>
                  Sau khi cập nhật, kiện sẽ quay lại <b>Đang sử dụng</b> với số
                  tồn thực tế này.
                </p>
              </div>
            )}
            <Form.Item
              name="note"
              label="Ghi chú kiểm đếm (tuỳ chọn)"
              style={{ marginBottom: 0 }}
            >
              <Input placeholder="Ví dụ: Còn sót dưới đáy kiện..." />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={
          movingUnit
            ? `Điều chuyển vị trí kiện ${movingUnit.id}`
            : "Chuyển vị trí kiện"
        }
        open={!!movingUnit}
        onCancel={() => {
          setMovingUnit(null);
          moveLocationForm.resetFields();
        }}
        onOk={handleMoveUnitSubmit}
        okText="Xác nhận chuyển"
        destroyOnHidden
      >
        {movingUnit && (
          <Form form={moveLocationForm} layout="vertical">
            <div className="hu-move-preview">
              <div>
                <strong>Mã kiện:</strong> <code>{movingUnit.id}</code>
              </div>
              <div>
                <strong>Sản phẩm / SKU:</strong> {movingUnit.skuName}
              </div>
              <div>
                <strong>Số lượng:</strong> {fmt(movingUnit.currentPcs)}{" "}
                {movingUnit.unitName}
              </div>
              <div>
                <strong>Vị trí hiện tại:</strong>{" "}
                <Tag color="orange">{locationFor(movingUnit)}</Tag>
              </div>
            </div>
            <Form.Item
              name="targetZone"
              label="Khu vực lưu trữ đích"
              rules={[{ required: true, message: "Chọn khu vực chuyển đến" }]}
              style={{ marginTop: 14 }}
            >
              <Select
                options={workspace.locations.map((loc) => ({
                  value: loc.code,
                  label: `${loc.code} · ${loc.name} (${locationTypeMeta(loc.type).label})`,
                }))}
              />
            </Form.Item>
            <Form.Item name="targetRack" label="Kệ / Ngăn chi tiết (tuỳ chọn)">
              <Input placeholder="Ví dụ: Kệ 01, Kệ A-12, Tầng 2" />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <Modal
        open={showQrSetup}
        onCancel={() => setShowQrSetup(false)}
        width={760}
        destroyOnHidden
        className="hu-qr-setup-modal"
        title={
          <Flex align="center" gap={8}>
            <QrcodeOutlined style={{ color: "#00b96b", fontSize: 18 }} />
            <div>
              <b style={{ fontSize: 15 }}>Tạo mã QR</b>
              <Typography.Text type="secondary" style={{ display: "block", fontSize: 11 }}>
                Phát hành & in tem QR kiện hàng
              </Typography.Text>
            </div>
          </Flex>
        }
        footer={
          qrModalTab === "create" ? (
            <Flex justify="space-between" align="center" style={{ width: "100%" }}>
              <Button type="link" size="small" onClick={() => setQrModalTab("ledger")}>
                Xem sổ tem đã in ({workspace.qrLabels.length})
              </Button>
              <Flex gap={8}>
                <Button onClick={() => setShowQrSetup(false)}>Hủy</Button>
                <Button
                  type="primary"
                  icon={<QrcodeOutlined />}
                  loading={isIssuingQrLabels}
                  onClick={issueQrLabels}
                >
                  Phát hành tem QR
                </Button>
              </Flex>
            </Flex>
          ) : (
            <Flex justify="space-between" align="center" style={{ width: "100%" }}>
              <Button type="primary" ghost icon={<PlusOutlined />} onClick={() => setQrModalTab("create")}>
                Tạo thêm tem mới
              </Button>
              <Button onClick={() => setShowQrSetup(false)}>Đóng</Button>
            </Flex>
          )
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Segmented
            block
            value={qrModalTab}
            onChange={(val) => setQrModalTab(val as "create" | "ledger")}
            options={[
              {
                value: "create",
                label: (
                  <span style={{ fontWeight: 600, padding: "2px 8px" }}>
                    <PlusOutlined style={{ marginRight: 6 }} /> Phát hành tem mới
                  </span>
                ),
              },
              {
                value: "ledger",
                label: (
                  <span style={{ fontWeight: 600, padding: "2px 8px" }}>
                    <HistoryOutlined style={{ marginRight: 6 }} /> Sổ tem đã in ({workspace.qrLabels.length})
                  </span>
                ),
              },
            ]}
          />
        </div>

        {qrModalTab === "create" ? (
          <>
            <Form form={qrSetupForm} layout="vertical">
              <div className="hu-qr-setup-grid">
                <Form.Item name="sku" label="SKU / phân loại" rules={[{ required: true, message: "Chọn SKU" }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Chọn SKU cần in tem"
                    options={workspace.catalog.map((item) => ({ value: item.sku, label: `${item.sku} · ${item.variantName}` }))}
                    onChange={(sku) => {
                      const product = workspace.catalog.find((item) => item.sku === sku);
                      const existingSpec = latestQrSuggestion(sku);
                      qrSetupForm.setFieldsValue({
                        baseUnit: existingSpec?.baseUnit || product?.unitName || "Gói",
                        packagingName: existingSpec?.name || undefined,
                        conversionFactor: existingSpec?.conversionFactor || undefined,
                        supplierId: existingSpec?.supplierId || undefined,
                      });
                    }}
                  />
                </Form.Item>
                <Form.Item
                  name="supplierId"
                  label="Nhà cung cấp"
                  rules={[{ required: true, message: "Chọn nhà cung cấp trước khi tạo mã QR" }]}
                >
                  <Select allowClear placeholder="Lấy nguồn mặc định đã có" options={workspace.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                </Form.Item>
                <Form.Item name="packagingName" label="Dạng kiện" rules={[{ required: true, message: "Chọn dạng kiện" }]}>
                  <Select
                    placeholder="Chọn dạng kiện"
                    options={[
                      { value: "Tải", label: "Tải" },
                      { value: "Thùng", label: "Thùng" },
                      { value: "Lẻ", label: "Lẻ" },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="conversionFactor" label="Quy đổi về đơn vị nhỏ nhất" rules={[{ required: true, message: "Nhập hệ số quy đổi" }, { type: "number", max: 300, message: "Mỗi kiện tối đa 300 đơn vị" }]}>
                  <InputNumber min={1} max={300} precision={0} style={{ width: "100%" }} addonAfter="đơn vị" />
                </Form.Item>
                <Form.Item name="baseUnit" label="Đơn vị nhỏ nhất" rules={[{ required: true, message: "Nhập đơn vị cơ sở" }]}>
                  <Input placeholder="Ví dụ: gói, hộp, cái" />
                </Form.Item>
                <Form.Item name="quantity" label="Số tem cần in" rules={[{ required: true, message: "Nhập số tem" }]}>
                  <InputNumber min={1} max={500} precision={0} style={{ width: "100%" }} addonAfter="tem" />
                </Form.Item>
                <Form.Item name="zone" label="Khu vực lưu kho" className="hu-qr-field-full" rules={[{ required: true, message: "Chọn khu vực lưu kho trước khi phát hành tem" }]}>
                  <QrZonePicker units={workspace.register} locations={workspace.locations} />
                </Form.Item>
              </div>
              <div className="hu-qr-quick-hint">
                <InfoCircleOutlined style={{ color: "#0284c7" }} />
                <span>QR lưu đúng quy cách và vị trí kho để tự nhận khi quét nhập kho.</span>
              </div>
            </Form>
            {issuedQrLabels.length > 0 && (
              <div className="hu-qr-issued-result">
                <Flex justify="space-between" align="center" gap={12} wrap="wrap">
                  <b>Đã tạo {issuedQrLabels.length} tem QR</b>
                  <Flex gap={8} align="center" wrap="wrap">
                    <Button type="primary" icon={<PrinterOutlined />} loading={isExportingLabelPdf} onClick={() => handlePrintLabels(printUnits, "A6")}>
                      PDF A6 · 100×150
                    </Button>
                    <Button icon={<PrinterOutlined />} loading={isExportingLabelPdf} onClick={() => handlePrintLabels(printUnits, "A7")}>
                      PDF A7 · 75×100
                    </Button>
                  </Flex>
                </Flex>
                <div className="hu-qr-issued-codes">{issuedQrLabels.slice(0, 12).map((label) => <Tag key={label.code} color="green">{label.code}</Tag>)}{issuedQrLabels.length > 12 && <Tag>+{issuedQrLabels.length - 12} tem</Tag>}</div>
              </div>
            )}
          </>
        ) : (
          <div className="hu-qr-ledger">
            <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
              <div><b>Danh sách tem đã phát hành</b><Typography.Text type="secondary"> · In lại tem bất kỳ lúc nào</Typography.Text></div>
              <Tag color="blue">{workspace.qrLabels.length} tem còn hiệu lực</Tag>
            </Flex>
            {workspace.qrLabels.length ? (
              <div className="hu-qr-ledger-list">
                {workspace.qrLabels.map((label) => (
                  <div className="hu-qr-ledger-row" key={label.code}>
                    <span><QrcodeOutlined /></span>
                    <div>
                      <b>{label.code}</b>
                      <small>{label.sku} · {label.packagingName} = {fmt(Number(label.conversionFactor))} {label.baseUnit}</small>
                      <small>Vị trí: {locationFor({ location: qrLabelLocation(label) } as UnitRow)}</small>
                    </div>
                    <div className="hu-qr-ledger-meta">
                      <small>{label.supplierName || "Chưa gán NCC"}</small>
                      <div>
                        <Tag color={label.status === "printed" ? "green" : label.status === "issued" ? "blue" : "gold"}>{label.status === "printed" ? "Đã in / chưa nhập" : label.status === "issued" ? "Chờ in" : "Đang quét"}</Tag>
                        {(label.status === "issued" || label.status === "printed") && (
                          <Flex gap={4} wrap="wrap" justify="end">
                            <Button size="small" type="primary" icon={<PrinterOutlined />} loading={isExportingLabelPdf} onClick={() => openQrLabelPrint(label, "A6")}>
                              {label.status === "printed" ? "In lại A6" : "In A6"}
                            </Button>
                            <Button size="small" icon={<PrinterOutlined />} loading={isExportingLabelPdf} onClick={() => openQrLabelPrint(label, "A7")}>
                              {label.status === "printed" ? "In lại A7" : "In A7"}
                            </Button>
                          </Flex>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa phát hành tem QR nào" />}
          </div>
        )}
      </Modal>
      <Modal
        open={showQuickCreate}
        onCancel={() => setShowQuickCreate(false)}
        footer={null}
        width={1180}
        destroyOnHidden
        className="hu-quick-create-modal"
        title={<div className="hu-quick-modal-title"><QrcodeOutlined /> <span>Nhập kho nhanh</span><small>Quét hàng nguyên kiện hoặc thêm thủ công cho hàng lẻ</small></div>}
      >
        <div className="hu-quick-create">
          <section className="hu-quick-scan-workspace">
            <div className="hu-quick-entry-guide"><b>Tách hàng trước khi nhập</b><p>Ví dụ 1.000 gói: nhập lần lượt 300, 300, 300 và 100. Hệ thống tạo từng kiện và in tem số thứ tự sau khi xác nhận.</p><Button size="small" type="link" onClick={() => setShowLegacyQrEntry(value => !value)}>{showLegacyQrEntry ? 'Ẩn ô quét QR' : 'Hiện ô quét QR'}</Button></div>
            {showLegacyQrEntry && <>
            <div className="hu-quick-scan-head">
              <div>
                <h3>Quét QR kiện hàng</h3>
                <p>Quét mã QR trên tem đã phát hành để tự điền đúng SKU, quy cách và số lượng kiện.</p>
              </div>
              <span className="hu-quick-ready"><i /> Sẵn sàng quét</span>
            </div>
            <Input
              ref={quickScanInputRef}
              autoFocus
              className="hu-quick-scan-input"
              prefix={<QrcodeOutlined />}
              placeholder="Đang chờ quét QR..."
              onChange={() => {
                if (quickScanError) setQuickScanError("");
              }}
              onPressEnter={(event) => addQuickScan(event.currentTarget.value)}
              suffix={<Button type="link" onClick={() => addQuickScan()}>Thêm</Button>}
            />
            {quickScanError && (
              <Alert
                className="hu-quick-scan-error"
                type="error"
                showIcon
                message={quickScanError}
              />
            )}
            {quickLastCode && (
              <div className="hu-quick-last-scan">
                <CheckCircleOutlined /> Đã quét: <b>{quickLastCode}</b>
              </div>
            )}
            </>}
            <div className="hu-quick-manual-entry">
              <div className="hu-quick-manual-title">
                <div><PlusOutlined /><span><b>Thêm một kiện</b><small>Ghi đúng số lượng ban đầu thực tế của kiện đã tách</small></span></div>
              </div>
              <div className="hu-quick-manual-fields">
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={quickManualSku}
                  placeholder="Chọn SKU / màu của kiện"
                  options={workspace.catalog.map((item) => ({
                    value: item.sku,
                    label: `${item.sku} · ${item.variantName} (${item.unitName})`,
                  }))}
                  onChange={(sku) => setQuickManualSku(sku)}
                />
                <InputNumber
                  min={1}
                  precision={0}
                  value={quickManualQuantity}
                  placeholder="Số lượng"
                  addonAfter={workspace.catalog.find((item) => item.sku === quickManualSku)?.unitName || "ĐVT"}
                  onChange={(value) => setQuickManualQuantity(Number(value || 0) || undefined)}
                  onPressEnter={addQuickManualLine}
                />
                <Select
                  showSearch
                  optionFilterProp="label"
                  value={quickManualSupplierId}
                  placeholder="Nhà cung cấp"
                  options={workspace.suppliers.map((supplier: any) => ({
                    value: Number(supplier.id),
                    label: supplier.name,
                  }))}
                  onChange={(supplierId) => setQuickManualSupplierId(Number(supplierId))}
                />
                <Button type="primary" icon={<PlusOutlined />} onClick={addQuickManualLine}>Thêm</Button>
              </div>
            </div>
            <div className="hu-quick-list-head">
              <b>Danh sách hàng nhập ({quickLoadTotal} kiện · {quickManualLines.length} dòng thủ công)</b>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => setQuickScanLines([])} disabled={!quickScanLines.length}>Xóa tất cả</Button>
            </div>
            <div className="hu-quick-lines" aria-live="polite">
              {quickScanLines.length ? quickScanLines.map((line) => (
                <div className={`hu-quick-line ${line.source === "MANUAL" ? "is-manual" : ""}`} key={line.id}>
                  <span className="hu-quick-qr">{line.source === "MANUAL" ? <PlusOutlined /> : <QrcodeOutlined />}</span>
                  <div className="hu-quick-product"><b>{line.productName}</b><small>{line.source === "MANUAL" ? `${line.sku} · Hàng lẻ · ${line.supplierName}` : `${line.sku} · ${line.packagingName} · 1 ${line.packagingName} = ${fmt(line.conversionFactor)} ${line.baseUnit}`}</small></div>
                  {line.source !== "MANUAL" && <span className="hu-quick-fixed-load">1 kiện</span>}
                  {line.source !== "MANUAL" && <span className="hu-quick-equals">=</span>}
                  <b className="hu-quick-conversion">{fmt(line.conversionFactor)} {line.baseUnit}</b>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setQuickScanLines((previous) => previous.filter((item) => item.id !== line.id))} aria-label={`Xóa ${line.qrCode || line.sku}`} />
                </div>
              )) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Thêm từng kiện đã tách thực tế để bắt đầu" className="hu-quick-empty" />
              )}
            </div>
            <div className="hu-quick-total"><InboxOutlined /><span>Tạm nhập kho:</span>{quickLoadTotal > 0 && <b>{quickLoadTotal} kiện</b>}{quickLoadTotal > 0 && quickManualLines.length > 0 && <i>+</i>}{quickManualLines.length > 0 && <strong>{quickManualSummary} hàng lẻ</strong>}{quickManualLines.length === 0 && quickLoadTotal > 0 && <><i>=</i><strong>{fmt(quickPieceTotal)} {quickBaseUnit}</strong></>}</div>
          </section>
          <aside className="hu-quick-receipt">
            <div className="hu-quick-receipt-head"><h3>Phiếu nhập kho</h3><span>Đơn vị nhập: <b>{quickBaseUnit}</b></span></div>
            <dl className="hu-quick-receipt-meta">
              <div className="hu-quick-supplier-row">
                <dt>Nhà cung cấp</dt>
                <dd>
                  <span>{quickSupplierNames.length === 0 ? "Chưa xác định" : quickSupplierNames.length === 1 ? quickSupplierNames[0] : "Nhiều nhà cung cấp — sẽ tách phiếu"}</span>
                  {quickSupplierNames.length === 1 && <Tag color={quickManualLines.length ? "gold" : "green"}>{quickManualLines.length ? (quickQrLines.length ? "QR + thủ công" : "Thủ công") : "Từ QR"}</Tag>}
                  {quickQrLines.length > 0 && <Button type="link" size="small" onClick={() => message.info("Nhà cung cấp của kiện được xác định từ tem quét. Hàng lẻ chọn nhà cung cấp ngay khi thêm thủ công.")}>Đổi</Button>}
                </dd>
              </div>
              <div><dt>Mã phiếu nhập</dt><dd>Tự tạo khi xác nhận</dd></div>
              <div><dt>Ngày nhập</dt><dd>Ghi nhận khi xác nhận</dd></div>
            </dl>
            <div className="hu-quick-company-groups">
              {quickReceiptCompanyGroups.length ? quickReceiptCompanyGroups.map((group) => (
                <section className={`hu-quick-company-group ${group.companyName === "Chưa gán công ty" ? "is-unassigned" : ""}`} key={group.companyName}>
                  <header className="hu-quick-company-header">
                    <div>
                      <span>Công ty hàng hóa</span>
                      <b>{group.companyName}</b>
                    </div>
                    <Tag color={group.companyName === "Chưa gán công ty" ? "error" : "purple"}>{group.rows.length} SKU</Tag>
                  </header>
                  <div className="hu-quick-receipt-table">
                    <div className="hu-quick-receipt-table-head hu-quick-receipt-table-head-edit"><span>Sản phẩm</span><span>ĐVT</span><span>SL</span><span>Giá nhập</span></div>
                    {group.rows.map((line) => (
                      <div className="hu-quick-receipt-table-row hu-quick-receipt-table-row-edit" key={line.sku}>
                        <div>
                          <span>{line.productName}</span>
                          {quickCompanyIdForSku(line.sku) ? (
                            <small className="hu-quick-company-static">{quickCompanyForSku(line.sku)}</small>
                          ) : (
                            <Select
                              size="small"
                              showSearch
                              optionFilterProp="label"
                              status="error"
                              placeholder="Chọn lần đầu · sẽ ghi nhớ"
                              options={quickGoodsCompanies.map((company) => ({ value: String(company.id), label: company.name }))}
                              onChange={(companyId) => void changeQuickSkuCompany(line.sku, companyId)}
                            />
                          )}
                        </div>
                        <span>{line.baseUnit}</span>
                        <b>{fmt(line.quantity)}</b>
                        <InputNumber min={0} precision={0} value={quickPriceBySku[line.sku]} placeholder="Giá" addonAfter="đ" onChange={(value) => setQuickPriceBySku((previous) => ({ ...previous, [line.sku]: Number(value || 0) }))} />
                      </div>
                    ))}
                    <div className="hu-quick-company-subtotal"><span>Tạm tính {group.companyName}</span><b>{fmt(group.total)} đ</b></div>
                  </div>
                </section>
              )) : <div className="hu-quick-receipt-placeholder">Chưa có sản phẩm quét</div>}
              {quickReceiptCompanyGroups.length > 0 && <div className="hu-quick-receipt-total"><span>Tổng tiền chưa VAT</span><b>{fmt(quickReceiptTotal)} đ</b></div>}
            </div>
            <input ref={quickReceiptInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={(event) => { const file = event.target.files?.[0] || null; setQuickReceiptFile(file); setQuickReceiptFileName(file?.name || ""); }} />
            <button type="button" className="hu-quick-upload" onClick={() => quickReceiptInputRef.current?.click()}><InboxOutlined /><b>Tải phiếu nhập kho</b><small>Kéo thả file hoặc bấm để chọn file</small></button>
            {quickReceiptFileName && <div className="hu-quick-file"><CheckCircleOutlined /> {quickReceiptFileName}<span>Sẽ upload Cloudflare R2</span></div>}
          </aside>
        </div>
        <footer className="hu-quick-footer"><span>Mỗi dòng là <b>một kiện đã tách thực tế, tối đa 300</b>. Nhập đúng số lượng; tem ghi số thứ tự riêng, không cần quét QR khi nhập thủ công.</span><div><Button onClick={() => setShowQuickCreate(false)}>Hủy</Button><Button type="primary" icon={<CheckCircleOutlined />} disabled={!quickScanLines.length || isQuickConfirming} loading={isQuickConfirming} onClick={confirmQuickReceiving}>Xác nhận nhập & tạo kiện</Button></div></footer>
      </Modal>
      {/* MODAL TẠO KIỆN HÀNG MỚI */}
      <Modal
        title={
          <Flex align="center" gap={8}>
            <InboxOutlined style={{ color: "#00b96b", fontSize: 20 }} />
            <div>
              <b>Tạo kiện hàng mới (Nhập kho / Phân kiện)</b>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: 12 }}
              >
                Định danh kiện vật lý, chọn quy cách (Tải / Thùng / Lẻ) và quy
                đổi theo đơn vị cơ sở của SKU
              </Typography.Text>
            </div>
          </Flex>
        }
        open={showAllocation}
        onCancel={() => {
          setShowAllocation(false);
          allocationForm.resetFields();
        }}
        onOk={allocateUnits}
        okText="Tạo kiện ngay"
        confirmLoading={isAllocating}
        width={940}
        destroyOnHidden
        className="hu-create-package-modal"
      >
        <Form
          form={allocationForm}
          layout="vertical"
          initialValues={{
            packageMethod: "TAI",
            packageCount: 1,
            conversionFactor: 1200,
            looseQty: 0,
            zone: "A1",
          }}
        >
          {/* 1. MÃ SKU & TÊN SẢN PHẨM */}
          <div className="hu-alloc-section">
            <Form.Item
              name="sku"
              label="1. Chọn mã SKU sản phẩm"
              rules={[
                { required: true, message: "Vui lòng chọn SKU sản phẩm" },
              ]}
              style={{ marginBottom: 8 }}
            >
              <Select
                showSearch
                placeholder="Chọn hoặc tìm kiếm SKU..."
                optionFilterProp="label"
                onChange={(skuVal) => {
                  const product = workspace.catalog.find((item) => item.sku === skuVal);
                  const preferredSpec = latestPackagingSpec(workspace.packagingSpecs, skuVal);
                  const isBoxUnit = normalizeUnitName(product?.unitName).includes("hop");
                  const method = isBoxUnit
                    ? "THUNG"
                    : preferredSpec
                      ? packagingMethodForSpec(preferredSpec)
                      : allocationForm.getFieldValue("packageMethod") || "TAI";
                  const spec = latestPackagingSpec(workspace.packagingSpecs, skuVal, method)
                    || (isBoxUnit ? undefined : preferredSpec);
                  allocationForm.setFieldValue("packageMethod", method);
                  if (method === "TAI" || method === "THUNG") {
                    allocationForm.setFieldValue(
                      "conversionFactor",
                      spec?.conversionFactor || (method === "THUNG" ? 50 : 1200),
                    );
                  } else {
                    allocationForm.setFieldValue("looseQty", undefined);
                  }
                }}
                options={workspace.catalog.map((item) => ({
                  value: item.sku,
                  label: `${item.sku} · ${item.variantName} (${item.color || "Tiêu chuẩn"})`,
                }))}
              />
            </Form.Item>

            {currentAllocProduct && (
              <div className="hu-alloc-sku-preview">
                <div className="hu-alloc-sku-header">
                  <span
                    className="hu-sku-dot"
                    style={{
                      backgroundColor: getColorDot(
                        currentAllocProduct.color,
                        currentAllocProduct.sku,
                      ).dot,
                      borderColor: getColorDot(
                        currentAllocProduct.color,
                        currentAllocProduct.sku,
                      ).border,
                    }}
                  />
                  <strong>
                    2. Tên sản phẩm: {currentAllocProduct.variantName}
                  </strong>
                </div>
                <div className="hu-alloc-sku-stats">
                  <div>
                    <small>TỒN QUẢN LÝ KIỆN</small>
                    <b>
                      {fmt(currentAllocAllocated)} {currentAllocProduct.unitName}
                    </b>
                  </div>
                  <div>
                    <small>TỒN PHẦN MỀM THAM KHẢO</small>
                    <b>
                      {fmt(currentAllocProduct.stock)} {currentAllocProduct.unitName}
                    </b>
                  </div>
                  <div
                    className={
                      currentAllocDifference !== 0 ? "has-unallocated" : ""
                    }
                  >
                    <small>CHÊNH LỆCH ĐỐI CHIẾU</small>
                    <b>
                      {fmtSigned(currentAllocDifference)} {currentAllocProduct.unitName}
                    </b>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. PHƯƠNG THỨC ĐÓNG GÓI: TẢI, THÙNG, LẺ */}
          <div className="hu-alloc-section" style={{ marginTop: 14 }}>
            <Form.Item
              name="packageMethod"
              label="3. Phương thức đóng gói (Quy cách kiện)"
              rules={[{ required: true }]}
              style={{ marginBottom: 12 }}
            >
              <Radio.Group
                buttonStyle="solid"
                className="hu-method-radio-group"
                onChange={(e) => {
                  const m = e.target.value;
                  if (m === "TAI" || m === "THUNG") {
                    const spec = latestPackagingSpec(
                      workspace.packagingSpecs,
                      allocationForm.getFieldValue("sku"),
                      m,
                    );
                    allocationForm.setFieldValue(
                      "conversionFactor",
                      Math.min(300, Number(spec?.conversionFactor || (m === "THUNG" ? 50 : 300))),
                    );
                  } else {
                    allocationForm.setFieldValue("looseQty", undefined);
                  }
                }}
              >
                <Radio.Button value="TAI">
                  🎒 <b>Tải</b> (Tải dứa)
                </Radio.Button>
                <Radio.Button value="THUNG">
                  📦 <b>Thùng</b> (Thùng carton)
                </Radio.Button>
                <Radio.Button value="LE">
                  🛍️ <b>Lẻ</b> (Túi lẻ / Hàng rời)
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            {/* CÁC TRƯỜNG NHẬP THEO PHƯƠNG THỨC */}
            {watchAllocMethod === "TAI" && (
              <Flex gap={12}>
                <Form.Item
                  name="packageCount"
                  label="Số lượng tải cần tạo"
                  rules={[{ required: true, message: "Nhập số lượng tải" }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter="tải"
                    placeholder="Ví dụ: 1, 2, 5..."
                  />
                </Form.Item>
                <Form.Item
                  name="conversionFactor"
                  label={`Quy cách (Số ${currentAllocUnitName} mỗi tải)`}
                  rules={[{ required: true, message: `Nhập số ${currentAllocUnitName} mỗi tải` }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    max={300}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter={`${currentAllocUnitName}/tải`}
                    placeholder={`Tối đa 300 ${currentAllocUnitName}/tải`}
                  />
                </Form.Item>
              </Flex>
            )}

            {watchAllocMethod === "THUNG" && (
              <Flex gap={12}>
                <Form.Item
                  name="packageCount"
                  label="Số lượng thùng cần tạo"
                  rules={[{ required: true, message: "Nhập số lượng thùng" }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter="thùng"
                    placeholder="Ví dụ: 1, 5, 10..."
                  />
                </Form.Item>
                <Form.Item
                  name="conversionFactor"
                  label={`Quy cách (Số ${currentAllocUnitName} mỗi thùng)`}
                  rules={[{ required: true, message: `Nhập số ${currentAllocUnitName} mỗi thùng` }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    max={300}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter={`${currentAllocUnitName}/thùng`}
                    placeholder={`Tối đa 300 ${currentAllocUnitName}/thùng`}
                  />
                </Form.Item>
              </Flex>
            )}

            {watchAllocMethod === "LE" && (
              <Form.Item
                name="looseQty"
                label={`Số lượng ${currentAllocUnitName} lẻ tạo kiện`}
                rules={[
                  { required: true, message: `Nhập số ${currentAllocUnitName} lẻ` },
                ]}
                style={{ marginBottom: 8 }}
              >
                <InputNumber
                  min={1}
                  max={300}
                  precision={0}
                  style={{ width: "100%" }}
                  addonAfter={currentAllocUnitName}
                  placeholder="Nhập số lượng kiểm đếm thực tế"
                />
              </Form.Item>
            )}

            {/* 4. TÍNH TOÁN QUY ĐỔI RA ĐƠN VỊ CƠ SỞ CỦA SKU */}
            <div className="hu-alloc-calc-banner">
              <div className="hu-alloc-calc-text">
                <span className="hu-calc-label">
                  4. TỔNG SỐ LƯỢNG QUY ĐỔI ({currentAllocUnitName.toLocaleUpperCase("vi-VN")}):
                </span>
                <b className="hu-calc-total">
                  {watchAllocMethod === "LE"
                    ? `${fmt(watchAllocLooseQty)} ${currentAllocUnitName}`
                    : `${watchAllocCount} kiện × ${fmt(watchAllocFactor)} ${currentAllocUnitName} = ${fmt(totalCalculatedQuantity)} ${currentAllocUnitName}`}
                </b>
              </div>
              <Tag color="green" style={{ fontSize: 13, padding: "4px 10px" }}>
                Đơn vị cơ sở: {currentAllocUnitName}
              </Tag>
            </div>
          </div>

          {/* 5. VỊ TRÍ LƯU KHO & THÔNG TIN PHIẾU */}
          <div className="hu-alloc-section" style={{ marginTop: 14 }}>
            <Form.Item
              name="zone"
              label="5. Chọn khu vực lưu trữ trên sơ đồ"
              rules={[{ required: true, message: "Chọn khu vực lưu trữ" }]}
              style={{ marginBottom: 12 }}
            >
              <AllocationZonePicker
                units={workspace.register}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="Chuyển kiện"
        className="hu-transfer-modal"
        open={!!mergeReturnUnit}
        onCancel={() => {
          if (isMergingReturnUnit) return;
          setMergeReturnUnit(null);
          setMergeTargetCode("");
          setMergeQuantity(null);
        }}
        onOk={handleMergeReturnUnit}
        okText="Xác nhận chuyển"
        confirmLoading={isMergingReturnUnit}
        okButtonProps={{
          disabled: !Number.isSafeInteger(mergeQuantity) || Number(mergeQuantity) <= 0
            || Number(mergeQuantity) > getTransferMaximumQuantity(mergeReturnUnit, mergeTargetCode),
        }}
        closable={!isMergingReturnUnit}
        maskClosable={!isMergingReturnUnit}
        cancelButtonProps={{ disabled: isMergingReturnUnit }}
        destroyOnHidden
      >
        {mergeReturnUnit && (() => {
          const targets = getReturnMergeTargets(mergeReturnUnit);
          const candidates = getTransferCandidates(mergeReturnUnit)
            .sort((a, b) => (displaySequenceByUnitId.get(a.id) || a.sequenceNumber || Number.MAX_SAFE_INTEGER)
              - (displaySequenceByUnitId.get(b.id) || b.sequenceNumber || Number.MAX_SAFE_INTEGER)
              || a.id.localeCompare(b.id));
          const compact = candidates.length === 2;
          const selectedTarget = candidates.find(unit => unit.id === mergeTargetCode);
          const maximumQuantity = getTransferMaximumQuantity(mergeReturnUnit, mergeTargetCode);
          const swapDirection = () => {
            if (!selectedTarget || isMergingReturnUnit) return;
            setMergeReturnUnit(selectedTarget);
            setMergeTargetCode(mergeReturnUnit.id);
            const nextMaximum = getTransferMaximumQuantity(selectedTarget, mergeReturnUnit.id);
            setMergeQuantity(quantity => quantity && quantity <= nextMaximum ? quantity : null);
            mergeReturnOperationKeyRef.current = `merge-return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          };
          const compactCard = (unit: UnitRow, role: "source" | "target") => (
            <div className="hu-transfer-card is-selected" data-role={role}>
              <img src={imageFor(unit)} alt="" />
              <span className="hu-transfer-card-main">
                <strong>Kiện {displaySequenceByUnitId.get(unit.id) || unit.sequenceNumber || unit.id}</strong>
                <span><b>{fmt(unit.currentPcs)}</b> {unit.unitName} <small>/ {fmt(capacityForUnit(unit))}</small></span>
                <small className="hu-transfer-code">{unit.id}</small>
              </span>
            </div>
          );
          const transferQuantity = Number.isSafeInteger(mergeQuantity) && Number(mergeQuantity) > 0 && Number(mergeQuantity) <= maximumQuantity
            ? Number(mergeQuantity) : 0;
          const card = (unit: UnitRow, role: "source" | "target") => {
            const selected = role === "source" ? unit.id === mergeReturnUnit.id : unit.id === mergeTargetCode;
            const canReceive = targets.some(target => target.id === unit.id);
            const disabled = role === "source"
              ? Number(unit.currentPcs) <= 0 || !!getPendingCheckConflict(unit, workspace.register)
              : !canReceive;
            const sequence = displaySequenceByUnitId.get(unit.id) || unit.sequenceNumber;
            return (
              <button
                type="button"
                key={unit.id}
                className={`hu-transfer-card ${selected ? "is-selected" : ""}`}
                data-role={role}
                disabled={disabled || isMergingReturnUnit}
                aria-pressed={selected}
                onClick={() => {
                  if (role === "source") {
                    setMergeReturnUnit(unit);
                    setMergeTargetCode("");
                    setMergeQuantity(null);
                  } else {
                    setMergeTargetCode(unit.id);
                    setMergeQuantity(null);
                  }
                }}
              >
                <img src={imageFor(unit)} alt="" />
                <span className="hu-transfer-card-main">
                  <strong>{sequence ? `Kiện ${sequence}` : unit.id}</strong>
                  <span><b>{fmt(unit.currentPcs)}</b> {unit.unitName} <small>/ {fmt(capacityForUnit(unit))}</small></span>
                  <small className="hu-transfer-code">{unit.id}</small>
                </span>
                <span className="hu-transfer-radio" aria-hidden="true" />
              </button>
            );
          };
          return (
            <div className="hu-transfer-body">
              {compact && selectedTarget ? <div className="hu-transfer-pickers hu-transfer-pickers--compact">
                <section className="hu-transfer-zone">
                  <h3>Kiện chuyển đi</h3>
                  {compactCard(mergeReturnUnit, "source")}
                </section>
                <button type="button" className="hu-transfer-swap" title="Đổi chiều chuyển"
                  disabled={isMergingReturnUnit || Number(selectedTarget.currentPcs) <= 0 || !!getPendingCheckConflict(selectedTarget, workspace.register)}
                  onClick={swapDirection}><SwapOutlined /><span>Đổi chiều</span></button>
                <section className="hu-transfer-zone">
                  <h3>Kiện nhận</h3>
                  {compactCard(selectedTarget, "target")}
                </section>
              </div> : <div className="hu-transfer-pickers">
                <section className="hu-transfer-zone">
                  <h3>1. Nguồn kiện chuyển đi</h3>
                  <div className="hu-transfer-list">{candidates.map(unit => card(unit, "source"))}</div>
                </section>
                <span className="hu-transfer-arrow" aria-hidden="true">→</span>
                <section className="hu-transfer-zone">
                  <h3>2. Kiện nhận</h3>
                  <div className="hu-transfer-list">{candidates.map(unit => card(unit, "target"))}</div>
                </section>
              </div>}
              <div className="hu-transfer-sku">Chỉ chuyển cùng SKU: <strong>{mergeReturnUnit.skuName}</strong></div>
              {selectedTarget && maximumQuantity <= 0 && <Alert type="warning" showIcon message={isReturnHandlingUnit(selectedTarget)
                ? "Kiện hàng hoàn chỉ được chuyển đi. Bấm đổi chiều để chọn kiện nhận phù hợp."
                : Number(mergeReturnUnit.currentPcs) <= 0 ? "Kiện chuyển đi đã hết hàng."
                : "Kiện nhận đã đầy, không còn sức chứa. Bấm đổi chiều hoặc chọn kiện nhận khác."} />}
              <div className="hu-transfer-quantity">
                <label htmlFor="hu-transfer-quantity">Số lượng chuyển</label>
                <button type="button" disabled={maximumQuantity <= 0 || isMergingReturnUnit} onClick={() => setMergeQuantity(Math.max(1, Number(mergeQuantity || 1) - 1))}>−</button>
                <InputNumber id="hu-transfer-quantity" min={1} max={maximumQuantity || undefined} precision={0}
                  disabled={maximumQuantity <= 0 || isMergingReturnUnit} value={mergeQuantity ?? undefined}
                  onChange={value => setMergeQuantity(value === null ? null : Number(value))}
                  addonAfter={mergeReturnUnit.unitName} placeholder="Nhập số lượng" />
                <button type="button" disabled={maximumQuantity <= 0 || isMergingReturnUnit} onClick={() => setMergeQuantity(Math.min(maximumQuantity, Number(mergeQuantity || 0) + 1))}>+</button>
                <div className="hu-transfer-presets">
                  {[10, 30, 50].map(quantity => <button type="button" key={quantity}
                    className={mergeQuantity === quantity ? "is-selected" : ""}
                    disabled={!selectedTarget || quantity > maximumQuantity || isMergingReturnUnit}
                    onClick={() => setMergeQuantity(quantity)}>{quantity}</button>)}
                </div>
                {selectedTarget && <small>Tối đa {fmt(maximumQuantity)} {mergeReturnUnit.unitName}</small>}
              </div>
              <div className="hu-transfer-preview">
                <div className="hu-transfer-preview-heading"><strong>Xem trước thay đổi</strong><span>Tổng tồn không đổi</span></div>
                <div><span>{`Kiện ${displaySequenceByUnitId.get(mergeReturnUnit.id) || mergeReturnUnit.sequenceNumber || mergeReturnUnit.id}`}</span><b>{fmt(mergeReturnUnit.currentPcs)}</b><span>→</span><strong>{transferQuantity ? fmt(Number(mergeReturnUnit.currentPcs) - transferQuantity) : "—"} {mergeReturnUnit.unitName}</strong></div>
                <div><span>{selectedTarget ? `Kiện ${displaySequenceByUnitId.get(selectedTarget.id) || selectedTarget.sequenceNumber || selectedTarget.id}` : "Chọn kiện nhận"}</span><b>{selectedTarget ? fmt(selectedTarget.currentPcs) : "—"}</b><span>→</span><strong>{selectedTarget && transferQuantity ? fmt(Number(selectedTarget.currentPcs) + transferQuantity) : "—"} {mergeReturnUnit.unitName}</strong></div>
              </div>
            </div>
          );
        })()}
      </Modal>


      <Modal
        className="hu-split-modal"
        title={
          <Flex align="center" gap={8}>
            <ScissorOutlined style={{ color: "#0284c7" }} />
            <span>Tách kiện {splittingUnit?.id}</span>
          </Flex>
        }
        open={!!splittingUnit}
        onCancel={() => {
          if (!isSplittingUnit) setSplittingUnit(null);
        }}
        footer={null}
        width={620}
        destroyOnHidden
        maskClosable={!isSplittingUnit}
      >
        {splittingUnit && (() => {
          const quantities = buildSplitQuantities(
            splittingUnit.currentPcs,
            splitTargetSize,
          );
          const isValid = quantities.length >= 2 && quantities.length <= 20 && quantities.every((quantity) => quantity <= 300);
          return (
            <div className="hu-split-modal-body">
              <div className="hu-split-source">
                <div>
                  <small>KIỆN CHA</small>
                  <b>{splittingUnit.id}</b>
                  <span>{splittingUnit.skuName}</span>
                </div>
                <div>
                  <small>TỒN HIỆN TẠI</small>
                  <strong>{fmt(splittingUnit.currentPcs)}</strong>
                  <span>{splittingUnit.unitName}</span>
                </div>
              </div>

              <label className="hu-split-size-label">
                Kích thước tối đa mỗi kiện con
              </label>
              <InputNumber
                className="hu-split-size-input"
                min={1}
                max={Math.min(300, Math.max(1, splittingUnit.currentPcs - 1))}
                precision={0}
                controls={false}
                value={splitTargetSize}
                parser={(value) => {
                  const digits = String(value || "").replace(/[^0-9]/g, "");
                  return Number(digits.replace(/^0+(?=\d)/, "") || 0);
                }}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(value) =>
                  setSplitTargetSize(Math.floor(Number(value || 0)))
                }
                onBlur={() =>
                  setSplitTargetSize((value) =>
                    Math.min(
                      Math.max(1, Math.floor(Number(value || 1))),
                      Math.min(300, Math.max(1, splittingUnit.currentPcs - 1)),
                    ),
                  )
                }
                addonAfter={splittingUnit.unitName}
                disabled={isSplittingUnit}
              />

              <div className="hu-split-preview">
                <Flex justify="space-between" align="center" gap={8}>
                  <b>Kết quả dự kiến</b>
                  <Tag color={isValid ? "green" : "red"}>
                    {quantities.length || 0} kiện con
                  </Tag>
                </Flex>
                {quantities.length ? (
                  <div className="hu-split-quantity-list">
                    {quantities.map((quantity, index) => (
                      <span key={`${quantity}-${index}`}>
                        Kiện {index + 1}: <b>{fmt(quantity)}</b>
                      </span>
                    ))}
                  </div>
                ) : (
                  <Typography.Text type="danger">
                    Kích thước kiện con phải nhỏ hơn tồn hiện tại.
                  </Typography.Text>
                )}
                <div className="hu-split-equation">
                  {quantities.length
                    ? `${quantities.map(fmt).join(" + ")} = ${fmt(quantities.reduce((sum, quantity) => sum + quantity, 0))} ${splittingUnit.unitName}`
                    : "Chưa có phương án tách hợp lệ"}
                </div>
              </div>

              <Alert
                type="warning"
                showIcon
                message="Xác nhận sau khi đã tách hàng ngoài kho"
                description="Kiện cha chuyển sang Đã tách để giữ lịch sử. Mỗi kiện con có số thứ tự và tem mới, ghi đúng số lượng thực tế; tổng tồn sản phẩm không thay đổi."
              />

              <Flex justify="flex-end" gap={8}>
                <Button
                  onClick={() => setSplittingUnit(null)}
                  disabled={isSplittingUnit}
                >
                  Hủy
                </Button>
                <Button
                  type="primary"
                  icon={<ScissorOutlined />}
                  loading={isSplittingUnit}
                  disabled={!isValid}
                  onClick={() => void handleSplitUnit()}
                  style={{ background: "#0284c7", borderColor: "#0284c7" }}
                >
                  Xác nhận tách và in tem
                </Button>
              </Flex>
            </div>
          );
        })()}
      </Modal>

      {/* MODAL IN TEM DÁN TẢI / KIỆN HÀNG (A6 / A7) */}
      <Modal
        className="hu-print-modal"
        rootClassName={isExportingLabelPdf ? "hu-print-modal-exporting" : undefined}
        title={
          <Flex align="center" gap={8}>
            <PrinterOutlined style={{ color: "#0284c7", fontSize: 20 }} />
            <div>
              <b>In tem số kiện · Màu sắc · SKU</b>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: 12 }}
              >
                {printUnits.length || (detail ? 1 : 0)} kiện · Mỗi kiện một tem
                riêng, định dạng A6 hoặc A7
              </Typography.Text>
            </div>
          </Flex>
        }
        open={showPrintModal && (printUnits.length > 0 || !!detail)}
        onCancel={() => {
          setShowPrintModal(false);
          setPrintUnits([]);
        }}
        footer={null}
        width={760}
        destroyOnHidden
      >
        {(printUnits.length > 0 ? printUnits : detail ? [detail] : []).length >
          0 && (
          <div className="hu-print-preview-wrapper">
            {(printUnits.length > 0 ? printUnits : detail ? [detail] : []).map(
              (unit) => {
                const catalogItem = workspace.catalog.find(
                  (item) => item.sku === unit.skuName,
                );
                return (
                  <HandlingUnitPrintLabel
                    key={unit.id}
                    unit={unit}
                    labelSize={printLabelSize}
                    catalogColor={catalogItem?.color}
                  />
                );
              },
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
