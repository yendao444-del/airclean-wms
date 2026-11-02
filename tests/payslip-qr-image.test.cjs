const test = require('node:test');
const assert = require('node:assert/strict');
const { payslipQrImageToDataUrl } = require('../electron/payslip-qr-image.cjs');

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="490" height="490" viewBox="0 0 490 490" role="img"><title>VietQR</title><rect width="490" height="490" fill="#ffffff"/><image x="0" y="0" width="490" height="490" href="data:image/png;base64,iVBORw0KGgo="/><g><image href="data:image/jpeg;base64,/9j/4AAQ"/></g></svg>';

test('accepts the SVG VietQR now serves, plus PNG and JPEG', () => {
  assert.match(payslipQrImageToDataUrl(Buffer.from(svg)), /^data:image\/svg\+xml;base64,/);
  assert.match(payslipQrImageToDataUrl(Buffer.from(`<?xml version="1.0"?>\n${svg}`)), /^data:image\/svg\+xml;base64,/);
  assert.match(payslipQrImageToDataUrl(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])), /^data:image\/png;base64,/);
  assert.match(payslipQrImageToDataUrl(Buffer.from([0xff, 0xd8, 0xff, 0])), /^data:image\/jpeg;base64,/);
});

test('refuses active or external SVG content and non-images', () => {
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.test">x</a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>',
    '<html><body>Moved</body></html>',
  ]) {
    assert.throws(() => payslipQrImageToDataUrl(Buffer.from(bad)), /tệp ảnh hợp lệ/, bad);
  }
  assert.throws(() => payslipQrImageToDataUrl(Buffer.alloc(0)), /trống/);
});
