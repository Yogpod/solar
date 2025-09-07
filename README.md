## ArrayForge

This is a tool to sketch and sanity‑check a small/off‑grid solar system. You add panels, group them into arrays, assign arrays to MPPT charge controllers, define batteries and an inverter, and it gives you quick numbers: expected daily production, battery energy, autonomy, energy balance, rough recharge time, and a set of warnings if something looks off (like panel Voc too close to a controller's limit or a battery current limit being exceeded).

### Description
- Lets you add / clone / remove five component types.
- Tracks basic electrical fields (panel STC values, MPPT limits, battery capacity & current limits, inverter window & power).
- Lets you set system‑wide assumptions (sun hours, load Wh/day, battery usable depth, efficiencies, nominal voltage).
- Computes: total array watts, estimated daily Wh, battery Wh & autonomy (days), daily surplus/deficit, crude recharge time, production vs adjusted load.
- Flags: voltage headroom, potential clipping, over/near charge & discharge current, inverter voltage mismatch, under‑sized production.
- Gives a rough cable count (for perspective, not design).
- Exports/imports JSON and produces a readable PDF report.

### An Example
Four 200 W panels in 2S2P (2 in series × 2 strings) → 800 W array. At 4.5 peak sun hours and an 80% performance factor you get roughly 800 × 4.5 × 0.8 ≈ 2880 Wh/day before other losses. If your adjusted load (after inverter efficiency) is 2200 Wh, you have margin; if it's 3500 Wh, you'll see warnings.

### Things intentionally NOT added yet
- Persistent storage (refresh = clean slate unless you export)
- Charts (might add a simple production vs load graph later)
- Economic/payback modeling (helpers exist but UI was removed for clarity)
- Wire gauge / voltage drop UI (helpers scaffolded)

## Getting Started
Install dependencies and start the dev server:
```bash
npm install
npm run dev
```
Open the shown local URL (default: http://localhost:5173/).

## Build & Preview Production
```bash
npm run build
npm run preview
```

## Usage Guide
1. Add at least one Individual Solar Panel with STC values (Voc / Isc / Vmp / Imp / Pmax).
2. Create a Solar Array Configuration: choose the panel, set panelsInSeries & numberOfStrings, optionally assign to an MPPT (after you add one).
3. Add an MPPT Charge Controller; fill max input voltage/current and maximum output (charge) current plus nominal battery voltage.
4. Add Battery entries (voltage, capacity Ah, max charge & discharge current).
5. Add an Inverter (input voltage window & rated power).
6. Adjust System Inputs (sun hours, load, DoD, efficiencies).
7. Review Calculated Statistics and Compatibility Messages. Resolve red errors first; then address warnings.
8. Export JSON or generate a PDF report for documentation.

## Data Model
| Type | Key Fields |
|------|------------|
| Individual Panel | voc, isc, vmp, imp, pmax (+ optional cost & temp coeffs) |
| Solar Array Configuration | selectedPanelId, panelsInSeries, numberOfStrings, assignedMpptId |
| MPPT | maxInputVoltage, maxInputCurrent, maxOutputCurrent, nominalBatteryVoltage |
| Battery | nominalVoltage, capacityAh, maxChargeCurrent, maxDischargeCurrent |
| Inverter | inputVoltageMin, inputVoltageMax, ratedPower, surgePower (+ optional efficiencyPct / idleDrawW) |

## Calculations
- Array Power = Σ (panel Pmax × panelsInSeries × strings)
- Daily Production (Wh) = Total Array Power × Peak Sun Hours × (Solar Performance Factor %)
- Battery Energy (Wh) = Σ(capacityAh) × System Nominal Voltage (guarded against NaN)
- Usable Battery Energy = Battery Energy × DoD%
- Autonomy (days) = Usable Battery Energy / Adjusted Daily Load (load ÷ inverter efficiency)
- Recharge Effective Sun Hours ≈ (Battery Energy × DoD%) / (Array Power × Performance Factor)
- Headroom & safety margins: compares string Voc to MPPT max input

## Limitations / Known Gaps
- Battery energy uses summed Ah × a single system voltage (mixed voltages flagged but not individually energy‑weighted)
- Temperature & degradation helpers not yet applied to visible production metrics
- No persistence between browser sessions (JSON export/import only)
- Wire sizing, voltage drop UI, fuse sizing, and economic metrics currently not exposed
- No unit tests yet

## Roadmap Ideas
- [ ] Dropdown voltage menu
- [ ] Per‑battery energy aggregation (capacityAh × its own voltage)
- [ ] Local storage autosave & versioned snapshots
- [ ] Optional inclusion toggles in PDF (select sections)
- [ ] PWA offline support & state migrations
- [ ] Temperature adjusted Voc & Pmax in live calculations
- [ ] Voltage drop + wire gauge recommendation UI
- [ ] Basic charts (daily production vs usage, autonomy trend)

## Development Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build (dist/) |
| `npm run preview` | Preview built assets |
| `npm run lint` | Lint TypeScript/React source |

## Contributing
If you want to help: open an issue. Put new numeric logic inside `src/calculations.ts`. Please explain any assumptions in a brief comment. 

Questions or feature requests? Open an issue or tweak and submit a PR.
