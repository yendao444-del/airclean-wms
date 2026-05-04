const fs = require('fs');
const path = 'g:/QUAN LY BAN HANG/desktop-FIXDEBUG/src/pages/Attendance.tsx';
let content = fs.readFileSync(path, 'utf8');

// The faulty lines left:
// title={editingEmp ? "? S?a Nhn S?" : "? Thêm Nhn S?"}
content = content.replace(/title=\{editingEmp \? "\? S\?a Nhn S\?" : "\? Thêm Nhn S\?"\}/g, 'title={editingEmp ? " Sửa Nhân Sự" : " Thêm Nhân Sự"}');
// also some weird edit from replace_file_content 
// okText="Luu Nhn S?" cancelText="H?y"
content = content.replace(/okText="Luu Nhn S\?" cancelText="H\?y"/g, 'okText="Lưu Nhân Sự" cancelText="Hủy"');

// Fix the typo the replace_file_content introduced
content = content.replace(/fundModalType === 'in'\n\s+'📥 Bạn đang ghi nhận/g, "fundModalType === 'in'\n                        ? '📥 Bạn đang ghi nhận");
content = content.replace(/fundModalType === 'in'  'VD:/g, "fundModalType === 'in' ? 'VD:");

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed last remaining bad strings');
