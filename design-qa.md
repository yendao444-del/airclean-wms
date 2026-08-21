# Design QA — Phiếu nhập kho trong Tạo kiện nhanh

## Comparison target

- Source visual truth: `C:\Users\Admin\.codex\generated_images\01a01d4c-3565-7c31-8f53-d09b15f29b12\exec-feb821d8-5d73-4735-bfd4-c843840531ac.png`
- Source dimensions: 1516 × 1038 px (generated modal reference)
- Implementation target: `src/pages/HandlingUnits.tsx`, modal **Tạo kiện nhanh**
- Intended viewport: desktop modal, `width={1180}`
- Intended state: one QR kiện has been scanned, supplier is supplied by QR, receipt image/PDF has not yet been attached.

## Evidence status

The Vite implementation was built successfully with `npm run build`.

Browser-rendered verification is unavailable in this pass: `http://127.0.0.1:4173/` stops at the application login screen and no authenticated test session was available. Therefore a screenshot of the changed modal cannot be captured at the matching state, and a side-by-side visual comparison cannot be completed.

## Implemented changes for the selected design

- Removed the entire VAT invoice block and its VAT modal from **Tạo kiện nhanh**.
- Removed VAT validation and VAT-upload actions from the quick receiving confirmation flow.
- Expanded the receipt column to only show receipt data: supplier from QR, receipt metadata, product lines, editable import price, total, and one receipt upload target.
- Supplier keeps a compact `Từ QR` status and an explanatory `Đổi` action; there is no company dropdown in the receipt item row.
- Updated the footer wording so it only refers to the receipt and Drive evidence.

## Required fidelity surfaces

### Fonts and typography

Code uses the existing product typography, sizes, and Ant Design controls. Browser rendering could not be checked for wrapping or optical weight.

### Spacing and layout rhythm

The receipt column is a vertical flex layout. The VAT region is removed and the receipt upload area is anchored at the lower section of that column. Browser capture is required to validate final vertical rhythm with live data.

### Colors and visual tokens

Existing warehouse tokens are preserved: white/cool-gray surfaces, thin `#e5ece8` dividers and the established green receipt accent (`#07844d` / `#07965a`).

### Image quality and asset fidelity

The selected design has no new raster image asset in the redesigned receipt region. Existing Ant Design icons are retained.

### Copy and content

The displayed flow now contains only “Phiếu nhập kho” content. VAT wording has been removed from the modal and confirmation flow.

## Findings

- [P1] Browser-rendered modal capture is blocked.
  Location: local app at `http://127.0.0.1:4173/`.
  Evidence: the route shows the login screen before the Handling Units workspace can be opened.
  Impact: the modal cannot be compared against the selected visual at the matching live-data state.
  Fix: sign in to the local preview, open **Quản lý kiện hàng → Tạo kiện nhanh**, scan or select one test QR, then capture the modal.

## Implementation checklist

1. Sign in locally.
2. Open **Quản lý kiện hàng → Tạo kiện nhanh** and scan a valid QR label.
3. Confirm that VAT is absent, the receipt panel is full height, and the receipt upload still works.
4. Capture that state and rerun visual QA.

final result: blocked
