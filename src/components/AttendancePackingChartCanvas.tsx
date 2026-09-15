import { PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts';

type PackingChartEntry = {
    name: string;
    value: number;
    units: number;
    income: number;
};

type Props = {
    chartData: PackingChartEntry[];
    chartTotalOrders: number;
    formatCurrency: (value: number) => string;
    colors: string[];
};

export default function AttendancePackingChartCanvas({ chartData, chartTotalOrders, formatCurrency, colors }: Props) {
    return (
        <>
            <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                    <Pie data={chartData} cx="50%" cy="50%" innerRadius={58} outerRadius={90} paddingAngle={3} dataKey="value">
                        {chartData.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
                    </Pie>
                    <ReTooltip
                        formatter={(value: any, name: any, props: any) => [
                            <span key="tooltip"><b>{value} đơn</b> · {props.payload.units} SP — {formatCurrency(props.payload.income)}</span>, name,
                        ]}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 4 }}>
                {chartData.map((entry, index) => {
                    const color = colors[index % colors.length];
                    const pct = chartTotalOrders > 0 ? Math.round(entry.value / chartTotalOrders * 100) : 0;
                    return (
                        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: '#595959', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color }}>{entry.value} đơn</span>
                            <span style={{ fontSize: 11, color: '#aaa', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
