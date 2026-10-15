# DBY POS Updates

Thu muc nay chua toan bo file build/release va tai lieu chon dung loai cap nhat.

Doc `QUY_TAC_PHAT_HANH.md` truoc khi chay bat ky file nao. Kiem tra them `SECURITY-DEPLOYMENT.md` khi thay doi runtime, credentials hoac bo cai.

| Nhu cau | File |
| --- | --- |
| UI/frontend nhe | `RELEASE-SUPPERLITE.bat` |
| UI + Electron backend, khong Prisma/Python | `RELEASE-ver3.bat` |
| Schema, migration hoac Prisma Client moi | `RELEASE-PRISMA-PATCH.bat` |
| Prisma + Python face service | `RELEASE-ver2.bat` |
| Full resources release | `RELEASE.bat` |
| Bo cai Windows day du | `BUILD-INSTALLER.bat` |

Tat ca file BAT tu dong chuyen working directory ve thu muc goc cua du an truoc khi build.

## Tiep tuc quick patch bi loi upload

Khong chay lai release thuong de tranh tang version va commit lai. Giu nguyen
cap ZIP va `.sha256`, sau do chay tu thu muc goc:

```powershell
.\updates\RELEASE-ver3.bat --resume 1.0.488
```

Che do nay kiem tra ZIP, version ben trong, SHA-256 va commit release da push;
khong tang version, commit hay push. Release duoc giu o draft trong khi upload
tung asset voi `--clobber`. Chi publish sau khi GitHub xac nhan dung kich thuoc
va SHA-256 cua ca hai asset. Release da publish se bi chan, khong ghi de.
Neu upload loi, ZIP/checksum va draft duoc giu lai de chay lai lenh tren.
Neu ZIP da mat, can tao lai tu dung commit release; khong ghep checksum cu voi
ZIP moi, va khong dong goi cac thay doi chua commit vao ban phat hanh cu.
