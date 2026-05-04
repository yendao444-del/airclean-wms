const fs = require('fs');
const tsx = fs.readFileSync('g:/QUAN LY BAN HANG/desktop-FIXDEBUG/src/pages/Attendance.tsx', 'utf8');
const css = fs.readFileSync('g:/QUAN LY BAN HANG/desktop-FIXDEBUG/src/pages/Attendance.css', 'utf8');

// Tìm TẤT CẢ class được dùng trong phần modal payslip
const re = /className=["']([^"']+)["']/g;
const classSet = new Set();
let m;
while ((m = re.exec(tsx)) !== null) {
  m[1].split(/\s+/).forEach(c => {
    if (c.startsWith('ps-')) classSet.add(c);
  });
}

// Kiểm tra trong CSS
console.log('=== ps-* class coverage ===');
let missing = 0;
classSet.forEach(cls => {
  const inCss = css.includes('.' + cls);
  if (!inCss) {
    console.log('  MISSING: .' + cls);
    missing++;
  }
});
console.log(`\nTotal missing: ${missing} / ${classSet.size}`);
