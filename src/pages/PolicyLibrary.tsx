import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Empty, Input, Spin } from 'antd';
import {
    BarcodeOutlined,
    CalendarOutlined,
    CameraOutlined,
    CheckCircleFilled,
    ClockCircleOutlined,
    CloudUploadOutlined,
    CodeSandboxOutlined,
    FieldTimeOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    GiftOutlined,
    InboxOutlined,
    ReloadOutlined,
    SearchOutlined,
    StockOutlined,
    TrophyOutlined,
    WarningFilled,
} from '@ant-design/icons';
import policyPackingHero from '../assets/packing/policy-packing-hero.png';
import latePolicyHero from '../assets/policies/late-policy-hero.png';
import latePolicyMild from '../assets/policies/late-policy-mild.png';
import latePolicyMedium from '../assets/policies/late-policy-medium.png';
import latePolicySevere from '../assets/policies/late-policy-severe.png';
import weeklyRewardHero from '../assets/policies/weekly-reward-hero.png';
import overtimeRewardHero from '../assets/policies/overtime-reward-hero.png';
import wrongOrderFineHero from '../assets/policies/wrong-order-fine-hero.png';
import vatInvoiceLateHero from '../assets/policies/vat-invoice-late-hero.png';
import returnOverdueHero from '../assets/policies/return-overdue-hero.png';
import refundOverdueHero from '../assets/policies/refund-overdue-hero.png';
import taskDeadlineFineHero from '../assets/policies/task-deadline-fine-hero.png';
import taskEvidenceFineHero from '../assets/policies/task-evidence-fine-hero.png';
import stockCheckMissingHero from '../assets/policies/stock-check-missing-hero.png';

interface PackingLevel {
    key: string;
    label: string;
    unit: string;
    rate: number;
}

interface PackingVersion {
    effectiveAt: string;
    rates?: Record<string, number>;
    updatedBy?: string;
}

interface PolicyConfig {
    wrongOrderFineOfficial: number;
    wrongOrderFineSeasonal: number;
    packingCommission: {
        rates: Record<string, number>;
        skuLevels: Record<string, string>;
        customLevels: Array<{ key: string; label: string; unit: string }>;
        history: PackingVersion[];
        updatedAt?: string;
        updatedBy?: string;
    };
}

interface PolicyMechanisms {
    attendanceLateFine: {
        graceMinutes: number;
        official: number[];
        seasonal: number[];
        morningStart: string;
        afternoonStart: string;
    };
    attendanceReward: {
        enabled: boolean;
        badgeStreakDays: number;
        waiverStreakDays: number;
        waiverLateMaxMinutes: number;
        waiverMaxPerPeriod: number;
        monthlyRequiredDays: number;
        standardWorkDays: number;
        monthlyRewardAmount: number;
        graceMinutes: number;
    };
    overtimeReward: { firstHourRate: number; nextHourRate: number };
    vatInvoiceFine: { firstFineAfterDays: number; firstAmount: number; stageIncrement: number; effectiveAt: string; excludesSunday: boolean };
    returnOverdueFine: { firstFineAfterDays: number; firstAmount: number; dailyIncrement: number; effectiveAt: string; excludesRestDays: boolean };
    refundOverdueFine: { firstFineAfterDays: number; firstAmount: number; dailyIncrement: number; effectiveAt: string; excludesRestDays: boolean };
    taskDeadlineFine: { defaultAmount: number; configurablePerTask: boolean; splitBetweenRecipients: boolean };
    taskEvidenceFine: { defaultAmount: number; configurablePerTask: boolean; escalatesByCycle: boolean };
    stockCheckMissingFine: { enabled: boolean; amount: number; effectiveAt: string; excludesRestDays: boolean };
}

interface PolicySnapshot {
    config: PolicyConfig;
    packingWeeklyReward: { amount: number; effectiveAt: string };
    legacyPackingCommission: { unitPrice: number; endsAt: string };
    mechanisms: PolicyMechanisms;
}

type PolicyKey =
    | 'packingCommission'
    | 'packingWeeklyReward'
    | 'overtimeReward'
    | 'attendanceReward'
    | 'attendanceLateFine'
    | 'wrongOrderFine'
    | 'vatInvoiceFine'
    | 'returnOverdueFine'
    | 'refundOverdueFine'
    | 'taskDeadlineFine'
    | 'taskEvidenceFine'
    | 'stockCheckMissingFine';

interface PolicyNavItem {
    key: PolicyKey;
    label: string;
    hint: string;
    icon: ReactNode;
    category: 'reward' | 'fine';
}

const defaultConfig: PolicyConfig = {
    wrongOrderFineOfficial: 30000,
    wrongOrderFineSeasonal: 15000,
    packingCommission: {
        rates: { easy: 20, medium: 30, high: 40 },
        skuLevels: {},
        customLevels: [],
        history: [],
    },
};

const defaultMechanisms: PolicyMechanisms = {
    attendanceLateFine: {
        graceMinutes: 5,
        official: [30000, 70000, 150000],
        seasonal: [10000, 30000, 60000],
        morningStart: '08:00',
        afternoonStart: '13:30',
    },
    attendanceReward: {
        enabled: true,
        badgeStreakDays: 3,
        waiverStreakDays: 7,
        waiverLateMaxMinutes: 15,
        waiverMaxPerPeriod: 1,
        monthlyRequiredDays: 24,
        standardWorkDays: 26,
        monthlyRewardAmount: 200000,
        graceMinutes: 5,
    },
    overtimeReward: { firstHourRate: 30000, nextHourRate: 40000 },
    vatInvoiceFine: { firstFineAfterDays: 5, firstAmount: 30000, stageIncrement: 10000, effectiveAt: '2026-08-11', excludesSunday: true },
    returnOverdueFine: { firstFineAfterDays: 10, firstAmount: 30000, dailyIncrement: 10000, effectiveAt: '2026-09-04', excludesRestDays: true },
    refundOverdueFine: { firstFineAfterDays: 8, firstAmount: 30000, dailyIncrement: 10000, effectiveAt: '2026-09-04', excludesRestDays: true },
    taskDeadlineFine: { defaultAmount: 50000, configurablePerTask: true, splitBetweenRecipients: true },
    taskEvidenceFine: { defaultAmount: 30000, configurablePerTask: true, escalatesByCycle: true },
    stockCheckMissingFine: { enabled: true, amount: 50000, effectiveAt: '2026-05-06', excludesRestDays: true },
};

const defaultSnapshot: PolicySnapshot = {
    config: defaultConfig,
    packingWeeklyReward: { amount: 100000, effectiveAt: '2026-08-31' },
    legacyPackingCommission: { unitPrice: 20, endsAt: '2026-09-01' },
    mechanisms: defaultMechanisms,
};

