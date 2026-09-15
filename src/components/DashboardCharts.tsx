import { lazy, Suspense } from 'react';

const DashboardChartsCanvas = lazy(() => import('./DashboardChartsCanvas'));

type RevenuePoint = { date: string; revenue: number };
type SalesChannel = { name: string; value: number; color: string };

export function DashboardRevenueChart({ data }: { data: RevenuePoint[] }) {
    return (
        <Suspense fallback={<ChartFallback />}>
            <DashboardChartsCanvas kind="revenue" data={data} />
        </Suspense>
    );
}

export function DashboardChannelChart({ data }: { data: SalesChannel[] }) {
    return (
        <Suspense fallback={<ChartFallback />}>
            <DashboardChartsCanvas kind="channels" data={data} />
        </Suspense>
    );
}

function ChartFallback() {
    return <div style={{ width: '100%', height: '100%', minHeight: 160, display: 'grid', placeItems: 'center', color: '#89978f', fontSize: 12 }}>Đang tải biểu đồ...</div>;
}
