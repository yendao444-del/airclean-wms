import dayjs from 'dayjs';

export const VAT_OVERDUE_FINE_FIRST_AMOUNT = 30000;
export const VAT_OVERDUE_FINE_STAGE_INCREMENT = 10000;
export const VAT_FIRST_FINE_AFTER_DAYS = 5;
export const VAT_FINE_POLICY_EFFECTIVE_AT = dayjs('2026-08-11T00:00:00');

// Both the five-day grace period and later penalty intervals skip Sundays.
export const addVatChargeableDays = (start: dayjs.Dayjs, count: number) => {
    let cursor = start.startOf('day');
    let added = 0;
    while (added < Math.max(0, count)) {
        cursor = cursor.add(1, 'day');
        if (cursor.day() !== 0) added += 1;
    }
    return cursor;
};

export const countVatChargeableDays = (start: dayjs.Dayjs, end: dayjs.Dayjs) => {
    let cursor = start.startOf('day');
    let count = 0;
    while (cursor.isBefore(end, 'day')) {
        cursor = cursor.add(1, 'day');
        if (cursor.day() !== 0) count += 1;
    }
    return count;
};

export const getVatFirstFineAt = (purchaseAt: dayjs.Dayjs) => {
    const normalFirstFineAt = addVatChargeableDays(purchaseAt, VAT_FIRST_FINE_AFTER_DAYS);
    const effectiveFirstFineAt = normalFirstFineAt.isBefore(VAT_FINE_POLICY_EFFECTIVE_AT)
        ? VAT_FINE_POLICY_EFFECTIVE_AT
        : normalFirstFineAt;
    return effectiveFirstFineAt.day() === 0 ? effectiveFirstFineAt.add(1, 'day') : effectiveFirstFineAt;
};

export const getVatFineDate = (purchaseAt: dayjs.Dayjs, stage: number) => {
    const delayDays = stage <= 3 ? (stage - 1) * 2 : stage + 1;
    return addVatChargeableDays(getVatFirstFineAt(purchaseAt), delayDays);
};

export const isVatFineOnSchedule = (purchaseAt: dayjs.Dayjs, fineAt: dayjs.Dayjs, stage: number) =>
    fineAt.isSame(getVatFineDate(purchaseAt, stage), 'day');

export const getVatFineStage = (purchaseAt: dayjs.Dayjs, now = dayjs()) => {
    const firstFineAt = getVatFirstFineAt(purchaseAt);
    if (now.isBefore(firstFineAt)) return 0;
    let stage = 0;
    while (stage < 366 && !now.isBefore(getVatFineDate(purchaseAt, stage + 1))) stage += 1;
    return stage;
};

export const getVatFineAmount = (stage: number) =>
    VAT_OVERDUE_FINE_FIRST_AMOUNT + (Math.max(1, stage) - 1) * VAT_OVERDUE_FINE_STAGE_INCREMENT;

export const getVatFineId = (purchaseId: number, purchaseAt: dayjs.Dayjs, stage: number) => {
    const baseId = stage === 1 ? `vat-overdue-${purchaseId}` : `vat-overdue-${purchaseId}-stage-${stage}`;
    const legacyFirstFineAt = purchaseAt.startOf('day').add(VAT_FIRST_FINE_AFTER_DAYS, 'day');
    const effectiveLegacyFirstFineAt = legacyFirstFineAt.isBefore(VAT_FINE_POLICY_EFFECTIVE_AT)
        ? VAT_FINE_POLICY_EFFECTIVE_AT
        : legacyFirstFineAt;
    const legacyDate = effectiveLegacyFirstFineAt.add(stage <= 3 ? (stage - 1) * 2 : stage + 1, 'day');
    const correctedDate = getVatFineDate(purchaseAt, stage);
    return correctedDate.isSame(legacyDate, 'day')
        ? baseId
        : `${baseId}-workday-${correctedDate.format('YYYYMMDD')}`;
};