const money = (value: number) => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')}đ`;
const shortDate = (value?: string) => value && !Number.isNaN(new Date(value).getTime())
    ? new Intl.DateTimeFormat('vi-VN').format(new Date(value))
    : 'Chưa cập nhật';

const normalizeConfig = (source?: Partial<PolicyConfig> | null): PolicyConfig => {
    const packing = source?.packingCommission || defaultConfig.packingCommission;
    return {
        ...defaultConfig,
        ...source,
        packingCommission: {
            rates: { ...defaultConfig.packingCommission.rates, ...(packing.rates || {}) },
            skuLevels: packing.skuLevels || {},
            customLevels: Array.isArray(packing.customLevels) ? packing.customLevels : [],
            history: Array.isArray(packing.history) ? packing.history : [],
            updatedAt: packing.updatedAt,
            updatedBy: packing.updatedBy,
        },
    };
};

interface FineStepGuide {
    stepNumber: string;
    tag: string;
    mock: ReactNode;
    title: string;
    description: ReactNode;
}

interface FineLandingDetailProps {
    backgroundImage: string;
    badgeText?: string;
    title: string;
    amount: string;
    amountUnit: string;
    subtitle: string;
    hint: string;
    effectiveAtLabel?: string;
    effectiveAtValue: string;
    effectiveAtNote?: string;
    fineAmountLabel?: string;
    fineAmountValue: string;
    fineAmountNote?: string;
    exclusionLabel?: string;
    exclusionValue: string;
    exclusionNote?: string;
    noteText: string;
    guideTip?: ReactNode;
    guideTitle: string;
    steps: FineStepGuide[];
}

