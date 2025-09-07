// Shared TypeScript interfaces for components in the solar setup

export type ComponentType = 'Individual Solar Panel' | 'Solar Array Configuration' | 'MPPT Charge Controller' | 'Battery' | 'Inverter';

export interface BaseComponent<TProps extends Record<string, any>> {
  id: number;
  type: ComponentType;
  name: string;
  properties: TProps;
}

export interface IndividualSolarPanelProps {
  voc: string; // V
  isc: string; // A
  vmp: string; // V
  imp: string; // A
  pmax: string; // W
  costUsd?: string; // optional cost
  tempCoeffVocPctPerC?: string; // -0.28 etc
  tempCoeffPmaxPctPerC?: string; // -0.35 etc
}

export interface SolarArrayConfigurationProps {
  selectedPanelId: string; // reference to Individual Panel id
  panelsInSeries: string;  // count
  numberOfStrings: string; // count
  assignedMpptId: string;  // reference to MPPT id
}

export interface MpptChargeControllerProps {
  maxInputVoltage: string;
  maxInputCurrent: string;
  maxOutputCurrent: string;
  nominalBatteryVoltage: string;
  costUsd?: string;
}

export interface BatteryProps {
  nominalVoltage: string;
  capacityAh: string;
  maxChargeCurrent: string;
  maxDischargeCurrent: string;
  costUsd?: string;
}

export interface InverterProps {
  inputVoltageMin: string;
  inputVoltageMax: string;
  ratedPower: string;
  surgePower: string;
  efficiencyPct?: string;
  idleDrawW?: string;
  costUsd?: string;
}

export type IndividualSolarPanel = BaseComponent<IndividualSolarPanelProps> & { type: 'Individual Solar Panel' };
export type SolarArrayConfiguration = BaseComponent<SolarArrayConfigurationProps> & { type: 'Solar Array Configuration' };
export type MpptChargeController = BaseComponent<MpptChargeControllerProps> & { type: 'MPPT Charge Controller' };
export type Battery = BaseComponent<BatteryProps> & { type: 'Battery' };
export type Inverter = BaseComponent<InverterProps> & { type: 'Inverter' };

export type AnyComponent = IndividualSolarPanel | SolarArrayConfiguration | MpptChargeController | Battery | Inverter;

// Scenario planning
export interface Scenario {
  id: string;
  name: string;
  peakSunHours?: number;
  dailyUsageWh?: number;
  notes?: string;
}

