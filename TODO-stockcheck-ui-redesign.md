# UI Redesign — StockCheck.tsx (từ mã tham khảo)

> Mục tiêu: Thay toàn bộ phần JSX `return (...)` trong `StockCheck.tsx`
> bằng UI mới theo mã tham khảo, **giữ nguyên 100% logic/state phía trên**.

---

## 1. Phần GIỮ NGUYÊN — KHÔNG đụng vào

| Phần | Ghi chú |
|---|---|
| Tất cả `import` hiện tại | Giữ nguyên, chỉ bỏ import không dùng sau khi xong |
| Toàn bộ interfaces/types | `ConversionUnit`, `CheckItem`, `CheckSession`, `ProductGroup`, `StaffUser` |
| `loadSessions`, `saveSessions`, `isWeekend`, `expandToVariants`, `buildStockBySku` | Helpers, không đổi |
| Toàn bộ `useState` / `useRef` | Giữ nguyên |
| `fetchStaff`, `loadConversionRates`, `saveConversionRates` | Logic API |
| `addUnit`, `removeUnit`, `updateUnit` | Quy đổi đơn vị |
| `applyActualStock`, `updateCountingInput` | Logic tính tổng tồn |
| `handleDirectActualStock`, `handleUpdateNote`, `handleUpdateNotes` | Update session |
| `getBulkNoteTargets`, `openBulkNoteEditor`, `closeBulkNoteEditor`, `handleBulkNote` | Ghi chú hàng loạt |
| `getBalanceBlockReason`, `markBalancedItems`, `executeBalanceItems` | Logic cân bằng |
| `handleSingleBalance`, `handleGroupBalance`, `handleOverrideStaff` | Handlers |
| `checkedCount`, `totalCount`, `diffCount`, `balancedCount`, `progressPct` | Stats |
| `productGroups`, `maxUnitsCount` | useMemo |
| `renderDiff`, `renderCountInput`, `renderConversionPopover` | Render helpers (có thể giữ hoặc inline) |
| Object `S` (styles) | Giữ làm fallback, có thể xoá dần sau khi UI mới xong |

---

## 2. Phần THAY THẾ — Toàn bộ `return (...)` từ dòng 719 đến 1200

### 2a. Layout tổng thể

```
<div style={{ background: '#F8FAFC', minHeight: '100vh', padding: '0 0 80px 0' }}>
  {/* KHÔNG làm <nav> vì header đã có của app toàn cục */}

  <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 0' }}>
    {/* A. Toolbar & Tabs */}
    {/* B. Stats card */}
    {/* C. Danh sách nhóm (accordion) */}
    {/* D. Ghi chú phiên */}
    {/* E. Empty state */}
  </main>

  {/* F. Floating action bar (fixed bottom) */}
  {/* G. Modal đổi người phụ trách (giữ nguyên logic) */}
</div>
```

---

### 2b. A — Toolbar & Tabs

