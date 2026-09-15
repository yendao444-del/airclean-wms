import { lazy, Suspense } from 'react';

const PackingChartCanvas = lazy(() => import('./AttendancePackingChartCanvas'));

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

export default function AttendancePackingChart(props: Props) {
    if (!props.chartData.length) {
        return (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d9d9d9', fontSize: 13 }}>
                Chưa có dữ liệu
            </div>
        );
    }

    return (
        <Suspense fallback={<div style={{ height: 200, display: 'grid', placeItems: 'center', color: '#999', fontSize: 12 }}>Đang tải biểu đồ...</div>}>
            <PackingChartCanvas {...props} />
        </Suspense>
    );
}
