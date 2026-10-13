// Export-order penalties are retired. Keep the public reconciliation entry
// point for existing IPC/maintenance callers, but never scan or charge orders.
const { withdrawFines, reconcileWithdrawnFines } = require('./attendance-withdrawn-fines.cjs');
const WITHDRAWAL_NOTE = 'Gỡ bỏ chính sách phạt xuất hàng TMĐT theo yêu cầu quản lý.';

function isEcommerceOrderFine(fine) {
  const type = String(fine?.type || '').trim().toLocaleLowerCase('vi-VN');
  return ['ecommerce_overdue', 'ecommerce_mismatch'].includes(fine?.source)
    || /^fine-ecommerce-(overdue|mismatch)-/.test(String(fine?.id || ''))
    || ['đơn tmdt trễ hạn', 'đơn tmdt trễ hẹn', 'đơn tmdt cần kiểm tra quá ngày',
      'đơn tmđt trễ hạn', 'đơn tmđt trễ hẹn', 'đơn tmđt cần kiểm tra quá ngày'].includes(type);
}

function withdrawEcommerceOrderFines(data, now = new Date()) {
  return withdrawFines(data, isEcommerceOrderFine, WITHDRAWAL_NOTE, now);
}

async function reconcileEcommerceOrderFines(prisma, options = {}) {
  return reconcileWithdrawnFines(prisma, isEcommerceOrderFine, WITHDRAWAL_NOTE, options);
}

module.exports = { isEcommerceOrderFine, withdrawEcommerceOrderFines, reconcileEcommerceOrderFines };
