export const canRecheckHandlingUnit = (status: string): boolean =>
    ['Nguyên niêm phong', 'Đang sử dụng', 'Chờ kiểm', 'sealed', 'opened', 'pending_check'].includes(status);
