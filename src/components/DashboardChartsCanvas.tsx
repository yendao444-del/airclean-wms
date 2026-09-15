import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type RevenuePoint = { date: string; revenue: number };
type SalesChannel = { name: string; value: number; color: string };
type Props = { kind: 'revenue'; data: RevenuePoint[] } | { kind: 'channels'; data: SalesChannel[] };

const money = (value: number) => value.toLocaleString('vi-VN');

export default function DashboardChartsCanvas(props: Props) {
    if (props.kind === 'channels') {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie data={props.data} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={3} stroke="none">
                        {props.data.map(channel => <Cell key={channel.name} fill={channel.color} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${money(value)}đ`} />
                </PieChart>
            </ResponsiveContainer>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={props.data} margin={{ top: 20, right: 4, left: -20, bottom: 0 }}>
                <defs>
                    <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#00ab56" stopOpacity={0.25} />
                        <stop offset="1" stopColor="#00ab56" stopOpacity={0.01} />
                    </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e5eee8" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#718079', fontSize: 11 }} />
                <YAxis tickFormatter={value => `${value / 1000000}tr`} tickLine={false} axisLine={false} tick={{ fill: '#718079', fontSize: 11 }} />
                <Tooltip formatter={(value: number) => [`${money(value)}đ`, 'Doanh thu']} contentStyle={{ border: '1px solid #dce9e1', borderRadius: 10 }} />
                <Area type="monotone" dataKey="revenue" stroke="#00ab56" strokeWidth={3} fill="url(#revenueFill)" activeDot={{ r: 5, fill: '#00ab56', stroke: '#fff', strokeWidth: 3 }} />
            </AreaChart>
        </ResponsiveContainer>
    );
}
