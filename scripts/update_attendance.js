const fs = require('fs');
const file = 'g:\\QUAN LY BAN HANG\\desktop-FIXDEBUG\\src\\pages\\Attendance.tsx';
let content = fs.readFileSync(file, 'utf8');

const replaceStr = (oldStr, newStr) => {
    let search = oldStr;
    if (content.indexOf(search) === -1) {
        search = oldStr.replace(/\n/g, '\r\n');
    }
    if (content.indexOf(search) === -1) {
        search = oldStr.replace(/\r\n/g, '\n');
    }
    
    if (content.indexOf(search) !== -1) {
        content = content.replace(search, newStr);
        console.log("Replaced successfully.");
    } else {
        console.log("Could not find string.");
    }
};

const oldRangeLabel = `                            if (s.isSame(s.startOf('month'), 'day') && e.isSame(s.endOf('month'), 'day')) return \`Tháng \${s.format('MM/YYYY')}\`;`;
const newRangeLabel = `                            if (s.isSame(s.startOf('month'), 'day') && e.isSame(s.endOf('month'), 'day')) {
                                if (s.isSame(now.startOf('month'), 'day')) return 'Tháng này';
                                if (s.isSame(now.subtract(1, 'month').startOf('month'), 'day')) return 'Tháng trước';
                                return \`Tháng \${s.format('MM/YYYY')}\`;
                            }`;
replaceStr(oldRangeLabel, newRangeLabel);

const oldPresets = `                                        {[
                                            { label: 'Hôm nay', fn: () => setRange(now.startOf('day'), now.endOf('day')) },
                                            { label: 'Hôm qua', fn: () => setRange(now.subtract(1, 'day').startOf('day'), now.subtract(1, 'day').endOf('day')) },
                                            { label: 'Trong 7 ngày qua', fn: () => setRange(now.subtract(6, 'day').startOf('day'), now.endOf('day')) },
                                            { label: 'Trong 30 ngày qua', fn: () => setRange(now.subtract(29, 'day').startOf('day'), now.endOf('day')) },
                                        ].map(opt => (`;
const newPresets = `                                        {[
                                            { label: 'Tháng này', fn: () => setRange(now.startOf('month'), now.endOf('month')) },
                                            { label: 'Tháng trước', fn: () => setRange(now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')) },
                                            { label: 'Hôm nay', fn: () => setRange(now.startOf('day'), now.endOf('day')) },
                                            { label: 'Hôm qua', fn: () => setRange(now.subtract(1, 'day').startOf('day'), now.subtract(1, 'day').endOf('day')) },
                                            { label: 'Trong 7 ngày qua', fn: () => setRange(now.subtract(6, 'day').startOf('day'), now.endOf('day')) },
                                            { label: 'Trong 30 ngày qua', fn: () => setRange(now.subtract(29, 'day').startOf('day'), now.endOf('day')) },
                                        ].map(opt => (`;
replaceStr(oldPresets, newPresets);

const oldPickers = `                                        <div style={{ height: 1, background: '#f0f0f0', margin: '6px 0' }} />
                                        {/* Theo ngày */}
                                        <div style={{ padding: '4px 16px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo ngày</div>
                                            <DatePicker
                                                size="small"
                                                format="DD/MM/YYYY"
                                                placeholder="Chọn ngày..."
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('day'), d.endOf('day')); }}
                                            />
                                        </div>
                                        {/* Theo tháng */}
                                        <div style={{ padding: '4px 16px', paddingBottom: 8 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo tháng</div>
                                            <DatePicker
                                                picker="month"
                                                size="small"
                                                format="MM/YYYY"
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('month'), d.endOf('month')); }}
                                            />
                                        </div>
                                        <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />`;

const newPickers = `                                        <div style={{ height: 1, background: '#f0f0f0', margin: '6px 0' }} />
                                        {/* Theo tháng */}
                                        <div style={{ padding: '4px 16px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo tháng</div>
                                            <DatePicker
                                                picker="month"
                                                size="small"
                                                format="MM/YYYY"
                                                placeholder="Chọn tháng..."
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('month'), d.endOf('month')); }}
                                            />
                                        </div>
                                        <div style={{ height: 1, background: '#f0f0f0', margin: '6px 0' }} />
                                        {/* Theo ngày */}
                                        <div style={{ padding: '4px 16px' }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#8c8c8c', marginBottom: 4, textTransform: 'uppercase' }}>Theo ngày</div>
                                            <DatePicker
                                                size="small"
                                                format="DD/MM/YYYY"
                                                placeholder="Chọn ngày..."
                                                style={{ width: '100%' }}
                                                onChange={d => { if (d) setRange(d.startOf('day'), d.endOf('day')); }}
                                            />
                                        </div>
                                        <div style={{ height: 1, background: '#f0f0f0', margin: '6px 0' }} />`;

replaceStr(oldPickers, newPickers);

fs.writeFileSync(file, content);
console.log('Update success');
