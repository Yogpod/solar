import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AnyComponent,
  Battery,
  BatteryProps,
  ComponentType,
  IndividualSolarPanel,
  IndividualSolarPanelProps,
  Inverter,
  InverterProps,
  MpptChargeController,
  MpptChargeControllerProps,
  SolarArrayConfiguration,
  SolarArrayConfigurationProps,
} from './types';
import { effectiveVoc, effectivePmax } from './calculations';
import jsPDF from 'jspdf';

// Utility
const getNum = (val: string | number | undefined): number => {
  const num = typeof val === 'number' ? val : parseFloat(val ?? '');
  return Number.isFinite(num) ? num : NaN;
};

interface SystemInputs {
  peakSunHours: number;
  estimatedDailyUsageWh: number;
  batteryDoD: number; // %
  inverterEfficiency: number; // %
  solarPanelEfficiency: number; // % (array performance factor)
  systemWideVoltage: number; // V
}

const defaultSystemInputs: SystemInputs = {
  peakSunHours: 4,
  estimatedDailyUsageWh: 0,
  batteryDoD: 80,
  inverterEfficiency: 90,
  solarPanelEfficiency: 85,
  systemWideVoltage: 48,
};

const componentTypeOptions: ComponentType[] = [
  'Individual Solar Panel',
  'Solar Array Configuration',
  'MPPT Charge Controller',
  'Battery',
  'Inverter',
];

// Property descriptions (tooltips)
const propertyDescriptions: Record<string, string> = {
  voc: 'Open Circuit Voltage of a SINGLE solar panel. (V)',
  isc: 'Short Circuit Current of a SINGLE solar panel. (A)',
  vmp: 'Maximum Power Voltage of a SINGLE solar panel. (V)',
  imp: 'Maximum Power Current of a SINGLE solar panel. (A)',
  pmax: 'Maximum Power of a SINGLE solar panel under standard test conditions. (W)',
  selectedPanelId: 'Select the individual solar panel type this array is built from.',
  panelsInSeries: 'Number of individual panels connected in series within EACH string of this array.',
  numberOfStrings: 'Number of parallel strings in this solar array.',
  assignedMpptId: 'Assign this solar array to a specific MPPT charge controller.',
  maxInputVoltage: 'Maximum PV Input Voltage the MPPT can handle. (V)',
  maxInputCurrent: 'Maximum PV Input Current the MPPT can handle. (A)',
  maxOutputCurrent: 'Maximum Battery Charging Current. (A)',
  nominalBatteryVoltage: 'Nominal Battery Voltage (e.g., 12, 24, 48).',
  nominalVoltage: 'Battery nominal voltage.',
  capacityAh: 'Battery capacity in Ah.',
  maxChargeCurrent: 'Max safe charge current. (A)',
  maxDischargeCurrent: 'Max safe discharge current. (A)',
  inputVoltageMin: 'Minimum DC input voltage inverter needs. (V)',
  inputVoltageMax: 'Maximum DC input voltage for inverter. (V)',
  ratedPower: 'Continuous AC output power. (W)',
  surgePower: 'Short duration surge AC power. (W)',
};

// Safety margin constants similar to original HTML logic
const VOC_SAFETY_MARGIN_FACTOR_MIN = 1.10; // 10% headroom
const VOC_SAFETY_MARGIN_FACTOR_IDEAL = 1.20; // 20% headroom ideal

// Helper for pushing prefixed messages with consistent categories
type MessageLevel = 'error' | 'warn-safety' | 'warn-sizing' | 'warn-c-rate' | 'warn' | 'info-safety' | 'info';
interface CategorizedMessage { level: MessageLevel; text: string; }

const levelPrefixMap: Record<MessageLevel, string> = {
  error: 'Error:',
  'warn-safety': 'Warning (Safety Margin):',
  'warn-sizing': 'Warning (Sizing):',
  'warn-c-rate': 'Warning (C-Rate):',
  warn: 'Warning:',
  'info-safety': 'Info (Safety Margin):',
  info: 'Info:',
};

