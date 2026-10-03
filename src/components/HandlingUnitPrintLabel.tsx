import { QRCode } from "antd";

type PrintLabelUnit = {
  id: string;
  sequenceNumber?: number;
  skuName: string;
  color?: string;
  qrPayload?: string;
};

export default function HandlingUnitPrintLabel({
  unit,
  labelSize,
  catalogColor,
}: {
  unit: PrintLabelUnit;
  labelSize: "A6" | "A7";
  catalogColor?: string;
}) {
  const qrCode = String(unit.qrPayload || unit.id || "").trim();
  const legacySuffix = qrCode.match(/-(\d+)$/)?.[1];
  const parsedLegacyNumber = Number(legacySuffix);
  const sequenceNumber =
    Number.isSafeInteger(Number(unit.sequenceNumber)) && Number(unit.sequenceNumber) > 0
      ? Number(unit.sequenceNumber)
      : Number.isSafeInteger(parsedLegacyNumber) && parsedLegacyNumber > 0
        ? parsedLegacyNumber
        : undefined;
  const color = unit.color?.trim() || catalogColor?.trim() || "Chưa có màu";
  const numberFontSize = sequenceNumber
    ? `${Math.min(labelSize === "A7" ? 20 : 30, (labelSize === "A7" ? 100 : 145) / String(sequenceNumber).length)}mm`
    : undefined;
  // Tem chưa nhập dùng mã đã phát hành; kiện đã nhập/tách dùng mã kiện để tra cứu.

  return (
    <div className={`hu-print-label ${labelSize.toLowerCase()}`}>
      <div className="hu-pl-number">
        <span>KIỆN</span>
        <strong
          className={sequenceNumber ? undefined : "hu-pl-number-missing"}
          style={{ fontSize: numberFontSize }}
        >
          {sequenceNumber || "Chưa cấp số"}
        </strong>
      </div>
      <div className="hu-pl-color">
        <span>MÀU SẮC</span>
        <strong>{color}</strong>
      </div>
      <div className="hu-pl-sku">
        <span>MÃ SKU</span>
        <strong>{unit.skuName}</strong>
      </div>
      {qrCode && (
        <div className="hu-pl-qr" aria-label={`Mã QR ${qrCode}`}>
          <QRCode
            value={qrCode}
            // SVG giữ nguyên khi clone DOM để xuất PDF; canvas không giữ bitmap.
            type="svg"
            size={labelSize === "A7" ? 98 : 128}
            marginSize={4}
            bordered={false}
            color="#000000"
            bgColor="#ffffff"
          />
          <code>{qrCode}</code>
        </div>
      )}
    </div>
  );
}