```tsx
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 24 }}>

  {/* Trái: Tab Kiểm ngày / Kiểm toàn bộ + Điều hướng ngày */}
  <div style={{ display:'flex', alignItems:'center', gap: 16 }}>

    {/* Tab toggle */}
    <div style={{ display:'flex', gap: 4, background:'#fff', padding: 4, borderRadius: 12, border:'1px solid #e2e8f0' }}>
      <button onClick={() => setActiveTab('daily')}
        style={{ padding:'8px 20px', borderRadius: 8, fontWeight:700, fontSize:13,
          background: activeTab==='daily' ? '#10b981' : 'transparent',
          color: activeTab==='daily' ? '#fff' : '#64748b', border:'none', cursor:'pointer' }}>
        Kiểm hàng ngày
      </button>
      <button onClick={() => setActiveTab('full')}
        style={{ padding:'8px 20px', borderRadius: 8, fontWeight:700, fontSize:13,
          background: activeTab==='full' ? '#10b981' : 'transparent',
          color: activeTab==='full' ? '#fff' : '#64748b', border:'none', cursor:'pointer' }}>
        Kiểm toàn bộ
      </button>
    </div>

    {/* Điều hướng ngày */}
    <div style={{ display:'flex', alignItems:'center', gap: 8, background:'#fff',
      border:'1px solid #e2e8f0', borderRadius: 12, padding:'8px 16px', fontSize:13 }}>
      <Button type="text" size="small" onClick={() => setCurrentDate(d => d.subtract(1,'day'))}>‹</Button>
      {/* icon Calendar màu #10b981 */}
      <span style={{ fontWeight:600 }}>{currentDate.format('ddd DD/MM/YYYY')}</span>
      <Button type="text" size="small" onClick={() => setCurrentDate(d => d.add(1,'day'))}>›</Button>
      {!currentDate.isSame(dayjs(),'day') && (
        <Button type="link" size="small" onClick={() => setCurrentDate(dayjs())}>Hôm nay</Button>
      )}
    </div>

    {weekend && <Tag color="orange">📅 Cuối tuần — toàn bộ SP</Tag>}
  </div>

  {/* Phải: Badge người phụ trách */}
  <div style={{ display:'flex', alignItems:'center', gap: 12,
    background:'#0f172a', borderRadius: 12, padding:'8px 16px' }}>
    {/* Avatar chữ cái đầu, màu #10b981 */}
    <span style={{ width:28, height:28, borderRadius:'50%', background:'#10b981',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:800, fontSize:12, color:'#fff' }}>
      {(todaySession?.assignedName || fixedAssignee.username).charAt(0).toUpperCase()}
    </span>
    <span style={{ fontWeight:700, color:'#fff', fontSize:13 }}>
      {todaySession?.assignedName || fixedAssignee.username}
    </span>
    <span style={{ fontSize:10, background:'rgba(255,255,255,0.15)',
      padding:'2px 6px', borderRadius: 4, color:'rgba(255,255,255,0.7)',
      fontWeight:700, letterSpacing:1 }}>phụ trách</span>
    {canManage && todaySession && (
      <Button size="small" type="link" style={{ color:'#34d399', fontSize:12, padding:0 }}
        onClick={() => { setSelectedStaffUsername(todaySession.assignedTo); setStaffModalOpen(true); }}>
        Đổi người
      </Button>
    )}
    {canManage && !todaySession && (
      <Button size="small" onClick={handleGenerate}>Tạo phiên</Button>
    )}
  </div>
</div>
```

> **Lưu ý**: Cần thêm state `activeTab` nếu chưa có:
> ```ts
> const [activeTab, setActiveTab] = useState<'daily' | 'full'>('daily');
> ```
> Hiện file chưa có state này. Khi `activeTab === 'full'` thì `handleGenerate` phải dùng toàn bộ sản phẩm (bỏ `.slice(0, DAILY_COUNT)`).

---

### 2c. B — Stats card

