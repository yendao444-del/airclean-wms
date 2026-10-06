// The prepack shortfall penalty is withdrawn. Older callers retain the same
// entry point, but quota checks can no longer create fines.
const { withdrawFines, reconcileWithdrawnFines } = require('./attendance-withdrawn-fines.cjs');
const WITHDRAWAL_NOTE = 'Gỡ bỏ chính sách phạt thiếu đóng gói sẵn theo yêu cầu quản lý.';

function isPrepackShortfallFine(fine) {
  return fine?.source === 'prepack-shortfall'
    || String(fine?.id || '').startsWith('fine-prepack-shortfall-')
    || String(fine?.type || '').trim().toLocaleLowerCase('vi-VN') === 'thiếu đóng gói sẵn';
}

function withdrawPrepackShortfallFines(data, now = new Date()) {
  return withdrawFines(data, isPrepackShortfallFine, WITHDRAWAL_NOTE, now);
}

async function reconcilePrepackShortfallFines(prisma, options = {}) {
  return reconcileWithdrawnFines(prisma, isPrepackShortfallFine, WITHDRAWAL_NOTE, options);
}

module.exports = { isPrepackShortfallFine, withdrawPrepackShortfallFines, reconcilePrepackShortfallFines };
