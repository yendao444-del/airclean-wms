import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Empty,
  Flex,
  Modal,
  Tag,
  Typography,
} from "antd";
import {
  EnvironmentOutlined,
  EyeOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import "./Warehouse2DMap.css";

export type UnitItem = {
  id: string;
  skuName?: string;
  variantName?: string;
  productGroup?: string;
  color?: string;
  packageType?: string;
  packageLabel?: string;
  unitName?: string;
  status: string;
  location?: { zone?: string; rack?: string };
  initialPcs: number;
  currentPcs: number;
  receiptCode?: string;
  note?: string;
};

interface Warehouse2DMapProps {
  units: UnitItem[];
  onSelectUnit?: (unit: UnitItem) => void;
  onPickUnit?: (unit: UnitItem) => void;
  onUnsealUnit?: (unit: UnitItem) => void;
  selectedZoneCode?: string;
  highlightedUnitId?: string;
  onSelectZone?: (zoneCode: string) => void;
  onOpenZoneManager?: (zoneCode: string) => void;
  selectionMode?: boolean;
  compact?: boolean;
}

const mapLocationCodeToZoneKey = (code?: string) => {
  const normalized = String(code || "").toLocaleLowerCase("vi-VN");
  if (normalized === "a1") return "TOP_1";
  if (normalized === "a2") return "TOP_2";
  if (normalized === "a3") return "TOP_3";
  if (normalized === "a4") return "TOP_4";
  if (normalized === "center" || normalized.includes("giữa")) return "CENTER";
  if (
    normalized.includes("đóng gói") ||
    normalized.includes("packing") ||
    normalized.includes("hàng lẻ")
  )
    return "PACKING";
  return null;
};

export const Warehouse2DMap: React.FC<Warehouse2DMapProps> = ({
  units,
  onSelectUnit,
  onPickUnit,
  onUnsealUnit,
  selectedZoneCode,
  highlightedUnitId,
  onSelectZone,
  onOpenZoneManager,
  selectionMode = false,
  compact = false,
}) => {
  const [activeZone, setActiveZone] = useState<string | null>(() =>
    mapLocationCodeToZoneKey(selectedZoneCode),
  );
  const [zoneModalData, setZoneModalData] = useState<{
    zoneKey: string;
    title: string;
    subtitle: string;
    units: UnitItem[];
  } | null>(null);

  const getUnitsForZone = (zoneKeywords: string[]) => {
    return units.filter((u) => {
      const z = (u.location?.zone || "").toLowerCase();
      const r = (u.location?.rack || "").toLowerCase();
      return zoneKeywords.some((k) => z.includes(k.toLowerCase()) || r.includes(k.toLowerCase()));
    });
  };

  const zoneTop1 = useMemo(() => getUnitsForZone(["A1", "Khu chứa hàng 1", "Kệ 01", "Kệ 02"]), [units]);
  const zoneTop2 = useMemo(() => getUnitsForZone(["A2", "Khu chứa hàng 2", "Kệ 03", "Kệ 04"]), [units]);
  const zoneTop3 = useMemo(() => getUnitsForZone(["A3", "Khu chứa hàng 3", "Kệ 05", "Kệ 06"]), [units]);
  const zoneTop4 = useMemo(() => getUnitsForZone(["A4", "Khu chứa hàng 4", "Kệ 07", "Kệ 08"]), [units]);
  const zoneCenter = useMemo(() => getUnitsForZone(["Giữa", "Khu giữa", "Khu chứa hàng giữa", "Center"]), [units]);
  const zonePacking = useMemo(() => getUnitsForZone(["Đóng gói", "Khu đóng gói", "Packing", "Hàng lẻ"]), [units]);

  const highlightedZone = useMemo(() => {
    if (!highlightedUnitId) return null;
    const containsFocusedUnit = (zoneUnits: UnitItem[]) =>
      zoneUnits.some((unit) => unit.id === highlightedUnitId);
    if (containsFocusedUnit(zoneTop1)) return "TOP_1";
    if (containsFocusedUnit(zoneTop2)) return "TOP_2";
    if (containsFocusedUnit(zoneTop3)) return "TOP_3";
    if (containsFocusedUnit(zoneTop4)) return "TOP_4";
    if (containsFocusedUnit(zoneCenter)) return "CENTER";
    if (containsFocusedUnit(zonePacking)) return "PACKING";
    return null;
  }, [highlightedUnitId, zoneCenter, zonePacking, zoneTop1, zoneTop2, zoneTop3, zoneTop4]);

  const highlightedUnit = useMemo(
    () => units.find((unit) => unit.id === highlightedUnitId),
    [highlightedUnitId, units],
  );

  useEffect(() => {
    if (highlightedZone) setActiveZone(highlightedZone);
  }, [highlightedZone]);

  useEffect(() => {
    if (selectedZoneCode) {
      setActiveZone(mapLocationCodeToZoneKey(selectedZoneCode));
    }
  }, [selectedZoneCode]);

  const renderLocationMarker = (zoneKey: string, x: number, y: number, width: number) =>
    highlightedZone === zoneKey && highlightedUnit ? (
      <g className="wms-unit-location-marker" transform={`translate(${x - width / 2}, ${y})`}>
        <rect width={width} height="22" rx="11" />
        <text x={width / 2} y="15" textAnchor="middle">
          {highlightedUnit.id} đang ở đây
        </text>
      </g>
    ) : null;

  const totalAllUnits = units.length;
  const totalAllPcs = units.reduce((s, u) => s + u.currentPcs, 0);
  const openedUnits = units.filter((u) => u.status === "Đang sử dụng").length;

  const handleZoneClick = (zoneKey: string, title: string, subtitle: string, zoneUnits: UnitItem[]) => {
    setActiveZone(zoneKey);
    onSelectZone?.(zoneKey);
    if (selectionMode) return;
    setZoneModalData({ zoneKey, title, subtitle, units: zoneUnits });
  };

  return (
    <div className={`wms-minimal-root ${compact ? "is-compact" : ""}`}>
      {/* HEADER TỐI GIẢN */}
      <div className="wms-minimal-header">
        <div className="wms-minimal-header-left">
          <div className="wms-live-dot" />
          <span className="wms-header-title">SƠ ĐỒ MẶT BẰNG KHO 2D</span>
          <span className="wms-header-desc">Giám sát vị trí & phân bổ kiện hàng</span>
        </div>

        <div className="wms-minimal-kpis">
          <div className="wms-kpi-chip">
            <span className="wms-kpi-val">{totalAllUnits}</span>
            <span className="wms-kpi-label">Tổng kiện</span>
          </div>
          <div className="wms-kpi-chip">
            <span className="wms-kpi-val highlight">{openedUnits}</span>
            <span className="wms-kpi-label">Đang mở</span>
          </div>
          <div className="wms-kpi-chip">
            <span className="wms-kpi-val primary">{totalAllPcs.toLocaleString("vi-VN")}</span>
            <span className="wms-kpi-label">Sản phẩm tồn</span>
          </div>
        </div>
      </div>

      {/* VIEWPORT BẢN ĐỒ 2D ĐỒNG BỘ MÀU TỐI GIẢN (MONOCHROME / NEUTRAL) */}
      <div className="wms-minimal-viewport">
        <div className="wms-minimal-svg-box">
          <svg
            className="wms-minimal-svg"
            viewBox="-15 0 1140 480"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* NỀN TOÀN BỘ KHO - MÀU TRẮNG XÁM TINH KHÔI ĐỒNG BỘ */}
            <rect x="35" y="15" width="1050" height="450" rx="8" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />

            {/* ============================================================== */}
            {/* DÃY 4 KHU CHỨA HÀNG TRÊN (ĐỒNG NHẤT MÀU SLATE TRANG NHÃ)       */}
            {/* ============================================================== */}
            {/* KHU 1 */}
            <g
              className={`wms-room-node ${activeZone === "TOP_1" ? "selected" : ""} ${highlightedZone === "TOP_1" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("TOP_1", "KHU CHỨA HÀNG 1", "Dãy Kệ A1", zoneTop1)}
              transform="translate(55, 25)"
            >
              <rect x="0" y="0" width="220" height="95" rx="6" className="wms-room-rect" />
              {renderLocationMarker("TOP_1", 110, 68, 185)}
              <g transform="translate(110, 45)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">KHU CHỨA HÀNG 1</text>
                <text x="0" y="18" textAnchor="middle" className="wms-room-count">
                  {zoneTop1.length} kiện · {zoneTop1.reduce((s, u) => s + u.currentPcs, 0).toLocaleString("vi-VN")} cái
                </text>
              </g>
            </g>

            {/* KHU 2 */}
            <g
              className={`wms-room-node ${activeZone === "TOP_2" ? "selected" : ""} ${highlightedZone === "TOP_2" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("TOP_2", "KHU CHỨA HÀNG 2", "Dãy Kệ A2", zoneTop2)}
              transform="translate(285, 25)"
            >
              <rect x="0" y="0" width="220" height="95" rx="6" className="wms-room-rect" />
              {renderLocationMarker("TOP_2", 110, 68, 185)}
              <g transform="translate(110, 45)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">KHU CHỨA HÀNG 2</text>
                <text x="0" y="18" textAnchor="middle" className="wms-room-count">
                  {zoneTop2.length} kiện · {zoneTop2.reduce((s, u) => s + u.currentPcs, 0).toLocaleString("vi-VN")} cái
                </text>
              </g>
            </g>

            {/* KHU 3 */}
            <g
              className={`wms-room-node ${activeZone === "TOP_3" ? "selected" : ""} ${highlightedZone === "TOP_3" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("TOP_3", "KHU CHỨA HÀNG 3", "Dãy Kệ A3", zoneTop3)}
              transform="translate(515, 25)"
            >
              <rect x="0" y="0" width="220" height="95" rx="6" className="wms-room-rect" />
              {renderLocationMarker("TOP_3", 110, 68, 185)}
              <g transform="translate(110, 45)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">KHU CHỨA HÀNG 3</text>
                <text x="0" y="18" textAnchor="middle" className="wms-room-count">
                  {zoneTop3.length} kiện · {zoneTop3.reduce((s, u) => s + u.currentPcs, 0).toLocaleString("vi-VN")} cái
                </text>
              </g>
            </g>

            {/* KHU 4 */}
            <g
              className={`wms-room-node ${activeZone === "TOP_4" ? "selected" : ""} ${highlightedZone === "TOP_4" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("TOP_4", "KHU CHỨA HÀNG 4", "Dãy Kệ A4", zoneTop4)}
              transform="translate(745, 25)"
            >
              <rect x="0" y="0" width="325" height="95" rx="6" className="wms-room-rect" />
              {renderLocationMarker("TOP_4", 162, 68, 185)}
              <g transform="translate(162, 45)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">KHU CHỨA HÀNG 4</text>
                <text x="0" y="18" textAnchor="middle" className="wms-room-count">
                  {zoneTop4.length} kiện
                </text>
              </g>
            </g>

            {/* ============================================================== */}
            {/* CHỖ ĐỂ Ô TÔ (TỐI GIẢN TINH TẾ)                                 */}
            {/* ============================================================== */}
            <g transform="translate(160, 135)">
              <rect x="0" y="0" width="300" height="90" rx="6" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6 4" />
              <g transform="translate(30, 13)">
                <rect x="0" y="4" width="240" height="56" rx="28" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.5" />
                <rect x="40" y="10" width="18" height="44" rx="3" fill="#94a3b8" />
                <rect x="180" y="10" width="18" height="44" rx="3" fill="#94a3b8" />
                <text x="120" y="36" textAnchor="middle" fill="#334155" fontSize="12" fontWeight="800" letterSpacing="0.8">
                  CHỖ ĐỂ Ô TÔ
                </text>
              </g>
            </g>

            {/* ============================================================== */}
            {/* 2 CỔNG KHO BÊN TRÁI (HIỂN THỊ RÕ RÀNG KHÔNG BỊ CẮT LẸM)       */}
            {/* ============================================================== */}
            {/* CỔNG 1 */}
            <g transform="translate(10, 45)">
              <rect x="0" y="0" width="38" height="110" rx="6" fill="#0f172a" stroke="#0f172a" strokeWidth="1" />
              <text x="19" y="50" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800" letterSpacing="0.8">
                CỔNG
              </text>
              <text x="19" y="70" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800" letterSpacing="0.8">
                KHO 1
              </text>
            </g>

            {/* CỔNG 2 */}
            <g transform="translate(10, 305)">
              <rect x="0" y="0" width="38" height="110" rx="6" fill="#0f172a" stroke="#0f172a" strokeWidth="1" />
              <text x="19" y="50" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800" letterSpacing="0.8">
                CỔNG
              </text>
              <text x="19" y="70" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="800" letterSpacing="0.8">
                KHO 2
              </text>
            </g>

            {/* ============================================================== */}
            {/* VÁCH TƯỜNG NGĂN CÁCH (THEO ĐÚNG SƠ ĐỒ CHUẨN)                  */}
            {/* ============================================================== */}
            {/* Vách ngang chính: từ dưới ô tô chạy thẳng đâm vào Nhà vệ sinh */}
            <line x1="160" y1="230" x2="860" y2="230" stroke="#334155" strokeWidth="3" />
            {/* Vách dọc hướng lên: ngăn cách đuôi xe ô tô với Khu chứa hàng giữa */}
            <line x1="520" y1="120" x2="520" y2="230" stroke="#334155" strokeWidth="3" />
            {/* Vách dọc hướng xuống: ngăn cách Khu đóng gói với Phòng làm việc */}
            <line x1="640" y1="230" x2="640" y2="390" stroke="#334155" strokeWidth="3" />

            {/* ============================================================== */}
            {/* KHU ĐÓNG GÓI HÀNG (DƯỚI TRÁI)                                  */}
            {/* ============================================================== */}
            <g
              className={`wms-room-node ${activeZone === "PACKING" ? "selected" : ""} ${highlightedZone === "PACKING" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("PACKING", "KHU ĐÓNG GÓI HÀNG", "Khu xuất đơn Shopee / TikTok / POS", zonePacking)}
              transform="translate(55, 238)"
            >
              <rect x="0" y="0" width="575" height="217" rx="6" className="wms-room-rect" />
              {renderLocationMarker("PACKING", 287, 135, 210)}
              <g transform="translate(287, 108)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title" fontSize="14">
                  📦 KHU ĐÓNG GÓI HÀNG
                </text>
                <text x="0" y="22" textAnchor="middle" className="wms-room-count">
                  {zonePacking.length} kiện · {zonePacking.reduce((s, u) => s + u.currentPcs, 0).toLocaleString("vi-VN")} đơn vị chờ xuất
                </text>
              </g>
            </g>

            {/* ============================================================== */}
            {/* KHU CHỨA HÀNG (GIỮA)                                            */}
            {/* ============================================================== */}
            <g
              className={`wms-room-node ${activeZone === "CENTER" ? "selected" : ""} ${highlightedZone === "CENTER" ? "unit-location-focus" : ""}`}
              onClick={() => handleZoneClick("CENTER", "KHU CHỨA HÀNG (GIỮA)", "Khu vực lưu trữ trung tâm", zoneCenter)}
              transform="translate(530, 125)"
            >
              <rect x="0" y="0" width="320" height="98" rx="6" className="wms-room-rect" />
              {renderLocationMarker("CENTER", 160, 72, 210)}
              <g transform="translate(160, 50)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">KHU CHỨA HÀNG (GIỮA)</text>
                <text x="0" y="18" textAnchor="middle" className="wms-room-count">
                  {zoneCenter.length} kiện
                </text>
              </g>
            </g>

            {/* ============================================================== */}
            {/* PHÒNG LÀM VIỆC (DƯỚI PHẢI - NẰM DƯỚI NHÀ VỆ SINH VÀ VÁCH DỌC)   */}
            {/* ============================================================== */}
            <g transform="translate(648, 238)">
              <rect x="0" y="0" width="205" height="217" rx="6" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.5" />
              <g transform="translate(102, 108)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title">🏢 PHÒNG LÀM VIỆC</text>
                <text x="0" y="18" textAnchor="middle" fill="#94a3b8" fontSize="11">Văn phòng điều hành</text>
              </g>
            </g>

            {/* ============================================================== */}
            {/* NHÀ VỆ SINH (KHỐI CHUẨN NẰM GIỮA PHẢI, DƯỚI KHU 4)            */}
            {/* ============================================================== */}
            <g transform="translate(860, 135)">
              <rect x="0" y="0" width="225" height="190" rx="6" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
              <g transform="translate(112, 95)">
                <text x="0" y="0" textAnchor="middle" className="wms-room-title" fontSize="13">NHÀ VỆ SINH</text>
              </g>
            </g>
          </svg>
        </div>
      </div>

      {/* POPUP CHI TIẾT TỪNG PHÂN KHU */}
      <Modal
        title={
          <Flex align="center" gap={10}>
            <EnvironmentOutlined style={{ color: "#0f172a", fontSize: 18 }} />
            <div>
              <b style={{ fontSize: 16 }}>{zoneModalData?.title}</b>
              <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                {zoneModalData?.subtitle} · Tổng {zoneModalData?.units.length || 0} kiện lưu trữ
              </Typography.Text>
            </div>
          </Flex>
        }
        open={!!zoneModalData}
        onCancel={() => setZoneModalData(null)}
        footer={
          <Flex justify="space-between" align="center" style={{ width: "100%" }}>
            {onOpenZoneManager && zoneModalData ? (
              <Button
                type="primary"
                icon={<EnvironmentOutlined />}
                style={{ background: "#0f172a", borderColor: "#0f172a" }}
                onClick={() => {
                  const mapZoneKeyToCode: Record<string, string> = {
                    TOP_1: "A1",
                    TOP_2: "A2",
                    TOP_3: "A3",
                    TOP_4: "A4",
                    CENTER: "CENTER",
                    PACKING: "Đóng gói",
                  };
                  const code = mapZoneKeyToCode[zoneModalData.zoneKey] || "A1";
                  setZoneModalData(null);
                  onOpenZoneManager(code);
                }}
              >
                Mở tab Quản lý Khu vực ({zoneModalData.title})
              </Button>
            ) : (
              <div />
            )}
            <Button onClick={() => setZoneModalData(null)}>Đóng</Button>
          </Flex>
        }
        width={740}
        destroyOnHidden
      >
        {zoneModalData && (
          <div className="w2d-zone-modal-content">
            {zoneModalData.units.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Hiện chưa có kiện hàng nào được xếp vào khu vực này"
              />
            ) : (
              <div className="w2d-zone-unit-list">
                {zoneModalData.units.map((unit) => (
                  <div className="w2d-unit-card-row" key={unit.id}>
                    <div className="w2d-unit-info">
                      <div className="w2d-unit-title">
                        <b>{unit.id}</b>
                        <Tag color={unit.status === "Đang sử dụng" ? "orange" : "green"}>
                          {unit.status === "Đang sử dụng" ? "Đang mở" : "Đã niêm phong"}
                        </Tag>
                        <Tag color="purple">{unit.skuName}</Tag>
                      </div>
                      <div className="w2d-unit-desc">
                        <span>{unit.packageLabel || unit.packageType}</span> ·{" "}
                        <b style={{ color: "#059669" }}>
                          {unit.currentPcs.toLocaleString("vi-VN")} {unit.unitName}
                        </b>{" "}
                        (Ban đầu: {unit.initialPcs.toLocaleString("vi-VN")})
                      </div>
                    </div>
                    <div className="w2d-unit-actions">
                      <Button
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => {
                          setZoneModalData(null);
                          onSelectUnit?.(unit);
                        }}
                      >
                        Chi tiết
                      </Button>
                      {unit.status === "Đang sử dụng" && (
                        <Button
                          size="small"
                          type="primary"
                          icon={<ShoppingCartOutlined />}
                          onClick={() => {
                            setZoneModalData(null);
                            onPickUnit?.(unit);
                          }}
                        >
                          Rút hàng
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
