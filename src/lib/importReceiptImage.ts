const MAX_IMPORT_RECEIPT_BYTES = 2 * 1024 * 1024;
const TARGET_IMPORT_RECEIPT_BYTES = Math.floor(1.9 * 1024 * 1024);

function estimateBase64Bytes(base64: string) {
  return Math.ceil((base64.length * 3) / 4);
}

export async function compressImportReceiptJpeg(
  file: File,
): Promise<{ fileBase64: string; fileName: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (file.type !== "image/jpeg" && extension !== "jpg" && extension !== "jpeg") {
    throw new Error("Phiếu Nhập Kho chỉ nhận file JPG/JPEG.");
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Không thể xử lý ảnh Phiếu Nhập Kho.");

        let scale = Math.min(1, 2600 / Math.max(image.width, image.height));
        let encoded = "";
        for (let resizeAttempt = 0; resizeAttempt < 6; resizeAttempt += 1) {
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          for (let quality = 0.9; quality >= 0.5; quality -= 0.08) {
            encoded = canvas.toDataURL("image/jpeg", quality).split(",")[1] || "";
            if (estimateBase64Bytes(encoded) <= TARGET_IMPORT_RECEIPT_BYTES) break;
          }
          if (estimateBase64Bytes(encoded) <= MAX_IMPORT_RECEIPT_BYTES) break;
          scale *= 0.82;
        }

        if (!encoded || estimateBase64Bytes(encoded) > MAX_IMPORT_RECEIPT_BYTES) {
          throw new Error("Không thể nén Phiếu Nhập Kho xuống dưới 2 MB.");
        }
        resolve({
          fileBase64: encoded,
          fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("File JPG Phiếu Nhập Kho bị lỗi hoặc không đọc được."));
    };
    image.src = objectUrl;
  });
}
