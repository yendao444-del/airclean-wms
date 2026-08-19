import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  QRCode,
  Radio,
  Segmented,
  Select,
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
  RobotOutlined,
  UnlockOutlined,
  LockOutlined,
  ShoppingCartOutlined,
  SendOutlined,
  RightOutlined,
  QrcodeOutlined,
  PrinterOutlined,
  CompassOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { Warehouse2DMap } from "../components/Warehouse2DMap";
import sealedSackImage from "../assets/warehouse-sack-sealed.png";
import openedSackImage from "../assets/warehouse-sack-opened.png";
import plainCartonImage from "../assets/plain-kraft-carton.png";
import maskPouchImage from "../assets/unbranded-mask-pouch.png";
import "./HandlingUnits.css";

type CatalogItem = {
  sku: string;
  productGroup: string;
  variantName: string;
  color?: string;
  unitName: string;
  stock: number;
};
type UnitRow = {
  id: string;
  receiptCode?: string;
  skuName: string;
  packageType: string;
  packageLabel?: string;
  unitName: string;
  status: string;
  location?: { zone?: string; rack?: string };
  initialPcs: number;
  currentPcs: number;
  note?: string;
};
type LocationItem = {
  id: number;
  code: string;
  name: string;
  type: string;
  description?: string;
  isActive: boolean;
};
type Workspace = {
  catalog: CatalogItem[];
  register: UnitRow[];
  packagingSpecs: any[];
  locations: LocationItem[];
  recentTransactions: any[];
};

