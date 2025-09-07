// Advanced calculation helpers (scaffold)
// These are intentionally lightweight; real formulas can be expanded later.

export interface TemperatureInputs {
  coefficientVocPctPerC?: number; // e.g. -0.28 (%/°C)
  coefficientPmaxPctPerC?: number; // e.g. -0.35 (%/°C)
  stcCellTempC?: number; // default 25°C
  actualCellTempC?: number; // estimated operating cell temperature
}

export function adjustForTemperature(value: number, coeffPctPerC: number, deltaC: number): number {
  if (!isFinite(value) || !isFinite(coeffPctPerC) || !isFinite(deltaC)) return value;
  return value * (1 + (coeffPctPerC / 100) * deltaC);
}

export function effectiveVoc(vocStc: number, inputs: TemperatureInputs): number {
  const { coefficientVocPctPerC = -0.28, stcCellTempC = 25, actualCellTempC = 45 } = inputs;
  return adjustForTemperature(vocStc, coefficientVocPctPerC, actualCellTempC - stcCellTempC);
}

export function effectivePmax(pmaxStc: number, inputs: TemperatureInputs): number {
  const { coefficientPmaxPctPerC = -0.35, stcCellTempC = 25, actualCellTempC = 45 } = inputs;
  return adjustForTemperature(pmaxStc, coefficientPmaxPctPerC, actualCellTempC - stcCellTempC);
}

export interface VoltageDropParams {
  currentA: number;
  oneWayLengthM: number; // one-way length
  conductorResistivityOhmMm2PerM: number; // e.g. Copper ~0.017241
  crossSectionMm2: number; // area
  systemVoltage: number;
}

export function voltageDrop(params: VoltageDropParams) {
  const { currentA, oneWayLengthM, conductorResistivityOhmMm2PerM, crossSectionMm2, systemVoltage } = params;
  if ([currentA, oneWayLengthM, conductorResistivityOhmMm2PerM, crossSectionMm2, systemVoltage].some(v => !isFinite(v) || v <= 0)) {
    return { dropV: NaN, pct: NaN };
  }
  // Round trip length (out and back)
  const loopLength = oneWayLengthM * 2;
  const resistance = conductorResistivityOhmMm2PerM * loopLength / crossSectionMm2; // Ohms
  const dropV = currentA * resistance;
  const pct = (dropV / systemVoltage) * 100;
  return { dropV, pct };
}

export interface DegradationParams {
  initialValue: number;
  annualDegradationPct: number; // e.g. 0.5 means 0.5% per year
  years: number;
}

export function linearDegradation({ initialValue, annualDegradationPct, years }: DegradationParams) {
  const values: number[] = [];
  for (let y = 0; y <= years; y++) {
    const factor = 1 - (annualDegradationPct / 100) * y;
    values.push(initialValue * factor);
  }
  return values;
}

export interface PaybackParams {
  systemCost: number;
  annualEnergyKWh: number;
  gridRatePerKWh: number;
  annualEscalationPct?: number;
}

export function simplePayback({ systemCost, annualEnergyKWh, gridRatePerKWh, annualEscalationPct = 0 }: PaybackParams) {
  let remaining = systemCost;
  let year = 0;
  let rate = gridRatePerKWh;
  while (remaining > 0 && year < 50) {
    const savings = annualEnergyKWh * rate;
    remaining -= savings;
    year++;
    rate *= (1 + annualEscalationPct / 100);
  }
  return remaining <= 0 ? year : NaN;
}

export function lcoe(systemCost: number, totalLifetimeKWh: number) {
  if (!isFinite(systemCost) || !isFinite(totalLifetimeKWh) || totalLifetimeKWh <= 0) return NaN;
  return systemCost / totalLifetimeKWh; // $/kWh
}
