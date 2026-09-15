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
