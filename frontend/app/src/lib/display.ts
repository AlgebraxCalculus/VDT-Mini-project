// Presentation helpers for risk/flood display — labels, colours, legends, threshold lookups.
import type { RiskStatus, Threshold } from '../types';

// Risk scores are on the backend 0–100 scale; bands mirror the engine's classifier.
export function band(r: number): [string, string] {
  if (r < 10) return ['Thấp', '#94A3B8'];
  if (r < 30) return ['Chú ý', '#16A34A'];
  if (r < 60) return ['Trung bình', '#EAB308'];
  if (r < 80) return ['Cao', '#F97316'];
  return ['Rất cao', '#EE0033'];
}

/** Label + colour for a RiskStatus enum value. */
export const RISK_META: Record<RiskStatus, { label: string; color: string }> = {
  NORMAL: { label: 'An toàn', color: '#16A34A' },
  WATCH: { label: 'Theo dõi', color: '#EAB308' },
  WARNING: { label: 'Cảnh báo', color: '#F97316' },
  DANGER: { label: 'Nguy hiểm', color: '#EE0033' },
};

export const riskMeta = (rs: RiskStatus | null) => RISK_META[rs ?? 'NORMAL'];

/** Read a threshold tier by alert level, null-safe (stations may have 0–3). */
export const thresholdAt = (thresholds: Threshold[], level: 1 | 2 | 3): number | null =>
  thresholds.find((t) => t.alertLevel === level)?.thresholdValue ?? null;

/** Map a 0–100 flood-risk score to its legend band (colour + label); see FLOOD_LEGEND. */
export function floodLevel(score: number): { color: string; label: string } {
  if (score >= 80) return { color: '#EE0033', label: 'Rất cao' };
  if (score >= 60) return { color: '#F97316', label: 'Cao' };
  if (score >= 30) return { color: '#EAB308', label: 'Trung bình' };
  if (score >= 10) return { color: '#16A34A', label: 'Chú ý' };
  return { color: '#94A3B8', label: 'Thấp' };
}

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** Short Vietnamese weekday label for a YYYY-MM-DD / ISO date. */
export const forecastDayLabel = (iso: string) => DOW[new Date(iso).getDay()] ?? '';

export const FLOOD_LEGEND = [
  { c: '#94A3B8', label: 'Thấp', range: '<10' },
  { c: '#16A34A', label: 'Chú ý', range: '10–30' },
  { c: '#EAB308', label: 'Trung bình', range: '30–60' },
  { c: '#F97316', label: 'Cao', range: '60–80' },
  { c: '#EE0033', label: 'Rất cao', range: '≥80' },
];

export const WEATHER_LEGENDS: Record<string, { title: string; gradient: string; ticks: string[] }> = {
  temp: { title: 'Nhiệt độ không khí (°C)', gradient: 'linear-gradient(90deg,#2563EB,#22C55E,#EAB308,#F97316,#EF4444)', ticks: ['10°', '20°', '30°', '40°'] },
  rain: { title: 'Lượng mưa 1 giờ (mm)', gradient: 'linear-gradient(90deg,#DBEAFE,#3B82F6,#7C3AED)', ticks: ['0', '5', '15', '≥30'] },
  radar: { title: 'Radar mưa (3 giờ gần đây)', gradient: 'linear-gradient(90deg,#EDE9FE,#8B5CF6,#6D28D9)', ticks: ['Nhẹ', 'TB', 'To', 'Rất to'] },
  wind: { title: 'Tốc độ gió (m/s)', gradient: 'linear-gradient(90deg,#E0F2FE,#38BDF8,#EC4899)', ticks: ['0', '5', '10', '≥20'] },
};