```tsx
{todaySession && (
  <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius: 16,
    padding: 24, marginBottom: 24, boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
    <div style={{ display:'flex', alignItems:'center', gap: 48 }}>

      {/* 4 số liệu */}
      <StatBox label="Tổng"        value={totalCount}    color="#f97316" />
      <StatBox label="Đã kiểm"     value={checkedCount}  color="#10b981" />
      <StatBox label="Chênh lệch"  value={diffCount}     color="#ef4444" />
      <StatBox label="Đã cân bằng" value={balancedCount} color="#3b82f6" />

      {/* Tiến độ */}
      <div style={{ flex: 1, marginLeft: 32 }}>
        <div style={{ display:'flex', justifyContent:'space-between',
          fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase',
          letterSpacing: 1, marginBottom: 6 }}>
          <span>Tiến độ kiểm kho</span>
          <span>{progressPct}% — {checkedCount}/{totalCount} dòng</span>
        </div>
        <div style={{ height: 8, background:'#f1f5f9', borderRadius: 999, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${progressPct}%`,
            background: progressPct === 100 ? '#10b981' : '#f97316',
            borderRadius: 999, transition:'width 0.6s' }} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 6, marginTop: 6 }}>
          <div style={{ width: 8, height: 8, background:'#3b82f6', borderRadius:'50%' }} />
          <span style={{ fontSize:12, fontWeight:700, color:'#3b82f6', textTransform:'uppercase', letterSpacing: 1 }}>
            {progressPct === 100 ? 'Hoàn tất' : 'Đang kiểm'}
          </span>
        </div>
      </div>
    </div>
  </div>
)}
```

**Component `StatBox`** (đặt ngoài component chính):
```tsx
const StatBox = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div style={{ display:'flex', flexDirection:'column', gap: 4 }}>
    <span style={{ fontSize:11, fontWeight:700, color:'#94a3b8',
      textTransform:'uppercase', letterSpacing: 1 }}>{label}</span>
    <span style={{ fontSize:36, fontWeight:900, color, lineHeight:1 }}>{value}</span>
  </div>
);
```

---

### 2d. C — Danh sách nhóm sản phẩm (accordion)

**Header của mỗi nhóm** — thay thế `S.sectionHeader`:

```tsx
<div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
  padding:'12px 16px', cursor:'pointer', background: isProductExpanded ? '#f8faff' : '#fff' }}
  onClick={() => toggleProductGroup(group.productName)}>

  {/* Trái */}
  <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
    {/* Chevron */}
    {isProductExpanded ? <DownOutlined /> : <RightOutlined />}

    {/* Icon nhóm */}
    <div style={{ background:'#fff7ed', color:'#ea580c', padding: 8, borderRadius: 8 }}>
      {/* LayoutGrid icon hoặc dùng emoji 📦 */}
      📦
    </div>

    {/* Tên + số lượng */}
    <span style={{ fontWeight:700, fontSize:14, color:'#334155' }}>{group.productName}</span>
    <span style={{ fontSize:12, color:'#94a3b8' }}>{groupCheckedCount}/{group.items.length} đã kiểm</span>
    {groupDiffCount > 0 && <Tag color="red">{groupDiffCount} chênh</Tag>}

    {/* Nút quy đổi đơn vị — giữ logic toggle expandedConvGroups */}
    <button onClick={e => { e.stopPropagation(); toggleConvGroup(group.productName); }}
      style={{ display:'flex', alignItems:'center', gap: 4, fontSize:11, fontWeight:700,
        background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius: 8,
        padding:'4px 10px', cursor:'pointer', color:'#64748b' }}>
      ⚙️ Quy đổi đơn vị
    </button>
  </div>

  {/* Phải */}
  <div style={{ display:'flex', alignItems:'center', gap: 16 }}>
    <span style={{ fontSize:12, color:'#cbd5e1', fontWeight:700 }}>
      {groupBalancedCount}/{group.items.length} đã cân
    </span>
    {/* Nút "Cân bằng tất cả" nhóm — giữ nguyên logic handleGroupBalance */}
    <Tooltip title={bulkTooltip}>
      <Button size="small" loading={bulkBalancing[group.productName]}
        disabled={!canBulkBalance}
        onClick={e => { e.stopPropagation(); handleGroupBalance(group); }}
        style={{ background: canBulkBalance ? '#faad14' : undefined,
          borderColor: canBulkBalance ? '#faad14' : undefined,
          color: canBulkBalance ? '#fff' : undefined, fontWeight:700, fontSize:12 }}>
        Cân bằng tất cả
      </Button>
    </Tooltip>
  </div>
</div>
```

**Config bar quy đổi** — giữ nguyên JSX hiện tại (dòng 880-913), chỉ điều chỉnh màu nền:
- Nền `#fffbe6` → giữ hoặc đổi sang `#f0fdf4`

**Bảng items** — giữ nguyên cấu trúc bảng hiện tại, chỉ đổi màu:
- `background: '#f0f7ff'` ở `<thead>` → `#f8fafc`
- Màu text header `#1677ff` → `#64748b`
- `background: '#f6ffed'` (balanced row) → giữ nguyên

---

### 2e. D — Ghi chú phiên

```tsx
<div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius: 16,
  padding: 24, marginTop: 24, boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
  <div style={{ display:'flex', alignItems:'center', gap: 8, marginBottom: 16 }}>
    {/* icon ClipboardCheck hoặc emoji */}
    📋
    <span style={{ fontWeight:700, fontSize:12, color:'#334155',
      textTransform:'uppercase', letterSpacing: 1 }}>Ghi chú phiên kiểm</span>
  </div>
  <TextArea
    value={todaySession.notes}
    onChange={e => handleUpdateNotes(e.target.value)}
    placeholder="Nhập ghi chú chung cho phiên làm việc này..."
    rows={4}
    style={{ background:'#f8fafc', borderRadius: 12, fontSize:13 }}
  />
</div>
```

---

### 2f. E — Empty state