// React Component
export const App: React.FC = () => {
  const [components, setComponents] = useState<AnyComponent[]>([]);
  const [selectedComponentType, setSelectedComponentType] = useState<ComponentType | ''>('');
  const [quantityToAdd, setQuantityToAdd] = useState(1);
  const [systemInputs, setSystemInputs] = useState<SystemInputs>(defaultSystemInputs);
  const [reportNotes, setReportNotes] = useState('');

  // Derived lists
  const panels = components.filter((c: AnyComponent): c is IndividualSolarPanel => c.type === 'Individual Solar Panel');
  const arrays = components.filter((c: AnyComponent): c is SolarArrayConfiguration => c.type === 'Solar Array Configuration');
  const mppts = components.filter((c: AnyComponent): c is MpptChargeController => c.type === 'MPPT Charge Controller');
  const batteries = components.filter((c: AnyComponent): c is Battery => c.type === 'Battery');
  const inverters = components.filter((c: AnyComponent): c is Inverter => c.type === 'Inverter');

  const addComponents = useCallback(() => {
    if (!selectedComponentType) return;
  const newItems: AnyComponent[] = Array.from({ length: Math.max(1, quantityToAdd) }).map((_, idx) => {
      const base = {
        id: Date.now() + idx + Math.random(),
        type: selectedComponentType,
        name: `${selectedComponentType} ${components.filter(c => c.type === selectedComponentType).length + idx + 1}`,
        properties: {},
      } as AnyComponent;
      switch (selectedComponentType) {
        case 'Individual Solar Panel':
          base.properties = { voc: '', isc: '', vmp: '', imp: '', pmax: '', costUsd: '', tempCoeffVocPctPerC: '', tempCoeffPmaxPctPerC: '' } as IndividualSolarPanelProps; break;
        case 'Solar Array Configuration':
          base.properties = { selectedPanelId: '', panelsInSeries: '1', numberOfStrings: '1', assignedMpptId: '' } as SolarArrayConfigurationProps; break;
        case 'MPPT Charge Controller':
          base.properties = { maxInputVoltage: '', maxInputCurrent: '', maxOutputCurrent: '', nominalBatteryVoltage: '', costUsd: '' } as MpptChargeControllerProps; break;
        case 'Battery':
          base.properties = { nominalVoltage: '', capacityAh: '', maxChargeCurrent: '', maxDischargeCurrent: '', costUsd: '' } as BatteryProps; break;
        case 'Inverter':
          base.properties = { inputVoltageMin: '', inputVoltageMax: '', ratedPower: '', surgePower: '', efficiencyPct: '', idleDrawW: '', costUsd: '' } as InverterProps; break;
      }
      return base;
    });
  setComponents((prev: AnyComponent[]) => [...prev, ...newItems]);
    setSelectedComponentType('');
    setQuantityToAdd(1);
  }, [components, quantityToAdd, selectedComponentType]);

  const updateComponentProperty = useCallback((id: number, key: string, value: string) => {
    setComponents((prev: AnyComponent[]) => prev.map((c: AnyComponent) => {
      if (c.id !== id) return c;
      // Narrow by type and rebuild properties with correct shape
      switch (c.type) {
        case 'Individual Solar Panel':
          return { ...c, properties: { ...(c as IndividualSolarPanel).properties, [key]: value } } as IndividualSolarPanel;
        case 'Solar Array Configuration':
          return { ...c, properties: { ...(c as SolarArrayConfiguration).properties, [key]: value } } as SolarArrayConfiguration;
        case 'MPPT Charge Controller':
          return { ...c, properties: { ...(c as MpptChargeController).properties, [key]: value } } as MpptChargeController;
        case 'Battery':
          return { ...c, properties: { ...(c as Battery).properties, [key]: value } } as Battery;
        case 'Inverter':
          return { ...c, properties: { ...(c as Inverter).properties, [key]: value } } as Inverter;
        default:
          return c;
      }
    }));
  }, []);

  const updateComponentName = useCallback((id: number, name: string) => {
  setComponents((prev: AnyComponent[]) => prev.map((c: AnyComponent) => c.id === id ? { ...c, name } : c));
  }, []);

  const removeComponent = useCallback((id: number) => {
    setComponents((prev: AnyComponent[]) => prev
      .filter((c: AnyComponent) => c.id !== id)
      .map((c: AnyComponent) => {
        if (c.type === 'Solar Array Configuration' && c.properties.assignedMpptId === String(id)) {
          return { ...c, properties: { ...c.properties, assignedMpptId: '' } } as AnyComponent;
        }
        return c;
      })
    );
  }, []);

  const cloneComponent = useCallback((id: number) => {
    setComponents((prev: AnyComponent[]) => {
      const orig = prev.find((c: AnyComponent) => c.id === id);
      if (!orig) return prev;
      const timestamp = Date.now() + Math.random();
      if (orig.type === 'Solar Array Configuration') {
        const o = orig as SolarArrayConfiguration;
        const cloned: SolarArrayConfiguration = {
          ...o,
          id: timestamp,
          name: `${o.name} (Clone)`,
          properties: { ...o.properties, assignedMpptId: '' },
        };
        return [...prev, cloned];
      }
      // For other component types shallow clone is sufficient
      const cloned: AnyComponent = { ...orig, id: timestamp, name: `${orig.name} (Clone)` } as AnyComponent;
      return [...prev, cloned];
    });
  }, []);

  // Export / Import
  const exportData = useCallback(() => {
    const data = JSON.stringify({ components, systemInputs }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solar_setup.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [components, systemInputs]);

  const importData = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(String(e.target?.result));
        if (Array.isArray(parsed.components) && parsed.systemInputs) {
          // Basic sanitation: ensure properties exist as strings
          const cleanComponents = parsed.components.map((c: AnyComponent) => ({
            ...c,
            properties: Object.fromEntries(Object.entries(c.properties || {}).map(([k,v]) => [k, typeof v === 'number' ? String(v) : (v ?? '')]))
          }));
          setComponents(cleanComponents);
          setSystemInputs({ ...defaultSystemInputs, ...parsed.systemInputs });
        }
      } catch (err) {
        console.error('Import failed', err);
      }
    };
    reader.readAsText(file);
  }, []);

  // Calculations & Compatibility
  interface ComputedStats {
    totalSolarPower: number;
    estimatedDailySolarProductionWh: number;
    totalBatteryCapacity: number; // Ah
    totalBatteryEnergyWh: number;
    totalInverterPower: number;
    systemNominalVoltage: string;
    voltageConsistencyIssue: boolean;
    estimatedBatteryAutonomyDays: number;
    dailyEnergyBalanceWh: number;
    rechargeTimePshDays: number;
    rechargeTimeEffectiveSunHours: number;
    productionToConsumptionRatioPercentage: number | 'N/A';
  // Cable estimation
  panelInterconnectCables: number;
  arrayToChargerCables: number;
  chargerToBatteryCables: number;
  batteryInterconnectCables: number;
  batteryToInverterCables: number;
  totalEstimatedCables: number;
  }

  const stats: ComputedStats = useMemo(() => {
    let totalSolarPower = 0;
    let totalBatteryCapacity = 0;
    let totalInverterPower = 0;
    const batteryVoltages = new Set<number>();

    // Solar arrays contribute power
    arrays.forEach(arr => {
      const panel = panels.find(p => p.id === Number(arr.properties.selectedPanelId));
      if (!panel) return;
      const pmax = getNum(panel.properties.pmax);
      const inSeries = getNum(arr.properties.panelsInSeries);
      const strings = getNum(arr.properties.numberOfStrings);
      if (!isNaN(pmax) && !isNaN(inSeries) && !isNaN(strings)) {
        totalSolarPower += pmax * inSeries * strings; // simple multiplication
      }
    });

    batteries.forEach(b => {
      const cap = getNum(b.properties.capacityAh);
      const v = getNum(b.properties.nominalVoltage);
      if (!isNaN(cap)) totalBatteryCapacity += cap;
      if (!isNaN(v)) batteryVoltages.add(v);
    });

    inverters.forEach(inv => {
      const rated = getNum(inv.properties.ratedPower);
      if (!isNaN(rated)) totalInverterPower += rated;
    });

    let systemNominalVoltage = 'N/A';
    let voltageConsistencyIssue = false;
    if (batteryVoltages.size > 0) {
      systemNominalVoltage = String([...batteryVoltages][0]);
      if (batteryVoltages.size > 1) voltageConsistencyIssue = true;
    }

  const totalBatteryEnergyWhRaw = totalBatteryCapacity * systemInputs.systemWideVoltage;
  const totalBatteryEnergyWh = isFinite(totalBatteryEnergyWhRaw) ? totalBatteryEnergyWhRaw : 0;
    const estimatedDailySolarProductionWh = totalSolarPower * systemInputs.peakSunHours * (systemInputs.solarPanelEfficiency / 100);
    const usableBatteryEnergyWh = totalBatteryEnergyWh * (systemInputs.batteryDoD / 100);
    const energyNeededAdjustedWh = systemInputs.estimatedDailyUsageWh > 0 ? systemInputs.estimatedDailyUsageWh / (systemInputs.inverterEfficiency / 100) : 0;

    const estimatedBatteryAutonomyDays = (usableBatteryEnergyWh > 0 && energyNeededAdjustedWh > 0)
      ? usableBatteryEnergyWh / energyNeededAdjustedWh
      : 0;

    const dailyEnergyBalanceWh = estimatedDailySolarProductionWh - energyNeededAdjustedWh;

    let rechargeTimeEffectiveSunHours = 0;
    let rechargeTimePshDays = 0;
    if (totalSolarPower > 0 && usableBatteryEnergyWh > 0) {
      rechargeTimeEffectiveSunHours = (totalBatteryEnergyWh * (systemInputs.batteryDoD / 100)) / (totalSolarPower * (systemInputs.solarPanelEfficiency / 100));
      if (systemInputs.peakSunHours > 0) {
        rechargeTimePshDays = rechargeTimeEffectiveSunHours / systemInputs.peakSunHours;
      }
    }

    let productionToConsumptionRatioPercentage: number | 'N/A' = 0;
    if (energyNeededAdjustedWh > 0) {
      productionToConsumptionRatioPercentage = (estimatedDailySolarProductionWh / energyNeededAdjustedWh) * 100;
    } else if (estimatedDailySolarProductionWh > 0) {
      productionToConsumptionRatioPercentage = 'N/A';
    }

    const totalCost = components.reduce((sum, c) => {
      const costStr = (c as any).properties?.costUsd;
      const val = parseFloat(costStr || '');
      return sum + (isFinite(val) ? val : 0);
    }, 0);
    return {
      totalSolarPower,
      estimatedDailySolarProductionWh,
      totalBatteryCapacity,
      totalBatteryEnergyWh,
      totalInverterPower,
      systemNominalVoltage,
      voltageConsistencyIssue,
      estimatedBatteryAutonomyDays,
      dailyEnergyBalanceWh,
      rechargeTimePshDays,
      rechargeTimeEffectiveSunHours,
      productionToConsumptionRatioPercentage,
      // Cable estimation logic (simplified approximation)
      panelInterconnectCables: arrays.reduce((sum, arr) => {
        const inSeries = getNum(arr.properties.panelsInSeries);
        const strings = getNum(arr.properties.numberOfStrings);
        if (isNaN(inSeries) || isNaN(strings) || inSeries < 2 || strings < 1) return sum;
        // (panelsInSeries -1) connections per string
        return sum + (inSeries - 1) * strings;
      }, 0),
      arrayToChargerCables: arrays.reduce((sum, arr) => {
        const strings = getNum(arr.properties.numberOfStrings);
        if (isNaN(strings) || strings < 1) return sum;
        // one pos/neg pair per string => 2 cables each
        return sum + 2 * strings;
      }, 0),
      chargerToBatteryCables: mppts.length * 2, // one pos/neg pair per MPPT output
      batteryInterconnectCables: batteries.length > 1 ? (batteries.length - 1) * 2 : 0,
  batteryToInverterCables: inverters.length * 2,
      totalEstimatedCables: 0, // temp placeholder replaced below
    };
  }, [arrays, panels, batteries, inverters, systemInputs]);

  // Post-process total cable count (need stats object first)
  const statsWithCableTotal = useMemo(() => {
    return {
      ...stats,
      totalEstimatedCables: stats.panelInterconnectCables + stats.arrayToChargerCables + stats.chargerToBatteryCables + stats.batteryInterconnectCables + stats.batteryToInverterCables,
    };
  }, [stats]);

  // Compatibility messages (simplified vs original)
  interface CategorizedMessage { level: MessageLevel; text: string; }

  const messages: CategorizedMessage[] = useMemo(() => {
    const msgs: CategorizedMessage[] = [];
    const add = (level: MessageLevel, text: string) => msgs.push({ level, text: `${levelPrefixMap[level]} ${text}` });

    if (components.length === 0) add('info', 'Add components to start tracking your solar setup!');
    if (stats.voltageConsistencyIssue) add('error', 'Mixed battery voltages detected – unify bank voltage.');

    // Track unassigned arrays
    const unassignedArrays = arrays.filter(a => !a.properties.assignedMpptId);
    if (unassignedArrays.length > 0) {
      if (mppts.length > 0) add('warn', `${unassignedArrays.length} solar array(s) not assigned to any MPPT.`);
      else add('info', `${unassignedArrays.length} solar array(s) present but no MPPT controllers added; their power path is undefined.`);
    }

    // Compute aggregate MPPT output current for battery C-rate checks
    const totalMpptOutputCurrent = mppts.reduce((sum, m) => {
      const out = getNum(m.properties.maxOutputCurrent);
      return sum + (isNaN(out) ? 0 : out);
    }, 0);

    // MPPT related safety / sizing & safety margins
    mppts.forEach(mppt => {
      const maxInputV = getNum(mppt.properties.maxInputVoltage);
      const maxInputI = getNum(mppt.properties.maxInputCurrent);
      const maxOutI = getNum(mppt.properties.maxOutputCurrent);
      const battV = getNum(mppt.properties.nominalBatteryVoltage);
      const assigned = arrays.filter(a => a.properties.assignedMpptId === String(mppt.id));
      if (assigned.length === 0) add('warn', `${mppt.name} has no assigned solar arrays.`);
      let aggregateIsc = 0;
      let aggregatePmax = 0;
      assigned.forEach(a => {
        const panel = panels.find(p => p.id === Number(a.properties.selectedPanelId));
        if (!panel) return;
        const voc = getNum(panel.properties.voc);
        const isc = getNum(panel.properties.isc);
        const pmax = getNum(panel.properties.pmax);
        const inSeries = getNum(a.properties.panelsInSeries);
        const strings = getNum(a.properties.numberOfStrings);
        if (!isNaN(isc) && !isNaN(strings)) aggregateIsc += isc * strings;
        if (!isNaN(pmax) && !isNaN(inSeries) && !isNaN(strings)) aggregatePmax += pmax * inSeries * strings;
        if (!isNaN(voc) && !isNaN(inSeries) && !isNaN(maxInputV)) {
          const arrayVoc = voc * inSeries;
          // Immediate absolute limit
          if (arrayVoc > maxInputV) add('error', `${a.name} Voc (${arrayVoc.toFixed(1)}V) exceeds ${mppt.name} max input voltage (${maxInputV}V).`);
          else {
            // Safety margin evaluation
            if (arrayVoc * VOC_SAFETY_MARGIN_FACTOR_MIN > maxInputV) add('warn-safety', `${a.name} Voc headroom below minimum recommended 10% margin relative to ${mppt.name} (${arrayVoc.toFixed(1)}V vs ${maxInputV}V).`);
            else if (arrayVoc * VOC_SAFETY_MARGIN_FACTOR_IDEAL > maxInputV) add('info-safety', `${a.name} Voc margin < ideal 20% but >= minimum 10% (Voc ${arrayVoc.toFixed(1)}V, MPPT max ${maxInputV}V).`);
          }
        }
      });
      // Aggregate Isc vs max input current
      if (!isNaN(maxInputI) && maxInputI > 0) {
        if (aggregateIsc > maxInputI) add('error', `${mppt.name} total array Isc (${aggregateIsc.toFixed(2)}A) exceeds max input current (${maxInputI}A).`);
        else if (aggregateIsc > maxInputI * 0.9) add('warn-sizing', `${mppt.name} total array Isc (${aggregateIsc.toFixed(2)}A) >90% of max (${maxInputI}A).`);
      }
      // Aggregate Pmax vs theoretical output power
      if (!isNaN(maxOutI) && !isNaN(battV) && maxOutI > 0 && battV > 0) {
        const mpptPowerCap = maxOutI * battV;
        if (aggregatePmax > mpptPowerCap * 1.25) add('warn-sizing', `${mppt.name} array power (${aggregatePmax.toFixed(0)}W) >125% of est output capacity (~${mpptPowerCap.toFixed(0)}W). Significant clipping likely.`);
        else if (aggregatePmax > mpptPowerCap) add('info', `${mppt.name} slightly over-provisioned (array ${aggregatePmax.toFixed(0)}W vs ~${mpptPowerCap.toFixed(0)}W). Minor clipping expected.`);
      }
    });

    // Battery C-rate: charge & discharge
    batteries.forEach(b => {
      const capacityAh = getNum(b.properties.capacityAh);
      const maxCharge = getNum(b.properties.maxChargeCurrent);
      const maxDischarge = getNum(b.properties.maxDischargeCurrent);
      const nominalV = getNum(b.properties.nominalVoltage);
      if (!isNaN(capacityAh) && capacityAh > 0) {
        if (!isNaN(maxCharge) && maxCharge > 0) {
          if (totalMpptOutputCurrent > maxCharge) add('error', `${b.name} potential charge current (${totalMpptOutputCurrent.toFixed(1)}A) exceeds max charge current (${maxCharge}A).`);
          else if (totalMpptOutputCurrent > maxCharge * 0.9) add('warn-c-rate', `${b.name} charge current near limit (${totalMpptOutputCurrent.toFixed(1)}A / ${maxCharge}A).`);
        }
        if (!isNaN(maxDischarge) && maxDischarge > 0 && !isNaN(nominalV) && nominalV > 0) {
          const estDischargeCurrent = stats.totalInverterPower / nominalV;
          if (estDischargeCurrent > maxDischarge) add('error', `${b.name} estimated discharge current (${estDischargeCurrent.toFixed(1)}A) exceeds max discharge current (${maxDischarge}A).`);
          else if (estDischargeCurrent > maxDischarge * 0.9) add('warn-c-rate', `${b.name} discharge current near limit (${estDischargeCurrent.toFixed(1)}A / ${maxDischarge}A).`);
        }
      }
    });

    // Inverter DC input voltage range validation
    inverters.forEach(inv => {
      const vMin = getNum(inv.properties.inputVoltageMin);
      const vMax = getNum(inv.properties.inputVoltageMax);
      const sysV = systemInputs.systemWideVoltage;
      if (!isNaN(vMin) && sysV < vMin) add('error', `${inv.name} system voltage (${sysV}V) below inverter minimum (${vMin}V).`);
      else if (!isNaN(vMin) && sysV < vMin * 1.05) add('warn-sizing', `${inv.name} system voltage (${sysV}V) within 5% of minimum (${vMin}V).`);
      if (!isNaN(vMax) && sysV > vMax) add('error', `${inv.name} system voltage (${sysV}V) exceeds inverter maximum (${vMax}V).`);
      else if (!isNaN(vMax) && sysV > vMax * 0.95) add('warn-sizing', `${inv.name} system voltage (${sysV}V) within 5% of maximum (${vMax}V).`);
    });

    // Production / usage & autonomy notes
    if (stats.totalSolarPower === 0 && arrays.length > 0) add('warn', 'Arrays configured but no valid panel pmax values.');
    if (systemInputs.estimatedDailyUsageWh === 0 && components.length > 0) add('warn', 'Daily usage is 0; production metrics may be misleading.');
    if (stats.estimatedBatteryAutonomyDays < 0.5 && stats.estimatedBatteryAutonomyDays > 0) add('warn-sizing', 'Battery autonomy < 0.5 days; consider more storage or reducing load.');
    if (stats.productionToConsumptionRatioPercentage !== 'N/A' && typeof stats.productionToConsumptionRatioPercentage === 'number') {
      if (stats.productionToConsumptionRatioPercentage < 80) add('warn-sizing', 'Solar production <80% of adjusted consumption; expect deficit.');
      else if (stats.productionToConsumptionRatioPercentage > 150) add('info', 'Solar production >150% of adjusted consumption; consider more storage or curtailment strategy.');
    }

    // General info & safety notes
    add('info', 'Calculations assume ideal wiring; account for voltage drop, temperature, and conversion losses.');
    add('info-safety', 'Always size conductors and protection (fuses/breakers) to NEC/IEC standards and manufacturer specs.');

    // Final summary
    const hasErrors = msgs.some(m => m.level === 'error');
    const hasWarnings = msgs.some(m => m.level.startsWith('warn'));
    if (components.length > 0) {
      if (hasErrors) add('error', 'Critical errors found! Resolve red items first; then address warnings.');
      else if (hasWarnings) add('warn', 'Warnings present. System may operate but with risk/inefficiency. Review above notes.');
      else add('info', 'System configuration appears compatible based on current checks.');
    }
    return msgs;
  }, [components, stats, arrays, mppts, panels, systemInputs.estimatedDailyUsageWh, stats.productionToConsumptionRatioPercentage, systemInputs.systemWideVoltage]);

  // Handlers
  const handleSystemInput = (key: keyof SystemInputs, value: number) => {
  setSystemInputs((prev: SystemInputs) => ({ ...prev, [key]: value }));
  };

  // PDF export
  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const marginX = 14;
    const marginY = 14;
    const lineH = 6;
    let y = marginY;
    let page = 1;

    const pageFooter = () => {
      doc.setFontSize(9);
      doc.setTextColor(130,130,130);
      doc.text(`Page ${page}`, 105, 292, { align: 'center' });
      doc.setTextColor(0,0,0);
    };
    const newPage = () => {
      pageFooter();
      doc.addPage();
      page += 1;
      y = marginY;
      header(true);
    };
    const ensure = (needed = lineH) => { if (y + needed > 285) newPage(); };
    const line = (txt: string, opts?: { color?: [number,number,number]; bold?: boolean; size?: number }) => {
      const { color, bold, size } = opts || {};
      ensure();
      if (size) doc.setFontSize(size); else doc.setFontSize(11);
      if (bold) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal');
      if (color) doc.setTextColor(...color); else doc.setTextColor(30,30,30);
      doc.text(txt, marginX, y);
      y += lineH;
      // reset style side-effects
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(30,30,30);
    };
    const section = (title: string) => {
      ensure(lineH * 2);
      line(title, { bold: true, size: 14 });
      doc.setDrawColor(50,90,160);
      doc.setLineWidth(0.4);
      doc.line(marginX, y - 2, 200 - marginX, y - 2);
      y += 2;
    };
    const keyValuesTable = (pairs: Array<[string,string]>) => {
      const labelW = 70; // mm allocated to label column
      const totalUsable = 200 - marginX * 2;
      const valueW = totalUsable - labelW - 4;
      pairs.forEach(([k,v]) => {
        const label = `${k}:`;
        const labelLines = doc.splitTextToSize(label, labelW) as string[];
        const valueLines = doc.splitTextToSize(String(v), valueW) as string[];
        const rowLines = Math.max(labelLines.length, valueLines.length);
        ensure(rowLines * lineH);
        for (let i=0;i<rowLines;i++) {
          const ly = y + i * lineH;
          if (i < labelLines.length) {
            doc.setFont('helvetica','bold');
            doc.text(labelLines[i], marginX, ly);
          }
          if (i < valueLines.length) {
            doc.setFont('helvetica','normal');
            doc.text(valueLines[i], marginX + labelW + 4, ly);
          }
        }
        y += rowLines * lineH;
        // spacer line
      });
    };
    const header = (continuation = false) => {
      doc.setFontSize(18);
  doc.setFont('helvetica','bold');
      doc.setTextColor(20,60,120);
      doc.text('Solar System Report', marginX, y);
      doc.setFontSize(10);
  doc.setFont('helvetica','normal');
      doc.setTextColor(100,100,100);
      doc.text(new Date().toLocaleString() + (continuation? ' (cont.)':''), marginX, y + 5);
      y += 14;
      doc.setTextColor(0,0,0);
    };

    header();

    if (reportNotes) {
      section('Notes');
      const notesLines = doc.splitTextToSize(reportNotes, 200 - marginX * 2);
  (notesLines as string[]).forEach((t: string) => line(t));
    }

    section('System Inputs');
  keyValuesTable(Object.entries(systemInputs).map(([k,v])=>[k,String(v)]));

    section('Key Statistics');
  keyValuesTable([
      ['Total Solar Power (W)', stats.totalSolarPower.toFixed(2)],
      ['Daily Production (Wh)', stats.estimatedDailySolarProductionWh.toFixed(0)],
      ['Battery Energy (Wh)', stats.totalBatteryEnergyWh.toFixed(0)],
      ['Autonomy (days)', stats.estimatedBatteryAutonomyDays.toFixed(2)],
      ['Daily Energy Balance (Wh)', stats.dailyEnergyBalanceWh.toFixed(0)],
      ['Recharge Time (PSH Days)', stats.rechargeTimePshDays.toFixed(2)],
    ]);

    section('Components');
    const grouped = components.reduce<Record<string, typeof components>>( (acc, c) => { (acc[c.type] ||= [] ).push(c); return acc; }, {} as any);
    Object.entries(grouped).forEach(([type, list]) => {
      line(type, { bold: true, color: [60,80,150] });
      list.forEach(c => {
        ensure(lineH * 2);
        line(`• ${c.name}`, { bold: true, size: 11 });
        const props = Object.entries(c.properties).slice(0,10);
        props.forEach(([pk,pv]) => line(`   - ${pk}: ${pv}`));
      });
      y += 2;
    });

    section('Messages (Top 40)');
    const colorMap: Record<string,[number,number,number]> = {
      error: [180,0,0],
      'warn-safety': [180,90,0],
      'warn-sizing': [150,100,0],
      'warn-c-rate': [150,100,0],
      warn: [160,120,0],
      'info-safety': [0,110,110],
      info: [0,90,0],
    };
    messages.slice(0,40).forEach(m => {
      const parts = doc.splitTextToSize(m.text, 200 - marginX*2) as string[];
      parts.forEach((p: string, i: number)=> line((i===0?'• ':'   ') + p, { color: colorMap[m.level] || [0,0,0] }));
    });
    if (messages.length > 40) line(`(Truncated ${messages.length - 40} additional messages)`, { color: [120,120,120] });

    pageFooter();

    const ts = new Date().toISOString().replace(/[:T]/g,'-').slice(0,16);
    doc.save(`solar_system_report_${ts}.pdf`);
  };

  // Render Helpers
  const renderPropertyInputs = (component: AnyComponent) => {
    const entries = Object.entries(component.properties);
    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {entries.map(([key, val]) => {
          // Dropdown relations
          if (component.type === 'Solar Array Configuration' && (key === 'selectedPanelId' || key === 'assignedMpptId')) {
            const options = key === 'selectedPanelId' ? panels : mppts;
            return (
              <label key={key} className="flex flex-col text-xs">
                <span className="font-medium mb-0.5" title={propertyDescriptions[key] || ''}>{key}</span>
                <select
                  className="border rounded px-2 py-1 text-xs"
                  value={val}
                  onChange={e => updateComponentProperty(component.id, key, e.target.value)}
                >
                  <option value="">-- select --</option>
                  {options.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <label key={key} className="flex flex-col text-xs">
              <span className="font-medium mb-0.5" title={propertyDescriptions[key] || ''}>{key}</span>
              <input
                className="border rounded px-2 py-1 text-xs"
                value={val}
                onChange={e => updateComponentProperty(component.id, key, e.target.value)}
                placeholder={key}
              />
            </label>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-4xl font-bold text-center mb-8">Solar Setup Tracker</h1>

      {/* Export / Import */}
      <div className="mb-8 p-4 bg-gray-100 rounded flex flex-wrap gap-4 justify-center">
        <button onClick={exportData} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-6 rounded shadow">
          Export Setup
        </button>
        <label className="bg-purple-600 hover:bg-purple-700 cursor-pointer text-white font-semibold py-2 px-6 rounded shadow">
          <input type="file" accept=".json" className="hidden" onChange={e => e.target.files && importData(e.target.files[0])} />
          Import Setup
        </label>
        <button onClick={exportPdf} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-6 rounded shadow">Export PDF Report</button>
      </div>


      {/* Add Component */}
      <div className="mb-8 p-6 bg-blue-50 rounded">
        <h2 className="text-2xl font-semibold mb-4">Add New Component</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Select Type:</label>
            <select
              value={selectedComponentType}
              onChange={e => setSelectedComponentType(e.target.value as ComponentType | '')}
              className="border rounded px-3 py-2"
            >
              <option value="">-- choose --</option>
              {componentTypeOptions.map(ct => <option key={ct} value={ct}>{ct}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantity:</label>
            <input type="number" value={quantityToAdd} min={1} onChange={e => setQuantityToAdd(Number(e.target.value) || 1)} className="border rounded px-3 py-2 w-24" />
          </div>
          <button onClick={addComponents} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-5 rounded shadow">Add Component(s)</button>
        </div>
      </div>

      {/* Components List */}
      {components.length > 0 && (
        <div className="mb-8 p-6 bg-gray-50 rounded">
          <h2 className="text-2xl font-semibold mb-4">Your Components</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {components.map(c => (
              <div key={c.id} className="bg-white rounded border p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <input
                    value={c.name}
                    onChange={e => updateComponentName(c.id, e.target.value)}
                    className="font-semibold text-sm border-b focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => cloneComponent(c.id)} className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-2 py-1 rounded">Clone</button>
                    <button onClick={() => removeComponent(c.id)} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded">Remove</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-2">{c.type}</p>
                {renderPropertyInputs(c)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System Inputs */}
      <div className="p-6 bg-blue-50 rounded mb-8">
        <h2 className="text-2xl font-semibold mb-4">System Overview & Inputs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 mb-6 items-start">
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>Avg Daily Peak Sun Hours</span>
            <input type="number" value={systemInputs.peakSunHours} min={0} step={0.1} onChange={e => handleSystemInput('peakSunHours', Number(e.target.value) || 0)} className="border rounded px-2 py-1 w-full" />
          </label>
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>Daily Usage (Wh)</span>
            <input type="number" value={systemInputs.estimatedDailyUsageWh} min={0} onChange={e => handleSystemInput('estimatedDailyUsageWh', Number(e.target.value) || 0)} className="border rounded px-2 py-1 w-full" />
          </label>
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>Battery Usable DoD (%)</span>
            <input type="number" value={systemInputs.batteryDoD} min={1} max={100} onChange={e => handleSystemInput('batteryDoD', Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="border rounded px-2 py-1 w-full" />
          </label>
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>Inverter Efficiency (%)</span>
            <input type="number" value={systemInputs.inverterEfficiency} min={1} max={100} onChange={e => handleSystemInput('inverterEfficiency', Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="border rounded px-2 py-1 w-full" />
          </label>
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>Solar Performance Factor (%)</span>
            <input type="number" value={systemInputs.solarPanelEfficiency} min={1} max={100} onChange={e => handleSystemInput('solarPanelEfficiency', Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="border rounded px-2 py-1 w-full" />
          </label>
          <label className="text-sm flex flex-col w-full min-w-0">
            <span>System Wide Voltage (V)</span>
            <input type="number" value={systemInputs.systemWideVoltage} min={12} step={1} onChange={e => handleSystemInput('systemWideVoltage', Number(e.target.value) || 12)} className="border rounded px-2 py-1 w-full" />
          </label>
        </div>

        <h3 className="text-xl font-semibold mb-3">Calculated System Statistics</h3>
        <div className="space-y-1 text-sm">
          <p><strong>Total Solar Array Power:</strong> {stats.totalSolarPower.toFixed(2)} W</p>
          <p><strong>Estimated Daily Solar Production:</strong> {stats.estimatedDailySolarProductionWh.toFixed(2)} Wh ({(stats.estimatedDailySolarProductionWh / 1000).toFixed(2)} kWh/day)</p>
          <p><strong>Total Battery Capacity:</strong> {stats.totalBatteryCapacity.toFixed(2)} Ah</p>
            <p><strong>Total Battery Energy:</strong> {stats.totalBatteryEnergyWh.toFixed(2)} Wh ({(stats.totalBatteryEnergyWh / 1000).toFixed(2)} kWh)</p>
          <p><strong>Total Inverter Rated Power:</strong> {stats.totalInverterPower.toFixed(2)} W</p>
          <p><strong>System Nominal Voltage:</strong> {stats.systemNominalVoltage} {stats.voltageConsistencyIssue && <span className="text-red-600 ml-2">(Error: Mixed battery voltages!)</span>}</p>
          <p><strong>Estimated Battery Autonomy:</strong> {stats.estimatedBatteryAutonomyDays.toFixed(2)} Days</p>
          <p><strong>Daily Energy Balance:</strong> {stats.dailyEnergyBalanceWh.toFixed(2)} Wh ({(stats.dailyEnergyBalanceWh / 1000).toFixed(2)} kWh)</p>
          <p><strong>Est. Battery Recharge Time (from DoD):</strong> {stats.rechargeTimePshDays.toFixed(2)} PSH-Days ({stats.rechargeTimeEffectiveSunHours.toFixed(2)} effective sun hours)</p>
          <p><strong>Solar Production vs. Consumption:</strong> {stats.estimatedDailySolarProductionWh.toFixed(2)} Wh / {(systemInputs.estimatedDailyUsageWh / (systemInputs.inverterEfficiency / 100) || 0).toFixed(2)} Wh = {stats.productionToConsumptionRatioPercentage === 'N/A' ? 'N/A (No load)' : (stats.productionToConsumptionRatioPercentage as number).toFixed(1)}%</p>
          <details className="pt-2 border-t border-gray-200 mt-2 group">
            <summary className="font-semibold cursor-pointer text-gray-700 hover:text-blue-600">Cable Count Estimate</summary>
            <ul className="mt-2 pl-5 list-disc space-y-0.5 text-xs text-gray-600">
              <li>Panel Interconnect Cables: {statsWithCableTotal.panelInterconnectCables}</li>
              <li>Array to Charger Cables (pos/neg pairs per string): {statsWithCableTotal.arrayToChargerCables}</li>
              <li>Charger to Battery Cables: {statsWithCableTotal.chargerToBatteryCables}</li>
              <li>Battery Interconnect Cables: {statsWithCableTotal.batteryInterconnectCables}</li>
              <li>Battery to Inverter Cables: {statsWithCableTotal.batteryToInverterCables}</li>
              <li className="font-medium">Total Estimated Primary Cables: {statsWithCableTotal.totalEstimatedCables}</li>
            </ul>
            <p className="text-[10px] text-gray-500 mt-1 pl-5">Simplified count of primary power connection cables. Does not include grounding, communication, or exact lengths/gauges.</p>
          </details>
          <div className="mt-4">
            <label className="text-xs font-medium">Report Notes</label>
            <textarea value={reportNotes} onChange={e=>setReportNotes(e.target.value)} className="w-full border rounded text-xs p-2" rows={2} placeholder="Extra notes to include in PDF report" />
          </div>
        </div>
      </div>

      {/* Compatibility Messages */}
      <div className="p-6 bg-green-50 rounded mb-8">
        <h2 className="text-2xl font-semibold mb-4">Compatibility Checks & Notes</h2>
        <div className="space-y-2 text-sm">
          {messages.map((m, idx) => {
            const cls = m.level === 'error'
              ? 'bg-red-100 text-red-800 border-red-300'
              : m.level === 'warn-safety'
                ? 'bg-orange-100 text-orange-800 border-orange-300'
                : (m.level === 'warn-sizing' || m.level === 'warn-c-rate')
                  ? 'bg-amber-100 text-amber-800 border-amber-300'
                  : m.level === 'warn'
                    ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                    : m.level === 'info-safety'
                      ? 'bg-teal-100 text-teal-800 border-teal-300'
                      : 'bg-green-100 text-green-800 border-green-300';
            return <p key={idx} className={`p-2 rounded border shadow-sm ${cls}`}>{m.text}</p>;
          })}
        </div>
      </div>
    </div>
  );
};
