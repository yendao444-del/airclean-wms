// Shared, packer-facing names for an order pattern (used by "Gợi ý đóng gói"
// and "Đóng gói sẵn"). Pure functions: no IPC, no state.
export type PatternComponent = { sku: string; quantity: number };
export type VariantInfo = { productSku: string; productName: string; color: string; unit?: string };

export const colorNames: Record<string, string> = { TRANG: 'trắng', DEN: 'đen', BE: 'be', XAM: 'xám', HONG: 'hồng', XANH: 'xanh', GHI: 'ghi', KEMSUA: 'kem sữa', CAM: 'cam', XANHDAM: 'xanh đậm', XANHTHAN: 'xanh than', XANHNHAT: 'xanh nhạt', XANHCOBAN: 'xanh coban', XANHMIN: 'xanh min', HONGDAM: 'hồng đậm', HONGTIM: 'hồng tím', TIMDAM: 'tím đậm', CAMDAO: 'cam đào', THAN: 'than' };
// "Loại + Thương hiệu", e.g. 5D Unicare; the quantity follows in the label.
export const productNames: Record<string, string> = {
    '5DUNI': '5D Unicare', '6D-UNI': '6D Unicare', '3DUNI': '3D Unicare', UPF: 'UPF Unicare', 'UPF-NAMI': 'UPF Nami',
    '5DTHINHPHAT': '5D Thịnh Phát', '6DTHINHPHAT': '6D Thịnh Phát', '9ATHINHPHAT': '9A Thịnh Phát',
    '3DMONJI': '3D Monji', '5DMONJI': '5D Monji', '5DMASKMONJI': '5D Monji',
    AMIECO: 'AMI Eco', AMIMEDICAL: 'AMI Medical', KF94AMI: 'KF94 AMI',
    KF94DUYNGOC: 'KF94 Duy Ngọc', '5DDUYNGOC': '5D Duy Ngọc', '5DDUYQUAN': '5D Duy Quân',
    '5DDIMICO': '5D Dimico', '6DJULI': '6D Juli', 'KF94-SHINHYE': 'KF94 Shin Hye', KF94LANDMASK: 'KF94 Land Mask', KF94LOKA: 'KF94 Loka',
};

export const productCodeOf = (sku: string) => {
    const parts = sku.toUpperCase().replace(/^1-/, '').split('-');
    return parts.length > 1 && colorNames[parts[parts.length - 1]] ? parts.slice(0, -1).join('-') : parts.join('-');
};
// "Đơn combo" = more than one brand; several colors of one brand stay "Đơn lẻ".
export const brandOf = (sku: string) => {
    const code = productCodeOf(sku);
    if (code.includes('THINHPHAT')) return 'THINHPHAT';
    if (code.includes('UNI')) return 'UNICARE';
    if (code.includes('MONJI')) return 'MONJI';
    if (code.startsWith('AMI')) return 'AMI';
    if (code.startsWith('UPF')) return 'UPF';
    if (code.includes('DUYNGOC')) return 'DUYNGOC';
    return code;
};
export const isMultiBrand = (components: Array<{ sku: string }>) => new Set(components.map(component => brandOf(component.sku))).size > 1;

// Same key as the backend suggestion basket: upper-case SKU totals sorted by SKU.
export const patternKey = (components: PatternComponent[]) => {
    const totals = new Map<string, number>();
    for (const item of components) {
        const sku = item.sku.trim().toUpperCase();
        totals.set(sku, (totals.get(sku) || 0) + Number(item.quantity || 0));
    }
    return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => `${sku}:${quantity}`).join('|');
};

const capitalize = (value: string) => value ? value.charAt(0).toLocaleUpperCase('vi-VN') + value.slice(1).toLocaleLowerCase('vi-VN') : '';
const number = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

// One color: "AMI Eco Đen - 1 Hộp". Mixed colors: "5D Unicare 5 Gói Đen + 5 Gói Trắng".
// Several products: joined with " + ".
export function patternLabel(components: PatternComponent[], variants: Record<string, VariantInfo> = {}, unitNames: Map<string, string> = new Map()) {
    const groups = new Map<string, { name: string; items: Array<{ color: string; amount: string }> }>();
    for (const c of components) {
        const info = variants[c.sku.toUpperCase()];
        const parts = c.sku.toUpperCase().replace(/^1-/, '').split('-');
        const parsedColor = parts.length > 1 ? colorNames[parts[parts.length - 1]] : undefined;
        const product = info?.productSku ? info.productSku.toUpperCase().replace(/^1-/, '') : parsedColor ? parts.slice(0, -1).join('-') : parts.join('-');
        const color = capitalize(info?.color || parsedColor || '');
        const name = productNames[product] || info?.productName.replace(/^khẩu trang\s+/i, '') || product;
        // Smallest sold unit from the catalog: AMI = Hộp, Unicare / Thịnh Phát = Gói.
        const unit = capitalize(info?.unit || unitNames.get(c.sku.toUpperCase()) || 'gói');
        const group = groups.get(product) || { name, items: [] };
        group.items.push({ color, amount: `${number(c.quantity)} ${unit}` });
        groups.set(product, group);
    }
    return [...groups.values()].map(group => group.items.length === 1
        ? `${group.name}${group.items[0].color ? ` ${group.items[0].color}` : ''} - ${group.items[0].amount}`
        : `${group.name} ${group.items.map(item => `${item.amount}${item.color ? ` ${item.color}` : ''}`).join(' + ')}`).join(' + ');
}

export type PlanState = 'missing' | 'enough' | 'extra';
export function planState(packed: number, target: number): { state: PlanState; diff: number } {
    if (packed < target) return { state: 'missing', diff: target - packed };
    if (packed > target) return { state: 'extra', diff: packed - target };
    return { state: 'enough', diff: 0 };
}
// Default target = orders per day, rounded (42,3 -> 42).
export const defaultTarget = (perDay: number) => Math.max(0, Math.round(perDay || 0));
// "Làm tròn lên 10": next multiple of `step` at or above the target (12 → 20, 3 → 10, 20 → 20).
export const roundUpTarget = (qty: number, step = 10) => Math.max(step, Math.ceil((Number(qty) || 0) / step) * step);

// Contiguous blocks in rank order: A gets 1,2,3; B gets 4,5,6.
export function splitContiguous<T>(items: T[], owners: string[]): Array<{ item: T; owner: string }> {
    if (!owners.length) return [];
    const size = Math.ceil(items.length / owners.length);
    return items.map((item, index) => ({ item, owner: owners[Math.min(owners.length - 1, Math.floor(index / size))] }));
}