const ALLOCATION_ZONE_CODE_BY_MAP_KEY: Record<string, string> = {
  TOP_1: "A1",
  TOP_2: "A2",
  TOP_3: "A3",
  TOP_4: "A4",
  CENTER: "CENTER",
  PACKING: "Đóng gói",
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
const statusFor = (status: string) =>
  status === "Nguyên niêm phong" ? (
    <Tag color="green">Đã niêm phong</Tag>
  ) : status === "Đang sử dụng" ? (
    <Tag color="orange">Đang mở</Tag>
  ) : status === "Chờ kiểm" ? (
    <Tag color="gold">Chờ kiểm</Tag>
  ) : (
    <Tag>Đã hết hàng</Tag>
  );

const PICK_DESTINATIONS = {
  PACKING: {
    label: "Khu đóng gói",
    description: "Chuyển nội bộ, chưa làm giảm tồn SKU.",
    transactionType: "Chuyển khu đóng gói",
  },
  LOOSE: {
    label: "Khu hàng lẻ",
    description: "Chuyển nội bộ để soạn đơn lẻ, chưa làm giảm tồn SKU.",
    transactionType: "Chuyển hàng lẻ",
  },
  OUTBOUND: {
    label: "Chờ xuất kho",
    description: "Tồn SKU chỉ giảm khi phiếu xuất được xác nhận.",
    transactionType: "Chuyển chờ xuất kho",
  },
  QUARANTINE: {
    label: "Khu kiểm hàng",
    description: "Chuyển chờ kiểm/điều chỉnh; cần ghi chú lý do.",
    transactionType: "Chuyển khu kiểm hàng",
  },
} as const;

type PickDestination = keyof typeof PICK_DESTINATIONS;

const getPackageCategory = (packageType?: string): "TAI" | "THUNG" | "LE" => {
  const t = (packageType || "").toLowerCase();
  if (t.includes("tải") || t.includes("sack")) return "TAI";
  if (t.includes("thùng") || t.includes("carton") || t.includes("box"))
    return "THUNG";
  return "LE";
};

const getConflictingOpenedUnit = (
  targetUnit: UnitRow,
  allUnits: UnitRow[],
): UnitRow | null => {
  const cat = getPackageCategory(targetUnit.packageType);
  // Riêng với hàng Lẻ: Không bao giờ khóa khui
  if (cat === "LE") return null;

  return (
    allUnits.find((u) => {
      if (u.id?.toUpperCase() === targetUnit.id?.toUpperCase()) return false;
      if (u.skuName?.toUpperCase() !== targetUnit.skuName?.toUpperCase())
        return false;
      if (u.status !== "Đang sử dụng" && u.status !== "Chờ kiểm") return false;
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

// Product groups come from the catalog with this generic category prefix.
// Keep it in the stored data, but omit it from the SKU browser label.
const displayProductGroup = (name: string) =>
  name.replace(/^\s*khẩu\s*trang\s*/i, "").trim() || name;

const workspaceLayoutDefaults: Workspace = {
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
  ],
  recentTransactions: [],
};

// Product and handling-unit records are loaded only through the desktop IPC
// bridge. Locations remain local configuration for the warehouse floor plan.
const emptyWorkspace: Workspace = {
  ...workspaceLayoutDefaults,
  catalog: [],
  register: [],
  packagingSpecs: [],
  recentTransactions: [],
};

export default function HandlingUnits({ onExit }: { onExit?: () => void }) {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(
    () => Boolean(window.electronAPI?.handlingUnits?.getWorkspace),
  );
  const [selectedSku, setSelectedSku] = useState("");
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<UnitRow | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printUnits, setPrintUnits] = useState<UnitRow[]>([]);
  const [printLabelSize, setPrintLabelSize] = useState<"A6" | "A7">("A6");
  const [showLocations, setShowLocations] = useState(false);
  const [locationFocusUnit, setLocationFocusUnit] = useState<UnitRow | null>(null);
  const [showAllocation, setShowAllocation] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [allocationForm] = Form.useForm();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [locModalView, setLocModalView] = useState<"map" | "list">("map");

  const [selectedLocationCode, setSelectedLocationCode] =
    useState<string>("A1");
  const [locationSearch, setLocationSearch] = useState<string>("");
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [addLocationForm] = Form.useForm();
  const [movingUnit, setMovingUnit] = useState<UnitRow | null>(null);
  const [moveLocationForm] = Form.useForm();
  const [editingUnit, setEditingUnit] = useState<UnitRow | null>(null);
  const [editUnitForm] = Form.useForm();
  const [isSavingUnitEdit, setIsSavingUnitEdit] = useState(false);

  const showUnitLocation = (unit: UnitRow) => {
    setLocationFocusUnit(unit);
    setSelectedLocationCode(unit.location?.zone || "");
    setLocModalView("map");
    setShowLocations(true);
  };

  // Rút hàng sang Khu đóng gói
  const [showPickModal, setShowPickModal] = useState(false);
  const [pickingUnit, setPickingUnit] = useState<UnitRow | null>(null);
  const [pickForm] = Form.useForm();
  const [isSubmittingPick, setIsSubmittingPick] = useState(false);
  const isSubmittingPickRef = useRef(false);
  const pickRequestIdRef = useRef("");
  const [showFinalCheckModal, setShowFinalCheckModal] = useState(false);
  const [checkingUnit, setCheckingUnit] = useState<UnitRow | null>(null);
  const [finalCheckForm] = Form.useForm();
  const [isFinalizingCheck, setIsFinalizingCheck] = useState(false);
  const isFinalizingCheckRef = useRef(false);
  const finalPickVerification = Form.useWatch("finalVerification", finalCheckForm);

  // Telegram Bot modal & Interactive Chatbox
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [telegramTestMsg, setTelegramTestMsg] = useState("");
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [telegramChatLog, setTelegramChatLog] = useState<
    Array<{ id: string; sender: "user" | "bot"; text: string; time: string }>
  >([
    {
      id: "m-0",
      sender: "bot",
      text: "👋 Chào bạn! Bot <b>@quanlykienhang_bot</b> đã kết nối trực tiếp với kho. Bạn có thể gửi lệnh <code>/khui</code>, <code>/rut</code>, <code>/ton</code> từ ô bên dưới hoặc trực tiếp trên Telegram!",
      time: new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const loadWorkspace = async () => {
    try {
      if (window.electronAPI?.handlingUnits?.getWorkspace) {
        const res = await window.electronAPI.handlingUnits.getWorkspace();
        if (res?.success && res.data) {
          const catalog = Array.isArray(res.data.catalog) ? res.data.catalog : [];
          const register = Array.isArray(res.data.register) ? res.data.register : [];
          const rawData = res.data as any;
          setWorkspace((prev) => ({
            ...prev,
            catalog,
            register,
            recentTransactions: Array.isArray(rawData.recentTransactions)
              ? rawData.recentTransactions
              : [],
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
        }
      }
    } catch (err) {
      console.warn("Load handling units error:", err);
    } finally {
      setIsWorkspaceLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
    const intervalTimer = setInterval(() => {
      loadWorkspace();
    }, 2000);
    const unsub = window.electronAPI?.handlingUnits?.onChanged?.((evt) => {
      console.log("⚡ Handling units changed event:", evt);
      loadWorkspace();
    });
    return () => {
      clearInterval(intervalTimer);
      unsub?.();
    };
  }, []);

  const handleUnsealUnit = async (unit: UnitRow) => {
    try {
      const conflict = getConflictingOpenedUnit(unit, workspace.register);
      if (conflict) {
        const catLabel =
          getPackageCategory(unit.packageType) === "TAI" ? "Tải" : "Thùng";
        message.warning(
          `⚠️ Không thể khui! SKU [${unit.skuName}] đang có kiện ${catLabel} [${conflict.id}] đang mở (còn ${fmt(conflict.currentPcs)} ${conflict.unitName}). Vui lòng rút hết kiện cũ trước khi khui kiện ${catLabel} mới!`,
          6,
        );
        return;
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
            createdAt: new Date().toISOString(),
            type: "Khui kiện",
            quantity: unit.currentPcs,
            note: `Mở niêm phong kiện ${unit.id} để bắt đầu xuất lẻ`,
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
    } catch (err: any) {
      message.error(err?.message || "Lỗi khui kiện");
    }
  };

  const handleSealUnit = async (unit: UnitRow) => {
    try {
      if (window.electronAPI?.handlingUnits?.sealUnit) {
        const res = await window.electronAPI.handlingUnits.sealUnit({
          code: unit.id,
        });
        if (!res.success)
          throw new Error(res.error || "Không thể đóng niêm phong.");
      }
      setWorkspace((prev) => ({
        ...prev,
        register: prev.register.map((u) =>
          u.id === unit.id ? { ...u, status: "Nguyên niêm phong" } : u,
        ),
        recentTransactions: [
          {
            id: `TR-${Date.now()}`,
            unitId: unit.id,
            createdAt: new Date().toISOString(),
            type: "Đóng niêm phong",
            quantity: unit.currentPcs,
            note: `Đóng niêm phong lại kiện ${unit.id}`,
          },
          ...prev.recentTransactions,
        ],
      }));
      if (detail && detail.id === unit.id) {
        setDetail({ ...detail, status: "Nguyên niêm phong" });
      }
      message.success(
        `Đã đóng niêm phong lại kiện ${unit.id} (chuyển sang Nguyên niêm phong)!`,
      );
    } catch (err: any) {
      message.error(err?.message || "Lỗi đóng niêm phong");
    }
  };

  const handlePickUnit = (unit: UnitRow) => {
    pickRequestIdRef.current = `HU-PICK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPickingUnit(unit);
    pickForm.setFieldsValue({
      quantity: Math.min(50, unit.currentPcs),
    });
    setShowPickModal(true);
  };

  const handlePickSubmit = async () => {
    if (isSubmittingPickRef.current) return;
    if (!pickingUnit) return;
    isSubmittingPickRef.current = true;
    setIsSubmittingPick(true);
    try {
      const values = await pickForm.validateFields();
      const qty = Number(values.quantity || 0);
      const destination: PickDestination = "PACKING";
      const destinationMeta = PICK_DESTINATIONS[destination];
      if (qty <= 0 || qty > pickingUnit.currentPcs) {
        throw new Error(`Số lượng rút phải từ 1 đến ${pickingUnit.currentPcs}`);
      }
      const isFinalPick = qty === pickingUnit.currentPcs;
      const actualQty = qty;
      if (window.electronAPI?.handlingUnits?.pickUnit) {
        const res = await window.electronAPI.handlingUnits.pickUnit({
          code: pickingUnit.id,
          quantity: qty,
          destination,
          note: values.note,
          idempotencyKey: pickRequestIdRef.current,
        });
        if (!res.success) throw new Error(res.error || "Lỗi rút hàng.");
        if (res.data?.duplicate) return;
      }
      const remaining = pickingUnit.currentPcs - qty;
      const nextStatus = isFinalPick ? "Chờ kiểm" : "Đang sử dụng";
      setWorkspace((prev) => ({
        ...prev,
        register: prev.register.map((u) =>
          u.id === pickingUnit.id
            ? { ...u, currentPcs: remaining, status: nextStatus }
            : u,
        ),
        recentTransactions: [
          {
            id: `TR-${Date.now()}`,
            unitId: pickingUnit.id,
            createdAt: new Date().toISOString(),
            type: isFinalPick ? "Chờ kiểm chốt hết kiện" : destinationMeta.transactionType,
            quantity: -actualQty,
            remaining,
            note: isFinalPick
              ? `Đã rút hết theo sổ; chờ kiểm số thực tế còn lại trong kiện ${pickingUnit.id}`
              : `Rút ${fmt(actualQty)} ${pickingUnit.unitName} từ kiện ${pickingUnit.id} sang ${destinationMeta.label}${values.note ? ` · ${values.note}` : ""}`,
          },
          ...prev.recentTransactions,
        ],
      }));
      if (detail && detail.id === pickingUnit.id) {
        setDetail({ ...detail, currentPcs: remaining, status: nextStatus });
      }
      message.success(
        isFinalPick
          ? `Kiện ${pickingUnit.id} đã chuyển sang Chờ kiểm. Hãy mở tại tab Chờ kiểm để chốt số thực tế.`
          : `Đã chuyển ${fmt(qty)} ${pickingUnit.unitName} sang ${destinationMeta.label}.`,
      );
      setShowPickModal(false);
      setPickingUnit(null);
      pickForm.resetFields();
    } catch (err: any) {
      if (!err?.errorFields) {
        message.error(err?.message || "Không thể rút hàng.");
      }
    } finally {
      isSubmittingPickRef.current = false;
      setIsSubmittingPick(false);
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

  const sendToTelegramApi = async (text: string) => {
    try {
      if (window.electronAPI?.handlingUnits?.sendTelegramTest) {
        await window.electronAPI.handlingUnits.sendTelegramTest({ text });
        return;
      }
    } catch {}
    try {
      await fetch(
        "https://api.telegram.org/bot8848101745:AAHqXEJimBslv1YoWWw9WH0XBJxv7uOMv_A/sendMessage",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: "1397184795",
            text,
            parse_mode: "HTML",
          }),
        },
      );
    } catch (err) {
      console.warn("Direct fetch telegram error:", err);
    }
  };

  const handleSendTelegramTest = async (cmdText?: string) => {
    const textToSend = (cmdText || telegramTestMsg).trim();
    if (!textToSend) return;
    setIsSendingTelegram(true);
    const nowTime = new Date().toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });

    // 1. Thêm tin nhắn của user vào chat box
    const userMsg = {
      id: `u-${Date.now()}`,
      sender: "user" as const,
      text: textToSend,
      time: nowTime,
    };

    setTelegramChatLog((prev) => [...prev, userMsg]);
    setTelegramTestMsg("");

    try {
      // 2. Gửi tin nhắn lên Telegram API thật
      await sendToTelegramApi(`👤 <b>Yêu cầu:</b> ${textToSend}`);

      // 3. Xử lý phản hồi nghiệp vụ
      const parts = textToSend.split(/\s+/);
      const cmd = parts[0]?.toLowerCase();
      let botReply = "";

      if (cmd === "/ton") {
        const totalPkgs = workspace.register.length;
        const sealed = workspace.register.filter(
          (u) => u.status === "Nguyên niêm phong",
        ).length;
        const opened = workspace.register.filter(
          (u) => u.status === "Đang sử dụng",
        ).length;
        const empty = workspace.register.filter(
          (u) => u.status === "Đã hết",
        ).length;
        const totalPcs = workspace.register.reduce(
          (s, u) => s + u.currentPcs,
          0,
        );

        botReply = `📊 <b>BÁO CÁO TỒN KHO KIỆN HÀNG:</b>\n• Tổng số kiện: <b>${totalPkgs} kiện</b>\n• 🟢 Nguyên niêm phong: <b>${sealed} kiện</b>\n• 🟠 Đang sử dụng (mở): <b>${opened} kiện</b>\n• ⚪ Đã hết: <b>${empty} kiện</b>\n• 📦 Tổng sản phẩm trong kiện: <b>${fmt(totalPcs)} đơn vị</b>`;
      } else if (cmd === "/khui") {
        const targetCode = parts[1]?.toUpperCase();
        if (!targetCode) {
          botReply = `⚠️ <b>Vui lòng nhập mã kiện!</b>\nCú pháp: <code>/khui [MÃ_KIỆN]</code> (Ví dụ: <code>/khui KN-5DTR-01</code>)`;
        } else {
          const targetUnit = workspace.register.find(
            (u) => u.id.toUpperCase() === targetCode,
          );
          if (!targetUnit) {
            botReply = `❌ Không tìm thấy kiện <code>${targetCode}</code> trong hệ thống kho!`;
          } else if (targetUnit.status === "Đang sử dụng") {
            botReply = `⚠️ Kiện <code>${targetCode}</code> đang mở sẵn rồi!`;
          } else if (targetUnit.status === "Đã hết") {
            botReply = `❌ Kiện <code>${targetCode}</code> đã hết hàng!`;
          } else {
            await handleUnsealUnit(targetUnit);
            botReply = `✅ <b>KHUI KIỆN THÀNH CÔNG!</b>\n📦 Mã Kiện: <code>${targetUnit.id}</code>\n🏷️ SKU: <b>${targetUnit.skuName}</b>\n📍 Vị trí: <b>${locationFor(targetUnit)}</b>\n📊 Tồn: <b>${fmt(targetUnit.currentPcs)} ${targetUnit.unitName}</b>\n👉 Đã chuyển sang: <b>Đang sử dụng</b>`;
          }
        }
      } else if (cmd === "/rut") {
        const targetCode = parts[1]?.toUpperCase();
        const qty = parseInt(parts[2], 10);
        if (!targetCode || isNaN(qty) || qty <= 0) {
          botReply = `⚠️ <b>Vui lòng nhập đúng cú pháp!</b>\nCú pháp: <code>/rut [MÃ_KIỆN] [SỐ_LƯỢNG]</code>\n👉 Ví dụ: <code>/rut KN-5DTR-03 50</code>`;
        } else {
          const targetUnit = workspace.register.find(
            (u) => u.id.toUpperCase() === targetCode,
          );
          if (!targetUnit) {
            botReply = `❌ Không tìm thấy kiện <code>${targetCode}</code> trong kho!`;
          } else if (targetUnit.status !== "Đang sử dụng") {
            botReply = `❌ Kiện <code>${targetCode}</code> chưa khui! Hãy gửi lệnh <code>/khui ${targetCode}</code> trước.`;
          } else if (qty > targetUnit.currentPcs) {
            botReply = `❌ Số lượng rút (${qty}) lớn hơn tồn còn lại trong kiện (${targetUnit.currentPcs} ${targetUnit.unitName})!`;
          } else {
            const remaining = targetUnit.currentPcs - qty;
            const nextStatus = remaining === 0 ? "Đã hết" : "Đang sử dụng";
            setWorkspace((prev) => ({
              ...prev,
              register: prev.register.map((u) =>
                u.id === targetUnit.id
                  ? { ...u, currentPcs: remaining, status: nextStatus }
                  : u,
              ),
              recentTransactions: [
                {
                  id: `TR-${Date.now()}`,
                  unitId: targetUnit.id,
                  createdAt: new Date().toISOString(),
                  type: "Lấy hàng",
                  quantity: -qty,
                  note: `Rút ${qty} ${targetUnit.unitName} sang Khu đóng gói qua Telegram`,
                },
                ...prev.recentTransactions,
              ],
            }));
            botReply = `🚀 <b>RÚT HÀNG SANG KHU ĐÓNG GÓI THÀNH CÔNG!</b>\n📦 Mã Kiện: <code>${targetUnit.id}</code>\n📉 Đã rút: <b>${fmt(qty)} ${targetUnit.unitName}</b>\n📊 Còn lại trong kiện: <b>${fmt(remaining)} ${targetUnit.unitName}</b> ${nextStatus === "Đã hết" ? "<i>(Đã hết kiện)</i>" : ""}`;
          }
        }
      } else if (cmd === "/kiem") {
        const targetCode = parts[1]?.toUpperCase();
        const targetUnit = workspace.register.find(
          (u) => u.id.toUpperCase() === targetCode,
        );
        if (!targetUnit) {
          botReply = `❌ Không tìm thấy kiện <code>${targetCode}</code> trong kho.`;
        } else {
          botReply = `🔍 <b>THÔNG TIN KIỆN ${targetUnit.id}</b>\n🏷️ SKU: <b>${targetUnit.skuName}</b>\n📦 Quy cách: ${targetUnit.packageLabel || targetUnit.packageType}\n📊 Số lượng: <b>${fmt(targetUnit.currentPcs)} / ${fmt(targetUnit.initialPcs)} ${targetUnit.unitName}</b>\n📍 Vị trí: <b>${locationFor(targetUnit)}</b>\n🏷️ Trạng thái: <b>${targetUnit.status}</b>`;
        }
      } else if (cmd === "/help" || cmd === "/start") {
        botReply = `📦 <b>CÁC LỆNH KHO HỖ TRỢ:</b>\n• <code>/khui [MÃ_KIỆN]</code> — Mở niêm phong kiện\n• <code>/rut [MÃ_KIỆN] [SỐ_LƯỢNG]</code> — Rút hàng sang khu đóng gói\n• <code>/ton</code> — Báo cáo tổng tồn kho\n• <code>/kiem [MÃ_KIỆN]</code> — Tra cứu chi tiết kiện`;
      } else {
        botReply = `⚠️ Lệnh "<b>${textToSend}</b>" không hợp lệ.\n👉 Gõ <code>/help</code> hoặc <code>/ton</code>, <code>/khui [MÃ_KIỆN]</code>, <code>/rut [MÃ_KIỆN] [SỐ]</code> để thao tác.`;
      }

      // Gửi phản hồi của bot lên Telegram và thêm vào chatbox
      await sendToTelegramApi(`🤖 <b>@quanlykienhang_bot:</b>\n${botReply}`);

      setTelegramChatLog((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: "bot",
          text: botReply,
          time: new Date().toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
      message.success("Đã gửi và đồng bộ với Telegram Bot!");
    } catch (err: any) {
      message.error(err?.message || "Lỗi gửi tin nhắn");
    } finally {
      setIsSendingTelegram(false);
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
      if (!result?.success)
        throw new Error(result?.error || "Không thể cập nhật kiện.");

      const remaining = Number(values.remainingQuantity);
      let nextStatus = editingUnit.status;
      if (remaining === 0 && nextStatus !== "Chờ kiểm") nextStatus = "Đã hết";
      if (
        remaining > 0 &&
        (nextStatus === "Đã hết" || nextStatus === "Chờ kiểm")
      )
        nextStatus = "Đang sử dụng";
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
        register: previous.register.map((unit) =>
          unit.id === updatedUnit.id ? updatedUnit : unit,
        ),
      }));
      setDetail(updatedUnit);
      setEditingUnit(null);
      editUnitForm.resetFields();
      message.success(`Đã cập nhật kiện ${updatedUnit.id}.`);
      await loadWorkspace();
    } catch (error: any) {
      if (!error?.errorFields)
        message.error(error?.message || "Không thể cập nhật kiện.");
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

  // Nhóm SKU theo productGroup: Cha → Con (màu)
  const skuGroups = useMemo(() => {
    const groups: Array<{
      groupName: string;
      children: typeof matchingSkus;
    }> = [];
    const map = new Map<string, typeof matchingSkus>();
    matchingSkus.forEach((item) => {
      const key = item.productGroup || "Khác";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    map.forEach((children, groupName) => {
      groups.push({ groupName, children });
    });
    return groups;
  }, [matchingSkus]);

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
  const selectedUnits = workspace.register.filter(
    (unit) => unit.skuName === selected?.sku,
  );
  const selectedAllocated = selectedUnits.reduce(
    (sum, unit) => sum + unit.currentPcs,
    0,
  );
  const selectedDifference =
    selectedAllocated - Number(selected?.stock || 0);
  const sealedCount = selectedUnits.filter(
    (u) => u.status === "Nguyên niêm phong",
  ).length;
  const openedCount = selectedUnits.filter(
    (u) => u.status === "Đang sử dụng",
  ).length;
  const pendingCheckCount = selectedUnits.filter(
    (u) => u.status === "Chờ kiểm",
  ).length;
  const emptyCount = selectedUnits.filter((u) => u.status === "Đã hết").length;

  const displayedUnits = useMemo(() => {
    if (statusFilter === "all")
      return selectedUnits.filter((u) => u.status !== "Đã hết");
    return selectedUnits.filter((u) => u.status === statusFilter);
  }, [selectedUnits, statusFilter]);

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

  const currentAllocAllocated = useMemo(() => {
    if (!currentAllocProduct) return 0;
    return workspace.register
      .filter((u) => u.skuName === currentAllocProduct.sku)
      .reduce((sum, u) => sum + u.currentPcs, 0);
  }, [workspace.register, currentAllocProduct]);

  const currentAllocDifference = useMemo(() => {
    if (!currentAllocProduct) return 0;
    return currentAllocAllocated - Number(currentAllocProduct.stock || 0);
  }, [currentAllocProduct, currentAllocAllocated]);

  const totalCalculatedGoi = useMemo(() => {
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
      const zone = values.zone || "A1";
      const rack = values.rack ? String(values.rack).trim() : "";
      const receiptCode = values.receiptCode
        ? String(values.receiptCode).trim()
        : `PNK-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}`;
      const note = values.note ? String(values.note).trim() : "";

      let created: UnitRow[] = [];
      const skuPrefix =
        targetSku.sku
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(2, 6)
          .toUpperCase() || "KN";
      const existingUnits = workspace.register.filter(
        (u) => u.skuName === targetSku.sku,
      );

      if (method === "TAI") {
        const count = Math.max(1, Number(values.packageCount || 1));
        const factor = Math.max(1, Number(values.conversionFactor || 1200));
        created = Array.from({ length: count }, (_, offset) => {
          const seq = String(existingUnits.length + offset + 1).padStart(
            2,
            "0",
          );
          return {
            id: `KN-${skuPrefix}-${seq}`,
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Tải dứa",
            packageLabel: `Tải dứa · ${fmt(factor)} gói`,
            unitName: "gói",
            status: "Nguyên niêm phong",
            location: { zone, rack: rack || undefined },
            initialPcs: factor,
            currentPcs: factor,
            note: note || `Tạo kiện tải từ phiếu ${receiptCode}`,
          };
        });
      } else if (method === "THUNG") {
        const count = Math.max(1, Number(values.packageCount || 1));
        const factor = Math.max(1, Number(values.conversionFactor || 50));
        created = Array.from({ length: count }, (_, offset) => {
          const seq = String(existingUnits.length + offset + 1).padStart(
            2,
            "0",
          );
          return {
            id: `KN-${skuPrefix}-${seq}`,
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Thùng carton",
            packageLabel: `Thùng carton · ${fmt(factor)} gói`,
            unitName: "gói",
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
        const seq = String(existingUnits.length + 1).padStart(2, "0");
        created = [
          {
            id: `KN-${skuPrefix}-${seq}`,
            receiptCode,
            skuName: targetSku.sku,
            packageType: "Túi lẻ",
            packageLabel: `Hàng túi lẻ · ${fmt(qty)} gói`,
            unitName: "gói",
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

      if (!window.electronAPI?.handlingUnits?.saveRegister) {
        throw new Error("Không kết nối được dịch vụ lưu dữ liệu kiện hàng.");
      }
      const saveResult = await window.electronAPI.handlingUnits.saveRegister(
        nextRegister,
      );
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || "Supabase không lưu được kiện mới.");
      }

      setWorkspace((previous) => ({
        ...previous,
        register: nextRegister,
        recentTransactions: [
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
        `Đã tạo thành công ${created.length} kiện (quy đổi tổng ${fmt(totalPcs)} gói)!`,
      );
      setShowAllocation(false);
      allocationForm.resetFields();
      setPrintUnits(created);
      setShowPrintModal(true);
      await loadWorkspace();
    } catch (error: any) {
      if (!error?.errorFields)
        message.error(error?.message || "Không tạo được kiện.");
    } finally {
      setIsAllocating(false);
    }
  };

  const openCreatePackageModal = (targetSku?: string) => {
    const skuToUse = targetSku || selected?.sku || workspace.catalog[0]?.sku;
    const spec = workspace.packagingSpecs.find((s) => s.sku === skuToUse);
    const method = spec?.name === "Thùng" ? "THUNG" : "TAI";
    const factor = spec?.conversionFactor || (method === "THUNG" ? 50 : 1200);

    allocationForm.setFieldsValue({
      sku: skuToUse,
      packageMethod: method,
      packageCount: 1,
      conversionFactor: factor,
      looseQty: undefined,
      zone: "A1",
    });
    setShowAllocation(true);
  };

  if (isWorkspaceLoading) {
    return (
      <main className="hu-home">
        <div className="hu-workspace-loading">
          <img
            className="hu-workspace-loading-logo"
            src="/logo_splash.png"
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

  return (
    <main className="hu-home">
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
        <Flex align="center" gap={10}>
          <button
            type="button"
            className="hu-telegram-bot-badge"
            onClick={() => setShowTelegramModal(true)}
            title="Bấm để mở bảng điều khiển Telegram Bot"
          >
            <span className="hu-bot-dot online" />
            <RobotOutlined style={{ color: "#0088cc", fontSize: 14 }} />
            <span className="hu-bot-name">@quanlykienhang_bot</span>
            <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>
              Trực tuyến
            </Tag>
          </button>
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
                    workspace.register.filter((u) => u.skuName === c.sku)
                      .length,
                  0,
                );
                return (
                  <div className="hu-sku-group" key={group.groupName}>
                    <button
                      type="button"
                      className={`hu-sku-group-header ${isOpen ? "is-open" : ""}`}
                      onClick={() => toggleGroup(group.groupName)}
                    >
                      <RightOutlined className="hu-sku-group-arrow" />
                      <span className="hu-sku-group-label">
                        {displayProductGroup(group.groupName)}
                      </span>
                      <span className="hu-sku-group-count">
                        {group.children.length} màu · {groupUnitsCount} kiện
                      </span>
                    </button>
                    {isOpen && (
                      <div className="hu-sku-group-children">
                        {group.children.map((item) => {
                          const units = workspace.register.filter(
                            (unit) => unit.skuName === item.sku,
                          );
                          const colorInfo = getColorDot(item.color, item.sku);
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
                                <div className="hu-sku-name">{shortName}</div>
                                <div className="hu-sku-meta">
                                  <span className="hu-sku-stock">
                                    <b>{fmt(item.stock)}</b> {item.unitName} ·{" "}
                                    {units.length} kiện
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
        <section className="hu-selected-panel">
          {selected ? (
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
                      <div className="hu-metric-chip hu-chip-stock">
                        <span className="hu-chip-label">Tồn quản lý kiện</span>
                        <span className="hu-chip-val">
                          <strong>{fmt(selectedAllocated)}</strong>{" "}
                          {selected.unitName}
                        </span>
                      </div>
                      <div className="hu-metric-chip hu-chip-allocated">
                        <span className="hu-chip-label">Tồn phần mềm tham khảo</span>
                        <span className="hu-chip-val">
                          <strong>{fmt(selected.stock)}</strong>{" "}
                          {selected.unitName}
                        </span>
                      </div>
                      <div
                        className={`hu-metric-chip hu-chip-unallocated ${selectedDifference !== 0 ? "has-unallocated" : "zero"}`}
                      >
                        <span className="hu-chip-label">Chênh lệch đối chiếu</span>
                        <span className="hu-chip-val">
                          <strong>{fmtSigned(selectedDifference)}</strong>{" "}
                          {selected.unitName}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hu-header-right hu-selected-actions">
                  <Button
                    icon={<EnvironmentOutlined />}
                    className="hu-btn-location"
                    onClick={() => setShowLocations(true)}
                  >
                    Khu vực
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    className="hu-btn-create-pkg"
                    onClick={() => openCreatePackageModal()}
                  >
                    Tạo kiện
                  </Button>
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
                        className={`hu-filter-tab ${statusFilter === "Chờ kiểm" ? "active" : ""}`}
                        onClick={() => setStatusFilter("Chờ kiểm")}
                      >
                        🟡 Chờ kiểm ({pendingCheckCount})
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
                  </div>
                </div>
                <div className="hu-toolbar-right" />
              </div>
              <div
                className={`hu-package-grid ${displayedUnits.length <= 2 ? "is-sparse" : ""}`}
              >
                  {displayedUnits.map((unit) => (
                    <button
                      type="button"
                      className={`hu-package-card ${unit.status === "Đang sử dụng" ? "opened" : ""} ${unit.status === "Đã hết" ? "empty" : ""}`}
                      key={unit.id}
                      onClick={() => setDetail(unit)}
                    >
                      <header>
                        <div className="hu-card-title-group">
                          <b className="hu-unit-code">{unit.id}</b>
                          <span className="hu-unit-spec-tag">
                            {unit.packageType}
                          </span>
                        </div>
                        {statusFor(unit.status)}
                      </header>
                      <img src={imageFor(unit)} alt={`Minh hoạ ${unit.id}`} />
                      <div className="hu-package-number">
                        <small>{unit.unitName} còn lại</small>
                        <strong>{fmt(unit.currentPcs)}</strong>
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
                                const conflict = getConflictingOpenedUnit(
                                  unit,
                                  workspace.register,
                                );
                                if (conflict) {
                                  const catLabel =
                                    getPackageCategory(unit.packageType) ===
                                    "TAI"
                                      ? "tải"
                                      : "thùng";
                                  return (
                                    <Tooltip
                                      title={`Đang có ${catLabel} [${conflict.id}] cùng SKU đang mở (còn ${fmt(conflict.currentPcs)} gói). Vui lòng rút hết kiện cũ trước khi khui ${catLabel} mới.`}
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
                                            `⚠️ SKU này đang có ${catLabel} [${conflict.id}] mở sẵn. Vui lòng rút hết kiện cũ trước khi khui thêm ${catLabel}!`,
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
                            {unit.status === "Đang sử dụng" && (
                              <button
                                className="hu-action-btn pick"
                                onClick={() => handlePickUnit(unit)}
                              >
                                <ShoppingCartOutlined /> Rút hàng
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
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <Empty description="Không tìm thấy SKU demo" />
          )}
        </section>
      </section>
      <Modal
        title={detail ? `Chi tiết kiện hàng · ${detail.id}` : "Chi tiết kiện"}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Đóng</Button>}
        width={780}
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
                <Button
                  type="primary"
                  icon={<PrinterOutlined />}
                  size="middle"
                  onClick={() => {
                    setPrintUnits([detail]);
                    setShowPrintModal(true);
                  }}
                  className="hu-btn-open-print"
                >
                  In tem dán tải (A6/A7)
                </Button>
              </div>
            </div>
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
              <Button
                icon={<EditOutlined />}
                size="middle"
                onClick={() => openEditUnit(detail)}
              >
                Sửa thông tin kiện
              </Button>
              {detail.status === "Nguyên niêm phong" &&
                (() => {
                  const conflict = getConflictingOpenedUnit(
                    detail,
                    workspace.register,
                  );
                  if (conflict) {
                    const catLabel =
                      getPackageCategory(detail.packageType) === "TAI"
                        ? "tải"
                        : "thùng";
                    return (
                      <Tooltip
                        title={`SKU này đang có ${catLabel} [${conflict.id}] đang mở (còn ${fmt(conflict.currentPcs)} ${detail.unitName}). Hãy rút hết kiện cũ trước.`}
                      >
                        <Button disabled icon={<LockOutlined />} size="middle">
                          Khóa khui (Chờ kiện {conflict.id})
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
              {detail.status === "Đang sử dụng" && (
                <>
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    size="middle"
                    style={{ background: "#1890ff", borderColor: "#1890ff" }}
                    onClick={() => handlePickUnit(detail)}
                  >
                    Rút hàng sang Khu đóng gói
                  </Button>
                  <Button
                    icon={<LockOutlined />}
                    size="middle"
                    onClick={() => handleSealUnit(detail)}
                  >
                    Đóng niêm phong lại
                  </Button>
                </>
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
              <Button
                icon={<SwapOutlined />}
                size="middle"
                onClick={() => {
                  setMovingUnit(detail);
                  moveLocationForm.setFieldsValue({
                    targetZone:
                      detail.location?.zone || workspace.locations[0]?.code,
                    targetRack: detail.location?.rack || "",
                  });
                }}
              >
                Chuyển vị trí
              </Button>
            </div>
            <section className="hu-unit-history">
              <Flex
                justify="space-between"
                align="center"
                style={{ marginBottom: 8 }}
              >
                <Typography.Title level={5} style={{ margin: 0 }}>
                  Lịch sử kiện {detail.id}
                </Typography.Title>
                <Tag color="green" style={{ margin: 0 }}>
                  Đồng bộ thời gian thực
                </Tag>
              </Flex>
              {(() => {
                const affectsQuantity = (item: any) =>
                  /lấy hàng|rút hàng|chuyển khu|chuyển hàng|xuất|điều chỉnh|nhập/i.test(
                    String(item.type || ""),
                  );
                const historyList = workspace.recentTransactions
                  .filter(
                    (item) =>
                      item.unitId?.toUpperCase() === detail.id?.toUpperCase(),
                  )
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime(),
                  );
                let balanceAfter = detail.currentPcs;
                const rows = historyList.map((item) => {
                  const rawQuantity = Number(item.quantity || 0);
                  const quantity = affectsQuantity(item) ? rawQuantity : 0;
                  const noteMatch = String(item.note || "").match(
                    /còn\s+([\d.,]+)/i,
                  );
                  const noteRemaining = noteMatch
                    ? Number(noteMatch[1].replace(/\./g, "").replace(",", "."))
                    : NaN;
                  const savedRemaining = Number(item.remaining);
                  const rowBalance = Number.isFinite(savedRemaining)
                    ? savedRemaining
                    : Number.isFinite(noteRemaining)
                      ? noteRemaining
                      : balanceAfter;
                  const balanceBefore = Math.max(0, rowBalance - quantity);
                  const row = {
                    ...item,
                    quantity,
                    balanceBefore,
                    balanceAfter: rowBalance,
                  };
                  balanceAfter = balanceBefore;
                  return row;
                });
                const currentBalance = Number(detail.currentPcs);
                const latestRecordedBalance = rows.length
                  ? rows[0].balanceAfter
                  : Number(detail.initialPcs);
                const reconciliationRow =
                  Number.isFinite(currentBalance) &&
                  Number.isFinite(latestRecordedBalance) &&
                  currentBalance !== latestRecordedBalance
                    ? {
                        id: `HU-CURRENT-${detail.id}`,
                        createdAt: new Date().toISOString(),
                        type: "Đồng bộ tồn thực tế",
                        quantity: currentBalance - latestRecordedBalance,
                        balanceBefore: latestRecordedBalance,
                        balanceAfter: currentBalance,
                        note: "Cập nhật theo tồn hiện tại của kiện",
                        isReconciliation: true,
                      }
                    : null;
                const displayRows = reconciliationRow
                  ? [reconciliationRow, ...rows]
                  : rows;

                return (
                  <div className="hu-ledger">
                    <div className="hu-ledger-head">
                      <span>Thời điểm</span>
                      <span>Chứng từ / thao tác</span>
                      <span>Tồn đầu</span>
                      <span>Thay đổi</span>
                      <span>Tồn cuối</span>
                      <span>Diễn giải</span>
                    </div>
                    {displayRows.length ? (
                      displayRows.map((item) => {
                        const eventDate = new Date(item.createdAt);
                        const isOutbound = item.quantity < 0;
                        const isInbound = item.quantity > 0;
                        return (
                          <div className="hu-ledger-row" key={item.id}>
                            <span>
                              {item.isReconciliation
                                ? "Hiện tại"
                                : eventDate.toLocaleTimeString("vi-VN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })}
                              {!item.isReconciliation && (
                                <small>
                                  {eventDate.toLocaleDateString("vi-VN")}
                                </small>
                              )}
                            </span>
                            <span>
                              <b>{item.type || "Cập nhật kiện"}</b>
                              {item.actor && <em>{item.actor}</em>}
                            </span>
                            <span className="hu-ledger-balance">
                              {fmt(item.balanceBefore)}
                            </span>
                            <span
                              className={
                                isInbound
                                  ? "hu-ledger-inbound"
                                  : isOutbound
                                    ? "hu-ledger-outbound"
                                    : undefined
                              }
                            >
                              {isInbound
                                ? `+${fmt(item.quantity)}`
                                : isOutbound
                                  ? `−${fmt(Math.abs(item.quantity))}`
                                  : "—"}
                            </span>
                            <span className="hu-ledger-balance">
                              {fmt(item.balanceAfter)}
                            </span>
                            <span>{item.note || "—"}</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="hu-ledger-empty">
                        Chưa phát sinh xuất/nhập sau khi tạo kiện.
                      </div>
                    )}
                    <div className="hu-ledger-row hu-ledger-opening">
                      <span>
                        {detail.receiptCode ? "Theo phiếu nhập" : "Số dư đầu"}
                      </span>
                      <span>
                        <b>Nhập tạo kiện</b>
                        {detail.receiptCode && <em>{detail.receiptCode}</em>}
                      </span>
                      <span className="hu-ledger-balance">0</span>
                      <span className="hu-ledger-inbound">+{fmt(detail.initialPcs)}</span>
                      <span className="hu-ledger-balance">
                        {fmt(detail.initialPcs)}
                      </span>
                      <span>Tạo kiện {detail.id}</span>
                    </div>
                  </div>
                );
              })()}
            </section>
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
              onPickUnit={(u) => handlePickUnit(u as UnitRow)}
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
                  const unitsInLoc = workspace.register.filter(
                    (u) => u.location?.zone === loc.code,
                  );
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
                đổi số lượng ra gói
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
                  const spec = workspace.packagingSpecs.find(
                    (s) => s.sku === skuVal,
                  );
                  const method =
                    allocationForm.getFieldValue("packageMethod") || "TAI";
                  if (method === "TAI") {
                    allocationForm.setFieldValue(
                      "conversionFactor",
                      spec?.conversionFactor || 1200,
                    );
                  } else if (method === "THUNG") {
                    allocationForm.setFieldValue(
                      "conversionFactor",
                      spec?.name === "Thùng" ? spec.conversionFactor : 50,
                    );
                  } else if (method === "LE") {
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
                      {fmt(currentAllocAllocated)}{" "}
                      {currentAllocProduct.unitName}
                    </b>
                  </div>
                  <div>
                    <small>TỒN PHẦN MỀM THAM KHẢO</small>
                    <b>
                      {fmt(currentAllocProduct.stock)}{" "}
                      {currentAllocProduct.unitName}
                    </b>
                  </div>
                  <div
                    className={
                      currentAllocDifference !== 0 ? "has-unallocated" : ""
                    }
                  >
                    <small>CHÊNH LỆCH ĐỐI CHIẾU</small>
                    <b>
                      {fmtSigned(currentAllocDifference)}{" "}
                      {currentAllocProduct.unitName}
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
                  if (m === "TAI") {
                    allocationForm.setFieldValue("conversionFactor", 1200);
                  } else if (m === "THUNG") {
                    allocationForm.setFieldValue("conversionFactor", 50);
                  } else if (m === "LE") {
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
                  label="Quy cách (Số gói mỗi tải)"
                  rules={[{ required: true, message: "Nhập số gói mỗi tải" }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter="gói/tải"
                    placeholder="Mặc định: 1.200"
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
                  label="Quy cách (Số gói mỗi thùng)"
                  rules={[{ required: true, message: "Nhập số gói mỗi thùng" }]}
                  style={{ flex: 1, marginBottom: 8 }}
                >
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: "100%" }}
                    addonAfter="gói/thùng"
                    placeholder="Mặc định: 50 hoặc 250"
                  />
                </Form.Item>
              </Flex>
            )}

            {watchAllocMethod === "LE" && (
              <Form.Item
                name="looseQty"
                label="Số lượng gói lẻ tạo kiện"
                rules={[
                  { required: true, message: "Nhập số gói lẻ" },
                ]}
                style={{ marginBottom: 8 }}
              >
                <InputNumber
                  min={1}
                  precision={0}
                  style={{ width: "100%" }}
                  addonAfter="gói"
                  placeholder="Nhập số lượng kiểm đếm thực tế"
                />
              </Form.Item>
            )}

            {/* 4. TÍNH TOÁN QUY ĐỔI RA ĐƠN VỊ GÓI */}
            <div className="hu-alloc-calc-banner">
              <div className="hu-alloc-calc-text">
                <span className="hu-calc-label">
                  4. TỔNG SỐ LƯỢNG QUY ĐỔI (ĐƠN VỊ GÓI):
                </span>
                <b className="hu-calc-total">
                  {watchAllocMethod === "LE"
                    ? `${fmt(watchAllocLooseQty)} gói`
                    : `${watchAllocCount} kiện × ${fmt(watchAllocFactor)} gói = ${fmt(totalCalculatedGoi)} gói`}
                </b>
              </div>
              <Tag color="green" style={{ fontSize: 13, padding: "4px 10px" }}>
                Đơn vị cơ sở: Gói
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
        title={pickingUnit ? `Rút hàng · Kiện ${pickingUnit.id}` : "Rút hàng"}
        open={showPickModal}
        onCancel={() => {
          if (isSubmittingPick) return;
          setShowPickModal(false);
          setPickingUnit(null);
          pickForm.resetFields();
        }}
        onOk={handlePickSubmit}
        okText="Xác nhận chuyển hàng"
        confirmLoading={isSubmittingPick}
        closable={!isSubmittingPick}
        maskClosable={!isSubmittingPick}
        cancelButtonProps={{ disabled: isSubmittingPick }}
        destroyOnHidden
      >
        {pickingUnit && (
          <Form form={pickForm} layout="vertical">
            <div className="hu-move-preview" style={{ marginBottom: 14 }}>
              <div>
                <strong>Mã kiện:</strong> <code>{pickingUnit.id}</code>
              </div>
              <div>
                <strong>Sản phẩm / SKU:</strong> {pickingUnit.skuName}
              </div>
              <div>
                <strong>Tồn dồn trong kiện:</strong>{" "}
                <b style={{ color: "#00a85a" }}>
                  {fmt(pickingUnit.currentPcs)} {pickingUnit.unitName}
                </b>
              </div>
              <div>
                <strong>Vị trí hiện tại:</strong>{" "}
                <Tag color="blue">{locationFor(pickingUnit)}</Tag>
              </div>
            </div>
            <Form.Item
              name="quantity"
              label={`LẤY HÀNG - SỐ LƯỢNG (${pickingUnit.unitName})`}
              rules={[
                { required: true, message: "Vui lòng nhập số lượng cần rút" },
                {
                  type: "number",
                  min: 1,
                  max: pickingUnit.currentPcs,
                  message: `Số lượng từ 1 đến ${pickingUnit.currentPcs}`,
                },
              ]}
            >
              <InputNumber
                className="hu-pick-quantity-input"
                style={{ width: "100%" }}
                placeholder="0"
                min={1}
                max={pickingUnit.currentPcs}
              />
            </Form.Item>
            <div className="hu-pick-destination-note">
              Hàng lấy ra sẽ chuyển vào <b>Khu đóng gói</b>.
            </div>
            <Form.Item name="note" label="Ghi chú" style={{ marginBottom: 0 }}>
              <Input placeholder="Tuỳ chọn" />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={
          <Flex align="center" gap={8}>
            <RobotOutlined style={{ color: "#0088cc", fontSize: 20 }} />
            <div>
              <b>Điều khiển & Kết nối Telegram Bot</b>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: 12 }}
              >
                Bot: @quanlykienhang_bot · Chat ID: 1397184795
              </Typography.Text>
            </div>
          </Flex>
        }
        open={showTelegramModal}
        onCancel={() => setShowTelegramModal(false)}
        footer={
          <Button onClick={() => setShowTelegramModal(false)}>Đóng</Button>
        }
        width={680}
        destroyOnHidden
      >
        <div className="hu-telegram-modal-content">
          <div className="hu-tg-banner">
            <p>
              🤖 Bot <b>@quanlykienhang_bot</b> đang chạy nền và kết nối trực
              tiếp với hệ thống kho. Bạn có thể mở ứng dụng Telegram trên điện
              thoại và gửi lệnh trực tiếp bất kỳ lúc nào!
            </p>
          </div>

          {/* KHUNG CHAT TELEGRAM TRỰC QUAN */}
          <div className="hu-tg-chat-box">
            <div className="hu-tg-chat-messages">
              {telegramChatLog.map((msg) => (
                <div
                  key={msg.id}
                  className={`hu-tg-msg-bubble ${msg.sender === "user" ? "user" : "bot"}`}
                >
                  <div className="hu-tg-msg-header">
                    <b>
                      {msg.sender === "user"
                        ? "👤 Bạn (Admin)"
                        : "🤖 @quanlykienhang_bot"}
                    </b>
                    <small>{msg.time}</small>
                  </div>
                  <div
                    className="hu-tg-msg-content"
                    dangerouslySetInnerHTML={{
                      __html: msg.text.replace(/\n/g, "<br/>"),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="hu-tg-quick-bar">
            <Typography.Text strong style={{ fontSize: 12 }}>
              Lệnh nhanh:
            </Typography.Text>
            <Flex gap={6} wrap="wrap">
              <Button
                size="small"
                onClick={() => handleSendTelegramTest("/ton")}
                loading={isSendingTelegram}
              >
                📊 /ton
              </Button>
              {displayedUnits[0] && (
                <Button
                  size="small"
                  onClick={() =>
                    handleSendTelegramTest(`/khui ${displayedUnits[0].id}`)
                  }
                  loading={isSendingTelegram}
                >
                  🔓 /khui {displayedUnits[0].id}
                </Button>
              )}
              {displayedUnits.find((u) => u.status === "Đang sử dụng") && (
                <Button
                  size="small"
                  onClick={() =>
                    handleSendTelegramTest(
                      `/rut ${displayedUnits.find((u) => u.status === "Đang sử dụng")!.id} 50`,
                    )
                  }
                  loading={isSendingTelegram}
                >
                  📦 /rut{" "}
                  {displayedUnits.find((u) => u.status === "Đang sử dụng")!.id}{" "}
                  50
                </Button>
              )}
            </Flex>
          </div>

          <Flex gap={8} style={{ marginTop: 4 }}>
            <Input
              placeholder="Nhập lệnh (/khui, /rut, /ton, /kiem...) hoặc tin nhắn test"
              value={telegramTestMsg}
              onChange={(e) => setTelegramTestMsg(e.target.value)}
              onPressEnter={() => handleSendTelegramTest()}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => handleSendTelegramTest()}
              loading={isSendingTelegram}
              style={{ background: "#0088cc", borderColor: "#0088cc" }}
            >
              Gửi
            </Button>
          </Flex>

          <div className="hu-tg-syntax-guide">
            <Typography.Text strong>
              📖 Tra cứu cú pháp lệnh Telegram:
            </Typography.Text>
            <ul>
              <li>
                <code>/khui [MÃ_KIỆN]</code> — Mở niêm phong kiện để bắt đầu lấy
                lẻ (VD: <code>/khui KN-5DTR-01</code>)
              </li>
              <li>
                <code>/rut [MÃ_KIỆN] [SỐ_LƯỢNG]</code> — Rút hàng sang Khu đóng
                gói (VD: <code>/rut KN-5DTR-03 50</code>)
              </li>
              <li>
                <code>/ton</code> — Báo cáo nhanh tổng số kiện, tổng tồn vật lý
                và lượng hàng chờ đóng gói
              </li>
              <li>
                <code>/kiem [MÃ_KIỆN]</code> — Tra cứu vị trí, trạng thái và số
                lượng chi tiết kiện
              </li>
            </ul>
          </div>
        </div>
      </Modal>

      {/* MODAL IN TEM DÁN TẢI / KIỆN HÀNG (A6 / A7) */}
      <Modal
        title={
          <Flex align="center" gap={8}>
            <PrinterOutlined style={{ color: "#0284c7", fontSize: 20 }} />
            <div>
              <b>In tem dán kiện hàng / tải dứa (WMS Label)</b>
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
        footer={
          <Flex
            justify="space-between"
            align="center"
            style={{ width: "100%" }}
          >
            <Flex align="center" gap={8}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                Khổ giấy:
              </Typography.Text>
              <Segmented
                value={printLabelSize}
                onChange={(val) => setPrintLabelSize(val as "A6" | "A7")}
                options={[
                  { label: "Khổ A6 (105 × 148 mm)", value: "A6" },
                  { label: "Khổ A7 (74 × 105 mm)", value: "A7" },
                ]}
              />
            </Flex>
            <Flex gap={8}>
              <Button
                onClick={() => {
                  setShowPrintModal(false);
                  setPrintUnits([]);
                }}
              >
                Đóng
              </Button>
              <Button
                type="primary"
                icon={<PrinterOutlined />}
                onClick={() => window.print()}
                style={{ background: "#00b96b", borderColor: "#00b96b" }}
              >
                In {printUnits.length || (detail ? 1 : 0)} tem ngay
              </Button>
            </Flex>
          </Flex>
        }
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
            <div
              className={`hu-print-label ${printLabelSize.toLowerCase()}`}
              key={unit.id}
            >
              {/* HEADER TEM */}
              <div className="hu-pl-header">
                <div className="hu-pl-brand">
                  <b>DBY POS & WMS</b>
                  <span>HỆ THỐNG QUẢN LÝ KHO</span>
                </div>
                <div className="hu-pl-tag">TEM ĐỊNH DANH KIỆN HÀNG</div>
              </div>

              {/* MÃ KIỆN LỚN */}
              <div className="hu-pl-code-banner">
                <small>MÃ KIỆN VẬT LÝ</small>
                <h1>{unit.id}</h1>
              </div>

              {/* THÂN TEM: QR CODE + CHI TIẾT */}
              <div className="hu-pl-body">
                <div className="hu-pl-qr-col">
                  <div className="hu-pl-qr-border">
                    <QRCode
                      value={`https://t.me/quanlykienhang_bot?start=khui_${unit.id.replace(/[^A-Za-z0-9]/g, "_")}`}
                      size={printLabelSize === "A6" ? 140 : 100}
                      bordered={false}
                      color="#000000"
                    />
                  </div>
                  <span className="hu-pl-scan-text">
                    📱 QUÉT ĐỂ KHUI & RÚT HÀNG
                  </span>
                </div>

                <div className="hu-pl-info-col">
                  <div className="hu-pl-info-item">
                    <label>SẢN PHẨM / SKU:</label>
                    <strong>{catalogItem?.variantName || unit.skuName}</strong>
                    <code className="hu-pl-sku-code">
                      SKU: {unit.skuName}
                    </code>
                  </div>

                  <div className="hu-pl-info-grid">
                    <div className="hu-pl-info-item">
                      <label>QUY CÁCH:</label>
                      <b>{unit.packageLabel || unit.packageType}</b>
                    </div>
                    <div className="hu-pl-info-item">
                      <label>SỐ LƯỢNG:</label>
                      <b className="hu-pl-qty-val">
                        {fmt(unit.initialPcs)} {unit.unitName}
                      </b>
                    </div>
                    <div className="hu-pl-info-item">
                      <label>VỊ TRÍ LƯU KHO:</label>
                      <b className="hu-pl-loc-val">{locationFor(unit)}</b>
                    </div>
                    <div className="hu-pl-info-item">
                      <label>PHIẾU NHẬP:</label>
                      <b>{unit.receiptCode || "N/A"}</b>
                    </div>
                  </div>
                </div>
              </div>

              {/* FOOTER TEM */}
              <div className="hu-pl-footer">
                <span>
                  🤖 Telegram Bot: <b>@quanlykienhang_bot</b>
                </span>
                <span>Ngày in: {new Date().toLocaleDateString("vi-VN")}</span>
              </div>
            </div>
                );
              },
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
