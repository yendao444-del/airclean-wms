import { Button, InputNumber, Tooltip } from 'antd';
import { CheckOutlined, FileTextOutlined, InfoCircleOutlined, SendOutlined } from '@ant-design/icons';

export interface WorksheetBatch {
    id: number;
    code: string;
    productName: string;
    productSku: string;
    packagingType?: string;
    packagingLabel?: string;
    components?: Array<{ sku: string; name: string; quantity: number; unit: string }>;
    unit: string;
    requestedQty: number;
    reportedQty: number;
    readyQty: number;
    status: string;
}

interface Props {
    rows: WorksheetBatch[];
    quantities: Record<number, number | null>;
    hasReport: (row: WorksheetBatch) => boolean;
    reportQuantity: (row: WorksheetBatch) => number;
    blocked: boolean;
    submitting: boolean;
    onChange: (id: number, quantity: number | null) => void;
    onSubmit: (id: number) => void;
    onDetails: (id: number) => void;
}

const shortComponentName = (row: WorksheetBatch, name: string) => name.startsWith(`${row.productName} - `)
    ? name.slice(row.productName.length + 3)
    : name;

export default function PrepackWorksheet({ rows, quantities, hasReport, reportQuantity, blocked, submitting, onChange, onSubmit, onDetails }: Props) {
    return <>
        <div className="prepack-worksheet-scroll">
            <table className="prepack-worksheet">
                <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
                <thead><tr><th>Combo</th><th>Thành phần</th><th>Được giao</th><th>Đã đóng</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody>{rows.map(row => {
                    const submitted = hasReport(row);
                    const accepted = row.status === 'ready';
                    const depleted = row.status === 'depleted';
                    const locked = submitted || accepted || depleted || row.status === 'rejected';
                    const quantity = locked ? reportQuantity(row) : quantities[row.id] ?? null;
                    const valid = quantity !== null && Number.isInteger(quantity) && quantity >= 0 && quantity <= 100000;
                    const status = accepted ? 'ready' : depleted ? 'depleted' : row.status === 'rejected' ? 'rejected' : submitted ? 'submitted' : quantity !== null ? 'draft' : 'missing';
                    const composition = row.components?.length
                        ? row.components.map(component => `${component.quantity} ${component.unit} ${shortComponentName(row, component.name)}`).join(' + ')
                        : row.packagingLabel || row.productSku;
                    return <tr key={row.id}>
                        <td><strong>{row.packagingType === 'combo' ? `Combo · ${row.productName}` : row.productName}</strong><small>{row.packagingType === 'combo' ? row.packagingLabel || composition : row.productSku}</small></td>
                        <td><span>{composition}</span>{valid && row.components?.length ? <small>{quantity} {row.unit} = {row.components.map(component => `${quantity * component.quantity} ${component.unit} ${shortComponentName(row, component.name)}`).join(' + ')}</small> : <small>{row.code}</small>}</td>
                        <td>{row.requestedQty.toLocaleString('vi-VN')} {row.unit}</td>
                        <td><InputNumber aria-label={`Số lượng đã đóng ${row.code}`} min={0} max={100000} precision={0} value={quantity} placeholder="Nhập" disabled={locked || blocked || submitting} onChange={value => onChange(row.id, value === null ? null : Number(value))} /></td>
                        <td><span className={`prepack-worksheet-status ${status}`}>{status === 'ready' ? 'Sẵn sàng' : status === 'depleted' ? 'Đã xuất hết' : status === 'rejected' ? 'Không nghiệm thu' : status === 'submitted' ? 'Chờ xác nhận' : status === 'draft' ? 'Đang đóng' : 'Chưa nhập'}</span>{accepted && <small>Còn {row.readyQty.toLocaleString('vi-VN')} {row.unit}</small>}</td>
                        <td>{accepted || depleted || row.status === 'rejected' ? <Button icon={<FileTextOutlined />} onClick={() => onDetails(row.id)}>Xem chi tiết</Button> : submitted ? <Button disabled icon={<CheckOutlined />}>Đã gửi</Button> : <Tooltip title={blocked ? 'Chờ tải dữ liệu hoặc chọn ngày hôm nay để gửi' : undefined}><Button type="primary" icon={<SendOutlined />} loading={submitting} disabled={blocked || !valid || submitting} onClick={() => onSubmit(row.id)}>Gửi xác nhận</Button></Tooltip>}</td>
                    </tr>;
                })}</tbody>
            </table>
        </div>
        <div className="prepack-worksheet-note"><InfoCircleOutlined /> Đóng gói sẵn không làm giảm tổng tồn kho.</div>
    </>;
}
