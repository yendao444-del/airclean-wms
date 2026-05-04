const fs = require('fs');
const FILE_PATH = 'g:/QUAN LY BAN HANG/desktop-FIXDEBUG/src/pages/Attendance.tsx';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const REPLACEMENTS = [
  // Fix leftover collapsed words
  [/Nhn s\?/g, 'Nhân sự'],
  [/nhn s\?/g, 'nhân sự'],
  [/NHN S\?/g, 'NHÂN SỰ'],
  [/có nhn/g, 'cá nhân'], // "c nhn" -> "có nhn" (bị regex sửa 'c' thành 'có')
  [/C. NHN/g, 'CÁ NHÂN'],

  // Fix words with ?
  [/nh\?p/g, 'nhập'],
  [/Nh\?p/g, 'Nhập'],
  [/ch\?p/g, 'chụp'],
  [/ph\?t/g, 'phạt'],
  [/Ph\?t/g, 'Phạt'],
  [/ch\?t/g, 'chốt'],
  [/m\? kh.a/g, 'mở khóa'],
  [/khu.n m\?t/g, 'khuôn mặt'],
  [/k\? luong/g, 'kỳ lương'],
  [/k\? n.y/g, 'kỳ này'],
  [/th.ng tin/g, 'thông tin'],
  [/chu\?n/g, 'chuẩn'],
  [/ho.n t\?t/g, 'hoàn tất'],
  [/b\?t bu\?c/g, 'bắt buộc'],
  [/B\?t bu\?c/g, 'Bắt buộc'],
  [/thu\?ng/g, 'thưởng'],
  [/Thu\?ng/g, 'Thưởng'],
  [/ch\?n/g, 'chọn'],
  [/Ch\?n/g, 'Chọn'],
  [/Qu\?n l./g, 'Quản lý'],
  [/l\?ch s\?/g, 'lịch sử'],
  [/h\? th.ng/g, 'hệ thống'],
  [/kh.ng/g, 'không'],
  [/Kh.ng/g, 'Không'],
  [/vui l.ng/g, 'vui lòng'],
  [/t.nh/g, 'tính'],
  [/d. li.u/g, 'dữ liệu'],
  [/t. d.ng/g, 'tự động'],
  [/l.i/g, 'lỗi'],
  [/L.i/g, 'Lỗi'],
  [/đăng k\?/g, 'đăng ký'],
  [/Đăng k\?/g, 'Đăng ký'],

  // General ? fixes
  [/\?i.n m/g, 'điền mã'],
  [/\? /g, ' '], // Stray ?s
  [/ \?/g, ' '], // Stray ?s
];

let totalFixed = 0;
for (const [pattern, replacement] of REPLACEMENTS) {
  const before = content;
  content = content.replace(pattern, replacement);
  if (content !== before) {
    const count = (before.match(pattern) || []).length;
    console.log(`Fixed ${count}x: "${replacement}"`);
    totalFixed += count;
  }
}

// Clean up weird double punctuation
content = content.replace(/ \?\?/g, '');
content = content.replace(/\?\? /g, '');

fs.writeFileSync(FILE_PATH, content, 'utf8');
console.log(`\nTotal fixes: ${totalFixed}`);
console.log('Done! File saved.');
