# Can bang atomic

## Van de

Can bang kho hien co nhieu buoc tach roi:

1. Cap nhat ton kho.
2. Luu lich su can bang.
3. Cap nhat item/phien kiem thanh `balanced`.
4. Ghi inventory log va activity log.

Neu loi DB, mat ket noi, hoac tat ung dung giua cac buoc, du lieu co the khong dong bo. Vi du ton da doi nhung khong co lich su; hoac item da hien `Da can` nhung ton chua cap nhat.

## Chi dinh

Tao mot service/backend handler duy nhat cho can bang, vi du `stockCheck:balanceItem` va `stockCheck:balanceGroup`.

Tat ca thay doi sau phai nam trong mot Prisma transaction:

- Cap nhat ton SKU/variant.
- Tao inventory log voi `referenceType: 'CAN_BANG'`.
- Tao `stockBalance` history.
- Cap nhat session kiem (`actualStock`, `difference`, `balanced`, `completedAt` neu phu hop).
- Tao activity log.

Neu bat ky buoc nao loi, rollback toan bo. Renderer chi nhan ket qua sau khi transaction commit thanh cong.

## Quy tac

1. Khong cap nhat ton tu React.
2. Khong danh dau `balanced` truoc khi transaction thanh cong.
3. Moi request dung mot `reference` duy nhat de truy vet va tranh ghi trung khi retry.
4. Neu request trung reference da thanh cong, tra lai ket qua cu; khong cap nhat ton lan hai.
5. Ghi ro `username`, `sessionId`, `sku`, ton truoc/sau va ly do trong log backend.

## Checklist

1. Gia lap loi khi tao history: ton va session khong thay doi.
2. Gia lap loi khi cap nhat ton: khong tao history/log/session da can.
3. Gui lai cung mot request/reference: ton chi doi mot lan.
4. Can bang thanh cong: ton, history, inventory log, activity log va session dong bo.
5. `node --check electron/ipc-handlers.js` va `npm run build` thanh cong.