```tsx
{!todaySession && (
  <div style={{ textAlign:'center', padding:'80px 0', color:'#94a3b8' }}>
    <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
    <div style={{ fontSize:16, fontWeight:600, marginBottom: 8 }}>Chưa có phiên kiểm cho ngày này</div>
    <div style={{ fontSize:13, marginBottom: 24 }}>
      {weekend ? 'Hôm nay là cuối tuần — sẽ kiểm toàn bộ sản phẩm.' : `Sẽ chọn ngẫu nhiên ${DAILY_COUNT} sản phẩm.`}
    </div>
    {canManage && (
      <Button type="primary" size="large" onClick={handleGenerate}
        style={{ background:'#10b981', borderColor:'#10b981', borderRadius: 12,
          fontWeight:700, height: 44, padding:'0 32px' }}>
        Tạo phiên kiểm
      </Button>
    )}
  </div>
)}
```

---

### 2g. F — Floating Action Bar (fixed bottom)

```tsx
<div style={{ position:'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
  background:'rgba(255,255,255,0.85)', backdropFilter:'blur(8px)',
  borderTop:'1px solid #e2e8f0', padding:'12px 24px',
  display:'flex', justifyContent:'center' }}>
  <div style={{ display:'flex', gap: 12, width:'100%', maxWidth: 900 }}>
    <Button style={{ flex: 1, height: 48, borderRadius: 16, fontWeight:700, fontSize:13 }}
      onClick={() => message.info('Đã lưu bản nháp')}>
      Lưu bản nháp
    </Button>
    <Button type="primary"
      style={{ flex: 2, height: 48, borderRadius: 16, fontWeight:900, fontSize:14,
        background:'#059669', borderColor:'#059669',
        boxShadow:'0 4px 14px rgba(16,185,129,0.3)', letterSpacing: 1 }}
      onClick={handleComplete}>
      Hoàn tất &amp; Chốt kho
    </Button>
  </div>
</div>
```

> Cần thêm hàm `handleComplete`:
> ```ts
> const handleComplete = () => {
>   if (!todaySession) return;
>   const unchecked = todaySession.items.filter(it => it.actualStock === null).length;
>   if (unchecked > 0) {
>     message.warning(`Còn ${unchecked} dòng chưa nhập tồn thực tế.`);
>     return;
>   }
>   persistSessions(sessions.map(s =>
>     s.date === todayStr ? { ...s, status: 'completed', completedAt: dayjs().toISOString() } : s
>   ));
>   message.success('✅ Đã chốt phiên kiểm kho!');
> };
> ```

---

### 2h. G — Modal đổi người phụ trách

Giữ nguyên từ dòng 1188-1197, chỉ đổi style cho phù hợp:
```tsx
<Modal title="Đổi người phụ trách" open={staffModalOpen}
  onOk={handleOverrideStaff} onCancel={() => setStaffModalOpen(false)}
  okText="Lưu" cancelText="Hủy" width={360}>
  <Select showSearch value={selectedStaffUsername}
    onChange={setSelectedStaffUsername} style={{ width:'100%' }}
    options={staffList
      .filter(s => (s.role === 'admin' || s.role === 'manager') && s.username !== 'admin')
      .map(s => ({ value: s.username, label: s.username }))} />
</Modal>
```

---

## 3. Thêm mới (state & logic)

| Thêm | Ghi chú |
|---|---|
| `const [activeTab, setActiveTab] = useState<'daily' \| 'full'>('daily');` | Chuyển tab Ngày/Toàn bộ |
| Logic trong `handleGenerate`: nếu `activeTab === 'full'` thì dùng toàn bộ `contextProducts`, không random | Đã có điều kiện `weekend` tương tự |
| `const handleComplete = () => {...}` | Chốt phiên, đổi `status: 'completed'` |
| `const StatBox = (...)` | Đặt ngoài component (cuối file) |

---

## 4. Kiểm tra sau khi xong

- [ ] Tab "Kiểm ngày" chỉ pick 5 SP, tab "Toàn bộ" lấy tất cả
- [ ] Người phụ trách hiện đúng, nút Đổi người hoạt động
- [ ] Stats (Tổng/Đã kiểm/Chênh/Cân bằng) cập nhật real-time
- [ ] Progress bar chạy đúng theo `checkedCount/totalCount`
- [ ] Accordion expand/collapse từng nhóm SP
- [ ] Quy đổi đơn vị toggle + save đúng
- [ ] Cột Tồn HT hiện `***` với non-admin
- [ ] Nút "Cân bằng" từng dòng và "Cân bằng tất cả" nhóm hoạt động
- [ ] Ghi chú phiên lưu đúng vào session
- [ ] Nút "Hoàn tất & Chốt kho" cập nhật `status: 'completed'`
- [ ] Floating action bar không che khuất bảng (có `paddingBottom: 80px` trên wrapper)