function FineLandingDetail({
    backgroundImage,
    badgeText = 'Cơ chế chế tài đang áp dụng',
    title,
    amount,
    amountUnit,
    subtitle,
    hint,
    effectiveAtLabel = 'NGÀY HIỆU LỰC',
    effectiveAtValue,
    effectiveAtNote = 'Thời điểm bắt đầu áp dụng',
    fineAmountLabel = 'SỐ TIỀN PHẠT',
    fineAmountValue,
    fineAmountNote,
    exclusionLabel = 'NGÀY ĐƯỢC LOẠI TRỪ',
    exclusionValue,
    exclusionNote,
    noteText,
    guideTip,
    guideTitle,
    steps,
}: FineLandingDetailProps) {
    return (
        <div className="stock-check-landing">
            <section
                className="stock-check-hero"
                style={{ backgroundImage: `url(${backgroundImage})` }}
            >
                <div className="stock-check-hero__copy">
                    <span className="stock-check-hero__badge">
                        <WarningFilled /> {badgeText}
                    </span>
                    <h2>{title}</h2>
                    <strong className="stock-check-hero__amount">
                        {amount}
                        <small>{amountUnit}</small>
                    </strong>
                    <p>{subtitle}</p>
                    <small className="stock-check-hero__hint">
                        {hint}
                    </small>
                </div>
            </section>

            <section className="stock-check-content">
                <header className="stock-check-section-heading">
                    <div>
                        <small>THÔNG SỐ CHÍNH SÁCH</small>
                        <h3>Quy chuẩn áp dụng thực tế</h3>
                    </div>
                    <span>Cấu hình hiện hành</span>
                </header>

                <div className="stock-check-cards">
                    <article className="stock-check-card tone-blue">
                        <span className="stock-check-card__icon">
                            <CalendarOutlined />
                        </span>
                        <div>
                            <small>{effectiveAtLabel}</small>
                            <strong>{effectiveAtValue}</strong>
                            <em>{effectiveAtNote}</em>
                        </div>
                    </article>

                    <article className="stock-check-card tone-red">
                        <span className="stock-check-card__icon">
                            <WarningFilled />
                        </span>
                        <div>
                            <small>{fineAmountLabel}</small>
                            <strong>{fineAmountValue}</strong>
                            <em>{fineAmountNote}</em>
                        </div>
                    </article>

                    <article className="stock-check-card tone-green">
                        <span className="stock-check-card__icon">
                            <CheckCircleFilled />
                        </span>
                        <div>
                            <small>{exclusionLabel}</small>
                            <strong>{exclusionValue}</strong>
                            <em>{exclusionNote}</em>
                        </div>
                    </article>
                </div>

                <div className="stock-check-note">
                    <CheckCircleFilled />
                    <span>{noteText}</span>
                </div>

                {/* 3. Illustrated Step-by-Step Guide */}
                <section className="stock-check-guide">
                    <header className="stock-check-section-heading">
                        <div>
                            <small>HƯỚNG DẪN THỰC HIỆN</small>
                            <h3>{guideTitle}</h3>
                        </div>
                        {guideTip && (
                            <span className="stock-check-guide__tip">
                                {guideTip}
                            </span>
                        )}
                    </header>

                    <div className="stock-check-steps">
                        {steps.map(step => (
                            <div key={step.stepNumber} className="stock-check-step">
                                <div className="stock-check-step__header">
                                    <span className="stock-check-step__number">{step.stepNumber}</span>
                                    <span className="stock-check-step__tag">{step.tag}</span>
                                </div>
                                <div className="stock-check-step__mock">
                                    {step.mock}
                                </div>
                                <h4>{step.title}</h4>
                                <p>{step.description}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </section>
        </div>
    );
}

interface RewardLandingCard {
    label: string;
    value: string;
    note?: string;
    icon: ReactNode;
    tone?: 'mint' | 'amber' | 'blue' | 'soft';
}

function RewardLandingDetail({
    backgroundImage,
    theme = 'light',
    title,
    headline,
    description,
    audience,
    effectiveAt,
    updatedAt,
    updatedBy,
    cards,
    sectionEyebrow,
    sectionTitle,
    formulaTitle,
    formula,
    formulaNote,
    footerNote,
}: {
    backgroundImage: string;
    theme?: 'light' | 'night';
    title: string;
    headline: string;
    description: string;
    audience: string;
    effectiveAt?: string;
    updatedAt?: string;
    updatedBy?: string;
    cards: RewardLandingCard[];
    sectionEyebrow: string;
    sectionTitle: string;
    formulaTitle: string;
    formula: string;
    formulaNote: string;
    footerNote?: string;
}) {
    const date = effectiveAt || updatedAt;
    return <div className={`reward-policy-landing${theme === 'night' ? ' is-night' : ''}`} style={{ backgroundImage: `url(${backgroundImage})` }}>
        <section className="reward-policy-hero">
            <div className="reward-policy-hero__copy">
                <span><CheckCircleFilled /> Cơ chế đang áp dụng</span>
                <h2>{title}</h2>
                <strong>{headline}</strong>
                <p>{description}</p>
                <small>Áp dụng cho {audience.toLocaleLowerCase('vi-VN')}.</small>
            </div>
            <div className="reward-policy-hero__facts">
                <div><GiftOutlined /><span>Quyền lợi hiện hành<strong>{headline}</strong></span></div>
                <div><CheckCircleFilled /><span>Đối tượng áp dụng<strong>{audience}</strong></span></div>
                <div><CalendarOutlined /><span>{effectiveAt ? 'Hiệu lực từ' : 'Cập nhật gần nhất'}<strong>{date ? shortDate(date) : 'Theo cấu hình hiện tại'}</strong></span></div>
                <div><CodeSandboxOutlined /><span>Nguồn dữ liệu<strong>{updatedBy ? `Cập nhật bởi ${updatedBy}` : 'Cơ chế phần mềm hiện tại'}</strong></span></div>
            </div>
        </section>

        <section className="reward-policy-content">
            <header className="reward-policy-section-heading">
                <div><small>{sectionEyebrow}</small><h3>{sectionTitle}</h3></div>
                <span>Hiển thị theo cấu hình thực tế</span>
            </header>
            <div className={`reward-policy-cards count-${Math.min(cards.length, 4)}`}>
                {cards.map(card => <article key={card.label} className={`tone-${card.tone || 'mint'}`}>
                    <span className="reward-policy-card__icon">{card.icon}</span>
                    <div><small>{card.label}</small><strong>{card.value}</strong>{card.note && <em>{card.note}</em>}</div>
                </article>)}
            </div>
            <section className="reward-policy-formula">
                <div className="reward-policy-formula__icon"><CalendarOutlined /></div>
                <div><h3>{formulaTitle}</h3><strong>{formula}</strong><p>{formulaNote}</p></div>
            </section>
            {footerNote && <div className="policy-legacy-note"><WarningFilled /><span>{footerNote}</span></div>}
        </section>
    </div>;
}

export default function PolicyLibrary() {
    const [snapshot, setSnapshot] = useState<PolicySnapshot>(defaultSnapshot);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [activePolicy, setActivePolicy] = useState<PolicyKey>('packingCommission');
    const documentRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const result = await window.electronAPI?.policies?.getCurrent();
                if (!cancelled && result?.success) {
                    setSnapshot({
                        config: normalizeConfig(result.data?.config),
                        packingWeeklyReward: result.data?.packingWeeklyReward || defaultSnapshot.packingWeeklyReward,
                        legacyPackingCommission: result.data?.legacyPackingCommission || defaultSnapshot.legacyPackingCommission,
                        mechanisms: {
                            ...defaultMechanisms,
                            ...(result.data?.mechanisms || {}),
                            attendanceReward: {
                                ...defaultMechanisms.attendanceReward,
                                ...(result.data?.mechanisms?.attendanceReward || {}),
                            },
                        },
                    });
                    setError('');
                } else if (!cancelled && window.electronAPI?.policies) {
                    setError(result?.error || 'Không tải được chính sách hiện hành.');
                }
            } catch {
                if (!cancelled) setError('Không tải được chính sách hiện hành.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, []);

    const config = snapshot.config;
    const mechanisms = snapshot.mechanisms;
    const levels = useMemo<PackingLevel[]>(() => {
        const base = [
            { key: 'easy', label: 'Dễ', unit: 'gói' },
            { key: 'medium', label: 'Trung bình', unit: 'gói' },
            { key: 'high', label: 'Cao', unit: 'gói' },
        ];
        return [...base, ...config.packingCommission.customLevels]
            .map(level => ({ ...level, rate: Number(config.packingCommission.rates[level.key] || 0) }));
    }, [config.packingCommission]);

    const policies = useMemo<PolicyNavItem[]>(() => [
        { key: 'packingCommission', label: 'Hoa hồng đóng gói', hint: 'Theo cấp độ sản phẩm', icon: <CodeSandboxOutlined />, category: 'reward' },
        { key: 'packingWeeklyReward', label: 'Thưởng thắng tuần', hint: 'Hiệu suất đóng gói', icon: <TrophyOutlined />, category: 'reward' },
        { key: 'overtimeReward', label: 'Thưởng tăng ca', hint: 'Theo số giờ thực tế', icon: <FieldTimeOutlined />, category: 'reward' },
        { key: 'attendanceReward', label: 'Thưởng chuyên cần', hint: 'Đúng giờ và đủ ngày công', icon: <GiftOutlined />, category: 'reward' },
        { key: 'attendanceLateFine', label: 'Đi làm muộn', hint: 'Theo số phút và loại NV', icon: <ClockCircleOutlined />, category: 'fine' },
        { key: 'wrongOrderFine', label: 'Đóng gói sai đơn', hint: 'Hoàn hàng hoặc khiếu nại', icon: <WarningFilled />, category: 'fine' },
        { key: 'vatInvoiceFine', label: 'Nộp hóa đơn VAT muộn', hint: 'Tăng theo từng lần phạt', icon: <FileTextOutlined />, category: 'fine' },
        { key: 'returnOverdueFine', label: 'Trả hàng quá hạn', hint: 'Chưa hoàn thành xử lý', icon: <ReloadOutlined />, category: 'fine' },
        { key: 'refundOverdueFine', label: 'Hàng hoàn quá hạn', hint: 'Chưa nhận hàng hoàn', icon: <InboxOutlined />, category: 'fine' },
        { key: 'taskDeadlineFine', label: 'Trễ deadline bàn giao', hint: 'Mức phạt theo công việc', icon: <FileDoneOutlined />, category: 'fine' },
        { key: 'taskEvidenceFine', label: 'Vi phạm bằng chứng', hint: 'Thiếu hoặc bị từ chối', icon: <CameraOutlined />, category: 'fine' },
        ...(mechanisms.stockCheckMissingFine.enabled ? [{ key: 'stockCheckMissingFine' as PolicyKey, label: 'Thiếu kiểm hàng ngày', hint: 'Ngày làm việc chưa hoàn tất', icon: <StockOutlined />, category: 'fine' as const }] : []),
    ], [mechanisms.stockCheckMissingFine.enabled]);

    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN');
    const visiblePolicies = useMemo(
        () => policies.filter(policy => !normalizedQuery || `${policy.label} ${policy.hint}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery)),
        [normalizedQuery, policies],
    );
    const rewardPolicies = visiblePolicies.filter(policy => policy.category === 'reward');
    const finePolicies = visiblePolicies.filter(policy => policy.category === 'fine');

    useEffect(() => {
        if (visiblePolicies.some(policy => policy.key === activePolicy) || visiblePolicies.length === 0) return;
        setActivePolicy(visiblePolicies[0].key);
    }, [activePolicy, visiblePolicies]);

    useEffect(() => {
        documentRef.current?.scrollTo(0, 0);
    }, [activePolicy]);

    const navGroup = (label: string, category: 'reward' | 'fine', items: PolicyNavItem[]) => items.length > 0 && (
        <section className={`policy-category is-${category}`}>
            <header className="policy-category__header">{category === 'reward' ? <GiftOutlined /> : <WarningFilled />}<span>{label}</span><b>{items.length}</b></header>
            {items.map(policy => <button key={policy.key} className={`policy-entry${activePolicy === policy.key ? ' is-active' : ''}`} type="button" onClick={() => setActivePolicy(policy.key)}>{policy.icon}<span>{policy.label}<small>{policy.hint}</small></span></button>)}
        </section>
    );

    const late = mechanisms.attendanceLateFine;
    const attendanceReward = mechanisms.attendanceReward;
    const detail = (() => {
        if (activePolicy === 'packingCommission') return <RewardLandingDetail
            backgroundImage={policyPackingHero}
            title="Hoa hồng đóng gói"
            headline="Theo cấp độ sản phẩm"
            description="Đơn giá được hưởng theo cấp độ và số đơn vị đóng gói thực tế."
            audience="Nhân viên đóng gói"
            updatedAt={config.packingCommission.updatedAt}
            updatedBy={config.packingCommission.updatedBy || 'Quản trị viên'}
            cards={levels.map((level, index) => ({ label: level.label, value: `${money(level.rate)}/${level.unit}`, icon: <GiftOutlined />, tone: (['mint', 'amber', 'blue', 'soft'] as const)[index % 4] }))}
            sectionEyebrow="BẢNG ĐƠN GIÁ THEO CẤP ĐỘ"
            sectionTitle="Đóng gói đúng cấp, nhận đúng đơn giá"
            formulaTitle="Cách tính hoa hồng"
            formula="Tổng hoa hồng = Σ (Số đơn vị thực tế × Đơn giá cấp độ)"
            formulaNote="Tính theo cấu hình có hiệu lực tại thời điểm hoàn tất đơn."
            footerNote={`Kỳ lương trước ${shortDate(snapshot.legacyPackingCommission.endsAt)} giữ mức cũ ${money(snapshot.legacyPackingCommission.unitPrice)}/SKU.`}
        />;

        if (activePolicy === 'packingWeeklyReward') return <RewardLandingDetail
            backgroundImage={weeklyRewardHero}
            title="Thưởng thắng tuần"
            headline={money(snapshot.packingWeeklyReward.amount)}
            description="Khoản thưởng dành cho nhân viên đạt thành tích đóng gói cao nhất trong tuần."
            audience="Nhân viên đóng gói"
            effectiveAt={snapshot.packingWeeklyReward.effectiveAt}
            cards={[
                { label: 'Mức thưởng', value: money(snapshot.packingWeeklyReward.amount), note: '/ tuần thắng', icon: <TrophyOutlined />, tone: 'mint' },
                { label: 'Chu kỳ xét', value: 'Hàng tuần', note: 'Tổng hợp theo tuần', icon: <CalendarOutlined />, tone: 'blue' },
                { label: 'Cách ghi nhận', value: 'Top hiệu suất', note: 'Theo cơ chế hiện tại', icon: <CheckCircleFilled />, tone: 'amber' },
            ]}
            sectionEyebrow="CƠ CHẾ THƯỞNG HIỆU SUẤT"
            sectionTitle="Bứt tốc sản lượng, nhận thưởng mỗi tuần"
            formulaTitle="Cách ghi nhận thưởng"
            formula="Thưởng tuần = Kết quả cao nhất trong tuần"
            formulaNote="Hệ thống tổng hợp sản lượng đóng gói theo tuần và cộng mức thưởng cố định cho người đạt kết quả cao nhất."
        />;

        if (activePolicy === 'overtimeReward') return <RewardLandingDetail
            backgroundImage={overtimeRewardHero}
            theme="night"
            title="Thưởng tăng ca"
            headline={`${money(mechanisms.overtimeReward.firstHourRate)} giờ đầu`}
            description="Tiền tăng ca được cộng theo tổng số giờ thực tế, với đơn giá cao hơn từ giờ thứ hai."
            audience="Nhân viên có giờ tăng ca"
            cards={[
                { label: 'Giờ đầu tiên', value: money(mechanisms.overtimeReward.firstHourRate), note: '/ giờ', icon: <FieldTimeOutlined />, tone: 'mint' },
                { label: 'Từ giờ thứ hai', value: money(mechanisms.overtimeReward.nextHourRate), note: '/ giờ', icon: <FieldTimeOutlined />, tone: 'amber' },
                { label: 'Cách tính', value: 'Theo giờ thực tế', note: 'Đối chiếu bảng công', icon: <CheckCircleFilled />, tone: 'blue' },
            ]}
            sectionEyebrow="ĐƠN GIÁ TĂNG CA HIỆN HÀNH"
            sectionTitle="Làm thêm giờ, cộng đúng đơn giá"
            formulaTitle="Công thức tính tăng ca"
            formula={`Tổng thưởng = giờ đầu × ${money(mechanisms.overtimeReward.firstHourRate)} + số giờ còn lại × ${money(mechanisms.overtimeReward.nextHourRate)}`}
            formulaNote="Hệ thống dùng tổng số giờ tăng ca thực tế đã được ghi nhận trong bảng công."
        />;
        if (activePolicy === 'attendanceReward') return <RewardLandingDetail
            backgroundImage={weeklyRewardHero}
            title="Thưởng chuyên cần"
            headline={money(attendanceReward.monthlyRewardAmount)}
            description="Khuyến khích đi làm đúng giờ bằng huy hiệu, lượt miễn phạt nhẹ theo chuỗi và thưởng tháng cho nhân viên chính thức."
            audience="Nhân viên có lịch làm việc"
            cards={[
                { label: 'Mốc nhận thưởng', value: `${attendanceReward.monthlyRequiredDays}/${attendanceReward.standardWorkDays}`, note: 'tối thiểu 92,3% ngày đúng giờ', icon: <CalendarOutlined />, tone: 'mint' },
                { label: 'Mức thưởng tháng', value: money(attendanceReward.monthlyRewardAmount), note: 'chỉ áp dụng nhân viên chính thức', icon: <GiftOutlined />, tone: 'amber' },
                { label: 'Mốc huy hiệu', value: `${attendanceReward.badgeStreakDays} ngày`, note: 'liên tiếp đúng giờ', icon: <TrophyOutlined />, tone: 'blue' },
                { label: 'Lượt miễn phạt nhẹ', value: `${attendanceReward.waiverStreakDays} ngày`, note: `1 lượt ${attendanceReward.graceMinutes + 1}–${attendanceReward.waiverLateMaxMinutes} phút/kỳ`, icon: <ClockCircleOutlined />, tone: 'soft' },
            ]}
            sectionEyebrow="CƠ CHẾ THƯỞNG HÀNH VI"
            sectionTitle="Duy trì đều đặn, nhận quyền lợi rõ ràng"
            formulaTitle="Cách xét thưởng"
            formula={`Nhân viên chính thức đạt tối thiểu ${attendanceReward.monthlyRequiredDays}/${attendanceReward.standardWorkDays} ngày (92,3%) đúng giờ và kỳ đã hoàn tất => ${money(attendanceReward.monthlyRewardAmount)}`}
            formulaNote="Sau chuỗi 7 ngày đúng giờ, hệ thống tự dùng tối đa 1 lượt miễn phạt mức Nhẹ trong kỳ. Đi muộn vẫn làm đứt chuỗi và ảnh hưởng tỷ lệ chuyên cần."
        />;
        if (activePolicy === 'attendanceLateFine') {
            const thresholds = [
                { label: 'Muộn 6–15 phút', image: latePolicyMild, official: late.official[0], seasonal: late.seasonal[0], tone: 'mild' },
                { label: 'Muộn 16–30 phút', image: latePolicyMedium, official: late.official[1], seasonal: late.seasonal[1], tone: 'medium' },
                { label: 'Muộn trên 30 phút', image: latePolicySevere, official: late.official[2], seasonal: late.seasonal[2], tone: 'severe' },
            ];
            return <div className="late-policy-landing" style={{ backgroundImage: `url(${latePolicyHero})` }}>
                <section className="late-policy-hero">
                    <div className="late-policy-hero__copy">
                        <span><CheckCircleFilled /> Cơ chế đang áp dụng</span>
                        <h2>Phạt đi làm muộn</h2>
                        <strong>Miễn phạt<br />{late.graceMinutes} phút đầu ca</strong>
                        <p>Ca sáng bắt đầu <b>{late.morningStart}</b> · Ca chiều bắt đầu <b>{late.afternoonStart}</b></p>
                        <small>Hệ thống chỉ tính phạt sau thời gian miễn trừ.</small>
                    </div>
                    <div className="late-policy-hero__facts">
                        <div><ClockCircleOutlined /><span>Check-in đầu tiên<strong>của mỗi ca</strong></span></div>
                        <div><CheckCircleFilled /><span>Trừ thời gian miễn phạt<strong>{late.graceMinutes} phút</strong></span></div>
                        <div><WarningFilled /><span>Áp dụng mức phạt<strong>theo ngưỡng thực tế</strong></span></div>
                    </div>
                </section>

                <section className="late-policy-thresholds">
                    <header><div><small>BẢNG MỨC PHẠT THEO NGƯỠNG</small><h3>Đi muộn càng lâu, mức phạt càng tăng</h3></div><span>Chính thức / Thời vụ</span></header>
                    <div>
                        {thresholds.map(item => <article key={item.label} className={`is-${item.tone}`}>
                            <img src={item.image} alt="" />
                            <div className="late-policy-threshold__content">
                                <h4>{item.label}</h4>
                                <dl>
                                    <div><dt>Nhân viên chính thức</dt><dd>{money(item.official)}</dd></div>
                                    <div><dt>Nhân viên thời vụ</dt><dd>{money(item.seasonal)}</dd></div>
                                </dl>
                            </div>
                        </article>)}
                    </div>
                </section>

                <section className="late-policy-rule">
                    <div><span><ClockCircleOutlined /></span><p><small>GIỜ BẮT ĐẦU CA</small><strong>{late.morningStart} / {late.afternoonStart}</strong></p></div>
                    <i aria-hidden="true" />
                    <div><span><CheckCircleFilled /></span><p><small>MIỄN PHẠT</small><strong>{late.graceMinutes} phút đầu</strong></p></div>
                    <i aria-hidden="true" />
                    <div className="is-fine"><span><WarningFilled /></span><p><small>BẮT ĐẦU TÍNH PHẠT</small><strong>Sau {late.graceMinutes} phút</strong></p></div>
                    <p>Hệ thống dùng lần chấm công đầu tiên của từng ca để đối chiếu với giờ ca đang được cấu hình.</p>
                </section>
            </div>;
        }
        if (activePolicy === 'wrongOrderFine') {
            return (
                <FineLandingDetail
                    backgroundImage={wrongOrderFineHero}
                    title="Phạt đóng gói sai đơn"
                    amount={money(config.wrongOrderFineOfficial)}
                    amountUnit={`/ đơn (Thời vụ: ${money(config.wrongOrderFineSeasonal)})`}
                    subtitle="Áp dụng khi đóng gói sai sản phẩm, sai SKU hoặc sai số lượng dẫn đến khiếu nại/hoàn hàng."
                    hint="Lấy trực tiếp từ cấu hình phân loại nhân sự tại thời điểm phát sinh lỗi."
                    effectiveAtValue="Đang áp dụng"
                    effectiveAtNote="Theo quy chuẩn đóng gói kho"
                    fineAmountValue={money(config.wrongOrderFineOfficial)}
                    fineAmountNote={`Chính thức: ${money(config.wrongOrderFineOfficial)} · Thời vụ: ${money(config.wrongOrderFineSeasonal)}`}
                    exclusionLabel="ĐIỀU KIỆN MIỄN TRỪ"
                    exclusionValue="Không có lỗi đơn"
                    exclusionNote="Miễn trừ nếu do lỗi từ đối tác vận chuyển"
                    noteText="Mỗi đơn đóng gói chính xác và có camera ghi nhận lưu vết sẽ được bảo vệ 100% khi có tranh chấp phát sinh."
                    guideTip={<><CheckCircleFilled /> Camera đối chiếu 100%</>}
                    guideTitle="3 bước đóng gói chuẩn xác để không bị phạt lỗi đơn"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <CodeSandboxOutlined />
                                        <span>Đơn hàng</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Đóng gói đơn</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Vào Đơn hàng > Đóng gói đơn',
                            description: 'Mở màn hình đóng gói trên phần mềm để chuẩn bị quét mã vạch đối chiếu từng sản phẩm.',
                        },
                        {
                            stepNumber: '02',
                            tag: 'QUÉT MÃ SKU',
                            mock: (
                                <div className="mock-scan">
                                    <div className="mock-scan__code">
                                        <BarcodeOutlined />
                                        <span>SKU-AIR-2024</span>
                                    </div>
                                    <span className="mock-scan__badge">Khớp 100%</span>
                                </div>
                            ),
                            title: 'Quét mã vạch từng sản phẩm',
                            description: 'Bắt buộc quét mã vạch để hệ thống tự động kiểm tra đối chiếu đúng SKU và số lượng theo đơn.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'DÁN TEM & HOÀN TẤT',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <CheckCircleFilled style={{ color: '#10b981' }} />
                                        <span>Đã dán tem</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Xác nhận đóng gói
                                    </div>
                                </div>
                            ),
                            title: 'Dán tem vận chuyển & Xác nhận',
                            description: 'Dán đúng mã vận đơn lên kiện hàng và bấm Xác nhận để lưu vết camera đóng gói thành công.',
                        },
                    ]}
                />
            );
        }

        if (activePolicy === 'vatInvoiceFine') {
            const policy = mechanisms.vatInvoiceFine;
            return (
                <FineLandingDetail
                    backgroundImage={vatInvoiceLateHero}
                    title="Phạt nộp hóa đơn VAT muộn"
                    amount={money(policy.firstAmount)}
                    amountUnit={`từ ngày thứ ${policy.firstFineAfterDays} (+${money(policy.stageIncrement)}/kỳ)`}
                    subtitle="Áp dụng với phiếu nhập cần hóa đơn VAT nhưng chưa cập nhật đủ hóa đơn hợp lệ từ nhà cung cấp."
                    hint={`Lần đầu phạt sau ${policy.firstFineAfterDays} ngày. Ba lần đầu cách nhau 2 ngày tính phạt theo lịch hệ thống.`}
                    effectiveAtValue={shortDate(policy.effectiveAt)}
                    effectiveAtNote="Bắt đầu áp dụng trên hệ thống"
                    fineAmountValue={money(policy.firstAmount)}
                    fineAmountNote={`Tăng +${money(policy.stageIncrement)} mỗi chu kỳ 2 ngày tiếp theo`}
                    exclusionValue={policy.excludesSunday ? 'Chủ nhật' : 'Không loại trừ'}
                    exclusionNote={policy.excludesSunday ? 'Rơi vào Chủ nhật dời sang ngày kế tiếp' : 'Tính tất cả các ngày'}
                    noteText="Chỉ áp dụng đối với các phiếu nhập hàng có đánh dấu yêu cầu hóa đơn VAT từ nhà cung cấp."
                    guideTip={<><ClockCircleOutlined /> Hạn chót {policy.firstFineAfterDays} ngày</>}
                    guideTitle="3 bước bổ sung hóa đơn VAT tránh bị phạt quá hạn"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <InboxOutlined />
                                        <span>Nhập hàng</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Phiếu nhập kho</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Vào Nhập hàng > Phiếu nhập',
                            description: 'Truy cập danh sách phiếu nhập kho và lọc các phiếu có gắn nhãn "Cần hóa đơn VAT".',
                        },
                        {
                            stepNumber: '02',
                            tag: 'TẢI TỆP HÓA ĐƠN',
                            mock: (
                                <div className="mock-upload">
                                    <div className="mock-upload__box">
                                        <CloudUploadOutlined />
                                        <span>Tải lên HĐ VAT (.pdf, .xml)</span>
                                    </div>
                                </div>
                            ),
                            title: 'Tải hóa đơn VAT & Nhập số HĐ',
                            description: 'Đính kèm tệp hóa đơn điện tử hoặc ảnh chụp hóa đơn VAT do nhà cung cấp xuất.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'LƯU & HOÀN TẤT',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <FileTextOutlined style={{ color: '#059669' }} />
                                        <span>HĐ Hợp lệ</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Lưu &amp; Chốt hóa đơn
                                    </div>
                                </div>
                            ),
                            title: 'Lưu phiếu & Xác nhận hợp lệ',
                            description: `Bấm Lưu phiếu trước thời hạn ${policy.firstFineAfterDays} ngày để hệ thống tự động gỡ trạng thái theo dõi phạt.`,
                        },
                    ]}
                />
            );
        }

        if (activePolicy === 'returnOverdueFine') {
            const policy = mechanisms.returnOverdueFine;
            return (
                <FineLandingDetail
                    backgroundImage={returnOverdueHero}
                    title="Phạt trả hàng quá hạn"
                    amount={money(policy.firstAmount)}
                    amountUnit={`sau ${policy.firstFineAfterDays} ngày (+${money(policy.dailyIncrement)}/ngày)`}
                    subtitle="Áp dụng khi phiếu trả hàng nhà cung cấp chưa được hoàn thành trong thời hạn xử lý quy định."
                    hint={`Bắt đầu phạt sau ${policy.firstFineAfterDays} ngày. Mỗi ngày làm việc tiếp theo tăng thêm 1 bậc (+${money(policy.dailyIncrement)}/ngày).`}
                    effectiveAtValue={shortDate(policy.effectiveAt)}
                    effectiveAtNote="Thời điểm bắt đầu áp dụng"
                    fineAmountValue={money(policy.firstAmount)}
                    fineAmountNote={`Tăng +${money(policy.dailyIncrement)} mỗi ngày làm việc quá hạn`}
                    exclusionValue={policy.excludesRestDays ? 'Chủ nhật & Ngày lễ' : 'Không loại trừ'}
                    exclusionNote={policy.excludesRestDays ? 'Miễn trừ hoàn toàn ngày nghỉ' : 'Tính tất cả các ngày'}
                    noteText="Hệ thống tự động tính số ngày quá hạn dựa trên ngày tạo phiếu trả và lịch làm việc thực tế."
                    guideTip={<><ClockCircleOutlined /> Thời hạn {policy.firstFineAfterDays} ngày làm việc</>}
                    guideTitle="3 bước xử lý phiếu trả hàng NCC đúng thời hạn"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <CodeSandboxOutlined />
                                        <span>Quản lý kho</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Trả hàng NCC</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Vào Quản lý kho > Trả hàng',
                            description: 'Mở danh sách phiếu xuất trả nhà cung cấp để kiểm tra các phiếu đang chờ xử lý.',
                        },
                        {
                            stepNumber: '02',
                            tag: 'KIỂM ĐẾM TRẢ',
                            mock: (
                                <div className="mock-scan">
                                    <div className="mock-scan__code">
                                        <ReloadOutlined />
                                        <span>Kiểm đếm hàng trả NCC</span>
                                    </div>
                                    <span className="mock-scan__badge">Đủ SL</span>
                                </div>
                            ),
                            title: 'Kiểm đếm & Đóng kiện trả',
                            description: 'Đối chiếu số lượng sản phẩm trả lại, đóng kiện và bàn giao cho đơn vị vận chuyển.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'CHỐT PHIẾU',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <CheckCircleFilled style={{ color: '#059669' }} />
                                        <span>Đã bàn giao</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Hoàn thành phiếu
                                    </div>
                                </div>
                            ),
                            title: 'Chuyển trạng thái Hoàn thành',
                            description: `Bấm Hoàn thành phiếu trên hệ thống trước ngày thứ ${policy.firstFineAfterDays} để chốt hồ sơ thành công.`,
                        },
                    ]}
                />
            );
        }

        if (activePolicy === 'refundOverdueFine') {
            const policy = mechanisms.refundOverdueFine;
            return (
                <FineLandingDetail
                    backgroundImage={refundOverdueHero}
                    title="Phạt hàng hoàn quá hạn"
                    amount={money(policy.firstAmount)}
                    amountUnit={`sau ${policy.firstFineAfterDays} ngày (+${money(policy.dailyIncrement)}/ngày)`}
                    subtitle="Áp dụng khi kiện hàng hoàn chưa được quét xác nhận nhập kho trong thời hạn quy định."
                    hint={`Mức đầu ghi nhận từ ngày thứ ${policy.firstFineAfterDays}. Mỗi ngày làm việc tiếp theo tăng thêm 1 bậc (+${money(policy.dailyIncrement)}/ngày).`}
                    effectiveAtValue={shortDate(policy.effectiveAt)}
                    effectiveAtNote="Thời điểm bắt đầu áp dụng"
                    fineAmountValue={money(policy.firstAmount)}
                    fineAmountNote={`Tăng +${money(policy.dailyIncrement)} mỗi ngày làm việc quá hạn`}
                    exclusionValue={policy.excludesRestDays ? 'Chủ nhật & Ngày lễ' : 'Không loại trừ'}
                    exclusionNote={policy.excludesRestDays ? 'Miễn trừ hoàn toàn ngày nghỉ' : 'Tính tất cả các ngày'}
                    noteText="Kiện hàng hoàn được đếm từ lúc đơn vị vận chuyển phát trả về kho theo lịch làm việc thực tế."
                    guideTip={<><ClockCircleOutlined /> Thời hạn {policy.firstFineAfterDays} ngày làm việc</>}
                    guideTitle="3 bước tiếp nhận và xử lý hàng hoàn đúng hạn"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <CodeSandboxOutlined />
                                        <span>Quản lý kho</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Hàng hoàn</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Vào Quản lý kho > Hàng hoàn',
                            description: 'Mở danh sách các kiện hàng hoàn do đơn vị vận chuyển giao trả về kho.',
                        },
                        {
                            stepNumber: '02',
                            tag: 'QUÉT MÃ VẬN ĐƠN',
                            mock: (
                                <div className="mock-scan">
                                    <div className="mock-scan__code">
                                        <BarcodeOutlined />
                                        <span>VN-POST-99214</span>
                                    </div>
                                    <span className="mock-scan__badge">Đã nhận</span>
                                </div>
                            ),
                            title: 'Quét mã vận đơn kiện hàng',
                            description: 'Dùng máy quét mã vận đơn để đối chiếu tình trạng kiện hàng và sản phẩm hoàn về.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'NHẬP KHO',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <InboxOutlined style={{ color: '#2563eb' }} />
                                        <span>Kiện nguyên vẹn</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Nhập kho hàng hoàn
                                    </div>
                                </div>
                            ),
                            title: 'Xác nhận nhập kho hàng hoàn',
                            description: `Nhập kho phân loại và bấm Xác nhận trước ngày thứ ${policy.firstFineAfterDays} để tự động đóng quy trình.`,
                        },
                    ]}
                />
            );
        }

        if (activePolicy === 'taskDeadlineFine') {
            const policy = mechanisms.taskDeadlineFine;
            return (
                <FineLandingDetail
                    backgroundImage={taskDeadlineFineHero}
                    title="Phạt trễ deadline công việc"
                    amount={money(policy.defaultAmount)}
                    amountUnit="/ công việc trễ hạn"
                    subtitle="Áp dụng cho công việc bàn giao đã quá deadline nhưng chưa được xác nhận hoàn thành."
                    hint={`Mức mặc định ${money(policy.defaultAmount)} hoặc cấu hình riêng khi giao việc. Tổng phạt chia đều nếu nhiều người làm.`}
                    effectiveAtValue="Theo từng việc"
                    effectiveAtNote="Tính từ mốc hết hạn deadline của task"
                    fineAmountValue={money(policy.defaultAmount)}
                    fineAmountNote={policy.configurablePerTask ? 'Mức mặc định (có thể đặt riêng theo task)' : 'Áp dụng cố định'}
                    exclusionLabel="ĐIỀU KIỆN MIỄN TRỪ"
                    exclusionValue="Hoàn thành đúng hạn"
                    exclusionNote={policy.splitBetweenRecipients ? 'Chia đều người phụ trách hoặc gia hạn hợp lệ' : 'Miễn trừ khi có gia hạn hợp lệ'}
                    noteText="Trường hợp có nhiều nhân viên cùng phụ trách một công việc, tổng mức phạt sẽ được chia đều."
                    guideTip={<><ClockCircleOutlined /> Theo dõi deadline chủ động</>}
                    guideTitle="3 bước quản lý tiến độ hoàn thành công việc đúng hạn"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <FileDoneOutlined />
                                        <span>Công việc</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Việc của tôi</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Vào Công việc > Việc của tôi',
                            description: 'Xem danh sách các nhiệm vụ được giao và kiểm tra chính xác mốc giờ deadline bàn giao.',
                        },
                        {
                            stepNumber: '02',
                            tag: 'CẬP NHẬT TIẾN ĐỘ',
                            mock: (
                                <div className="mock-progress">
                                    <div className="mock-progress__label">
                                        <span>Tiến độ thực hiện</span>
                                        <span>85%</span>
                                    </div>
                                    <div className="mock-progress__bar">
                                        <div className="mock-progress__fill" style={{ width: '85%' }} />
                                    </div>
                                </div>
                            ),
                            title: 'Thực hiện & Báo cáo tiến độ',
                            description: 'Triển khai công việc theo yêu cầu và liên tục cập nhật tiến độ trước khi hết hạn.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'BÀN GIAO',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <CheckCircleFilled style={{ color: '#059669' }} />
                                        <span>Đạt mục tiêu</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Bàn giao hoàn tất
                                    </div>
                                </div>
                            ),
                            title: 'Bàn giao & Chốt hoàn thành',
                            description: 'Bấm Hoàn tất công việc trước thời điểm hết hạn để hệ thống ghi nhận đúng tiến độ.',
                        },
                    ]}
                />
            );
        }

        if (activePolicy === 'taskEvidenceFine') {
            const policy = mechanisms.taskEvidenceFine;
            return (
                <FineLandingDetail
                    backgroundImage={taskEvidenceFineHero}
                    title="Phạt vi phạm bằng chứng"
                    amount={money(policy.defaultAmount)}
                    amountUnit="/ lần vi phạm bằng chứng"
                    subtitle="Áp dụng khi không nộp bằng chứng công việc đúng hạn hoặc bằng chứng bị quản trị viên từ chối."
                    hint="Lần đầu áp dụng mức cơ sở. Các lần tiếp theo tăng theo chu kỳ: Mức cơ sở × Số lần vi phạm."
                    effectiveAtValue="Đang áp dụng"
                    effectiveAtNote="Theo chu kỳ duyệt của từng công việc"
                    fineAmountValue={money(policy.defaultAmount)}
                    fineAmountNote={policy.escalatesByCycle ? 'Mức cơ sở (nhân theo số lần vi phạm)' : 'Mức cơ sở cố định'}
                    exclusionLabel="ĐIỀU KIỆN MIỄN TRỪ"
                    exclusionValue="Bằng chứng hợp lệ"
                    exclusionNote="Được duyệt đạt yêu cầu hoặc có ảnh bổ sung"
                    noteText="Bằng chứng phải là ảnh chụp hoặc video thực tế tại hiện trường, rõ nét và đúng nội dung công việc."
                    guideTip={<><CameraOutlined /> Ảnh chụp rõ nét hiện trường</>}
                    guideTitle="3 bước chụp và nộp bằng chứng chuẩn để được duyệt ngay"
                    steps={[
                        {
                            stepNumber: '01',
                            tag: 'ĐIỀU HƯỚNG',
                            mock: (
                                <div className="mock-nav">
                                    <div className="mock-nav__item">
                                        <FileDoneOutlined />
                                        <span>Công việc</span>
                                    </div>
                                    <div className="mock-nav__sub is-active">
                                        <span className="mock-nav__bullet" />
                                        <span>Chi tiết task</span>
                                        <span className="mock-nav__badge">Vào đây</span>
                                    </div>
                                </div>
                            ),
                            title: 'Mở công việc yêu cầu bằng chứng',
                            description: 'Bấm vào chi tiết công việc có đánh dấu yêu cầu bằng chứng xác nhận hoàn thành.',
                        },
                        {
                            stepNumber: '02',
                            tag: 'CHỤP HIỆN TRƯỜNG',
                            mock: (
                                <div className="mock-upload">
                                    <div className="mock-upload__box">
                                        <CameraOutlined />
                                        <span>Tải ảnh hiện trường thực tế</span>
                                    </div>
                                </div>
                            ),
                            title: 'Chụp ảnh hiện trường & Tải lên',
                            description: 'Chụp ảnh góc rộng, rõ nét thành quả công việc và tải lên mục Bằng chứng thực hiện.',
                        },
                        {
                            stepNumber: '03',
                            tag: 'GỬI DUYỆT',
                            mock: (
                                <div className="mock-action">
                                    <div className="mock-action__status">
                                        <CheckCircleFilled style={{ color: '#059669' }} />
                                        <span>Đủ điều kiện</span>
                                    </div>
                                    <div className="mock-action__btn">
                                        <CheckCircleFilled /> Gửi duyệt bằng chứng
                                    </div>
                                </div>
                            ),
                            title: 'Gửi duyệt bằng chứng trước hạn',
                            description: 'Bấm Gửi duyệt để quản lý xác nhận trước hạn chu kỳ, tránh bị hệ thống ghi nhận vi phạm.',
                        },
                    ]}
                />
            );
        }

        const policy = mechanisms.stockCheckMissingFine;
        return (
            <FineLandingDetail
                backgroundImage={stockCheckMissingHero}
                title="Thiếu kiểm hàng ngày"
                amount={money(policy.amount)}
                amountUnit="/ ngày thiếu kiểm"
                subtitle="Áp dụng khi phiên kiểm hàng ngày không được hoàn tất theo quy định."
                hint="Hệ thống tự động đối chiếu các ngày làm việc đã qua để ghi nhận."
                effectiveAtValue={shortDate(policy.effectiveAt)}
                effectiveAtNote="Thời điểm bắt đầu áp dụng"
                fineAmountValue={money(policy.amount)}
                fineAmountNote="Mỗi ngày làm việc thiếu kiểm"
                exclusionValue={policy.excludesRestDays ? 'Chủ nhật & Ngày lễ' : 'Không loại trừ'}
                exclusionNote={policy.excludesRestDays ? 'Miễn trừ hoàn toàn ngày nghỉ' : 'Tính tất cả các ngày'}
                noteText="Mức phạt được hệ thống tự động tính dựa trên lịch làm việc thực tế và đối chiếu phiên kiểm kho mỗi ngày."
                guideTip={<><ClockCircleOutlined /> Mở ca từ 17:00</>}
                guideTitle="3 bước kiểm hàng mỗi ngày để tránh bị phạt"
                steps={[
                    {
                        stepNumber: '01',
                        tag: 'ĐIỀU HƯỚNG',
                        mock: (
                            <div className="mock-nav">
                                <div className="mock-nav__item">
                                    <CodeSandboxOutlined />
                                    <span>Quản lý kho</span>
                                </div>
                                <div className="mock-nav__sub is-active">
                                    <span className="mock-nav__bullet" />
                                    <span>Kiểm hàng</span>
                                    <span className="mock-nav__badge">Vào đây</span>
                                </div>
                            </div>
                        ),
                        title: 'Vào Quản lý kho > Kiểm hàng',
                        description: 'Từ thanh menu bên trái, bấm vào Quản lý kho rồi chọn Kiểm hàng để vào danh mục phiên kiểm.',
                    },
                    {
                        stepNumber: '02',
                        tag: 'CHỌN PHIÊN',
                        mock: (
                            <div className="mock-tabs">
                                <div className="mock-tab is-active">
                                    <ClockCircleOutlined />
                                    <span>Kiểm hàng ngày 17:00</span>
                                </div>
                                <div className="mock-tab">
                                    <span>Kiểm toàn bộ 16:00</span>
                                </div>
                            </div>
                        ),
                        title: 'Chọn ca kiểm 17:00 hàng ngày',
                        description: 'Bấm chọn tab Kiểm hàng ngày 17:00 để tải danh sách các mã sản phẩm trọng điểm cần kiểm đếm.',
                    },
                    {
                        stepNumber: '03',
                        tag: 'HOÀN TẤT',
                        mock: (
                            <div className="mock-action">
                                <div className="mock-action__status">
                                    <BarcodeOutlined />
                                    <span>Đã quét kiểm đếm</span>
                                </div>
                                <div className="mock-action__btn">
                                    <CheckCircleFilled /> Hoàn tất kiểm hàng
                                </div>
                            </div>
                        ),
                        title: 'Quét mã & Hoàn tất phiên',
                        description: 'Nhập số lượng thực tế và bấm Hoàn tất kiểm hàng trong ngày để hệ thống tự động miễn phạt 100%.',
                    },
                ]}
            />
        );
    })();

    return (
        <div className="policy-library">
            <aside className="policy-library__nav">
                <h2>Chính sách</h2>
                <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm chính sách..." value={query} onChange={event => setQuery(event.target.value)} />
                {navGroup('Thưởng', 'reward', rewardPolicies)}
                {navGroup('Phạt', 'fine', finePolicies)}
                {visiblePolicies.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có chính sách phù hợp" />}
            </aside>
            <main ref={documentRef} className="policy-library__document">
                {loading ? <div className="policy-library__state"><Spin /></div> : visiblePolicies.length === 0 ? <div className="policy-library__state"><Empty description="Không tìm thấy chính sách phù hợp" /></div> : detail}
                {error && <div className="notification-list__error">{error}</div>}
            </main>
        </div>
    );
}
