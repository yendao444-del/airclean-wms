import { Modal, type ModalProps } from "antd";
import "./HandlingUnitModal.css";

export default function HandlingUnitModal({ className = "", width, ...props }: ModalProps) {
  const wideWidth = className.includes("hu-print-modal") ? width ?? 760
    : typeof width === "number" ? Math.max(1000, width) : width ?? 1000;
  return <Modal {...props} centered width={wideWidth} className={`hu-responsive-modal ${className}`} />;
}
