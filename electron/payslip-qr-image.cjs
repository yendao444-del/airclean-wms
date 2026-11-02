'use strict';

const MAX_QR_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// VietQR now redirects its .png URLs to SVG. An image-only SVG is safe inside
// <img>, but refuse anything active or external since it comes from the network.
function isPlainSvg(image) {
  const text = image.toString('utf8');
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(text)) return false;
  // VietQR draws the code and bank logo as embedded data:image <image> elements.
  return !/<(?:script|foreignObject|iframe|object|embed|use)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?!data:image\/(?:png|jpeg);base64,)/i.test(text);
}

function payslipQrImageToDataUrl(image) {
  if (!image.length || image.length > MAX_QR_BYTES) {
    throw new Error('Ảnh VietQR trống hoặc vượt quá giới hạn 3 MB.');
  }
  const isPng = image.length >= 8 && image.subarray(0, 8).equals(PNG_SIGNATURE);
  const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const mimeType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isPlainSvg(image) ? 'image/svg+xml' : null;
  if (!mimeType) throw new Error('VietQR không trả về tệp ảnh hợp lệ.');
  return `data:${mimeType};base64,${image.toString('base64')}`;
}

module.exports = { payslipQrImageToDataUrl };
