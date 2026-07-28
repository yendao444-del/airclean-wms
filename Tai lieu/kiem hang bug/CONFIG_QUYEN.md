# Phan quyen appConfig

## Van de

`appConfig:get(key)` va `appConfig:set(key, value)` la API tong quat. Neu backend khong kiem tra tung key, mot manager co the doc/ghi du lieu khong thuoc nghiep vu cua ho bang duong ky thuat, du giao dien da an nut.

Vi du: man hinh manager an ton he thong, nhung neu backend van tra `stockCheckSessionsV2` qua `appConfig:get`, manager co the lay session day du gom ton he thong va chenhlech.

## Chi dinh

1. Electron backend phai phan quyen theo tung key truoc khi doc hoac ghi `appConfig`.
2. Khong dua vao an/hien nut React de bao mat du lieu.
3. Cac key nghiep vu phuc tap phai dung IPC chuyen dung, khong dung `appConfig` tong quat.

## Nhom quyen

### Chi admin

- `stockCheckSessionsV2` (du lieu day du)
- lich su can bang kho
- nguong ton, tam ngung theo doi SKU
- cau hinh tai khoan/dich vu, token, credential
- cau hinh phat, cham cong, phan quyen
- lich su va snapshot quan tri

### Manager

- Chi cac key can cho man hinh duoc cap phep ro rang.
- Du lieu Kiem hang phai dung `stockCheck:getSessions`; response da loc, khong co `systemStock` va `difference`.

### Staff/viewer

- Mac dinh tu choi `appConfig:get/set`, tru cac key cong khai duoc allowlist ro rang.

## Cach trien khai

1. Tao map quyen, vi du `CONFIG_ACCESS[key] = { read: ['admin'], write: ['admin'] }`.
2. Trong `appConfig:get` va `appConfig:set`, lay role tu `currentSession`, kiem tra map truoc khi query Prisma.
3. Key khong nam trong allowlist: tu choi mac dinh.
4. Tach key `stockCheckSessionsV2` sang IPC `stockCheck:*`; non-admin khong duoc goi `appConfig` voi key nay.
5. Khong expose token/credential qua preload cho renderer neu khong bat buoc.
6. Ghi activity log khi admin sua key nhay cam.

## Checklist

1. Manager goi `appConfig:get('stockCheckSessionsV2')` -> bi tu choi.
2. Manager goi `appConfig:set('stockCheckSessionsV2', ...)` -> bi tu choi.
3. Manager chi doc duoc key trong allowlist.
4. Staff/viewer khong doc/ghi duoc key quan tri.
5. Admin doc/ghi dung key duoc cap quyen va co audit log voi key nhay cam.
6. Test truc tiep IPC, khong chi test giao dien.
