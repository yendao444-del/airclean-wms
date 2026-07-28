# Chi dinh: khoa dieu chinh ton truc tiep

## Van de

`products:updateStock` la API tong quat co the tang/giam ton theo SKU. Neu manager/staff goi truc tiep API nay, ho co the sua ton ma khong di qua phieu nhap, xuat hang, tra hang, hoac quy trinh kiem hang.

Vi du: he thong co 20 quyen Sach, thuc te con 15. Nguoi dung goi truc tiep API tru 5 thi he thong thanh 15, nhung khong co phien kiem, khong co gioi han nhap lai, va khong bat buoc ly do theo quy trinh kiem hang.

## Quy tac bat buoc

1. Chi admin duoc phep dieu chinh ton truc tiep ngoai nghiep vu.
2. Manager/staff chi duoc cap nhat ton qua IPC chuyen dung cua nghiep vu hop le.
3. Moi cap nhat ton phai co `referenceType`, `reference`, `note`, `createdBy` va inventory log.
4. Backend khong tin role an/hien nut o React; phai kiem tra role trong IPC handler.

## Cac luong duoc phep

| Luong | Role duoc phep | IPC rieng | Yeu cau |
| --- | --- | --- | --- |
| Phieu nhap | Role theo phan quyen nhap hang | `purchases:*` | So phieu nhap, NCC, log |
| Don xuat / POS / TMDT | Role theo phan quyen ban hang | `orders:*`, `exportOrders:*` | Ma don, log |
| Tra hang / huy don | Role theo phan quyen | IPC tra hang/huy don | Tham chieu chung tu goc |
| Kiem hang | Admin + manager duoc phan cong | `stockCheck:balanceItem` | Session, SKU, ly do, retry, log |
| Dieu chinh thu cong | Chi admin | `inventory:manualAdjust` | Ly do bat buoc, audit log |

## Thay doi backend

1. Khong expose `products:updateStock` cho renderer thuong, hoac tach no thanh API noi bo khong goi truc tiep tu React.
2. Tao cac ham noi bo dung chung de cap nhat ton trong Electron main process. Cac IPC nghiep vu goi ham noi bo nay sau khi da validate chung tu va role.
3. Neu giu `products:updateStock` de tuong thich tam thoi:
   - bat buoc `requireRole('admin')`;
   - chi chap nhan `referenceType: 'MANUAL_ADJUST'`;
   - bat buoc `note` khong rong;
   - ghi activity log muc do cao.
4. `stockCheck:balanceItem` khong goi API renderer `products:updateStock`; no goi ham cap nhat ton noi bo trong Electron va tu them `referenceType: 'CAN_BANG'`.
5. Kiem tra cac module Nhap hang, Don xuat, Tra hang, Huy don. Chuyen moi noi dang goi `window.electronAPI.products.updateStock` sang IPC nghiep vu tuong ung truoc khi khoa API tong quat.

## Checklist kiem thu

1. Manager/staff goi truc tiep `products:updateStock` -> backend tu choi.
2. Admin dieu chinh thu cong khong co ly do -> backend tu choi.
3. Admin dieu chinh thu cong co ly do -> ton cap nhat va co inventory log + activity log.
4. Nhap hang, xuat hang, tra hang, huy don van cap nhat ton dung sau khi tach API.
5. `stockCheck:balanceItem` van can bang dung va luu reference `CAN_BANG`.
6. Khong co duong cap nhat ton nao thieu username, reference, note va timestamp.
