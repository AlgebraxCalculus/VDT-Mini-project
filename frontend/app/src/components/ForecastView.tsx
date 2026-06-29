import { useEffect, useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { STATIONS, EVENTS, forecast7d, riskMeta, floodLevel } from '../data/mockData';
import { apiListRiskStations, apiListStations } from '../lib/api';
import type { RiskAssessment } from '../types';

/** One rendered table row: a station with its 7-day risk sparkline + peak. */
interface FcRow {
  id: number;
  stationCode: string;
  name: string;
  provinceName: string;
  score: number; // today's risk score (0–100)
  spark: { color: string; h: string }[];
  peakDay: string;
  peakVal: number;
  riskColor: string;
  riskLabel: string;
}

const VN_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** One sparkline bar from a 0–100 score: colour by band, height proportional. */
const sparkBar = (score: number) => ({ color: floodLevel(score).color, h: `${3 + score * 0.24}px` });

function weekday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr.slice(5) : VN_WEEKDAYS[d.getDay()];
}

/** Mock rows — the initial render + fallback when API 36 is unavailable/empty. */
function buildMockRows(): FcRow[] {
  return STATIONS.map((s) => {
    const score = s.riskScore ?? 0;
    const f = forecast7d(score);
    let peak = f[0];
    let pi = 0;
    f.forEach((d, i) => {
      if (d.val > peak.val) {
        peak = d;
        pi = i;
      }
    });
    const meta = riskMeta(s.riskStatus);
    return {
      id: s.id,
      stationCode: s.stationCode,
      name: s.name,
      provinceName: s.province?.name ?? '—',
      score,
      spark: f.map((d) => sparkBar(d.val)),
      peakDay: f[pi].day,
      peakVal: peak.val,
      riskColor: meta.color,
      riskLabel: meta.label,
    };
  }).sort((a, b) => b.peakVal - a.peakVal);
}

/**
 * Group API 36 rows (one per station × forecast day) into one row per station:
 * the per-day scores become the sparkline; "today" = the first day in the
 * window; peak = the highest-scoring day. Risk colour/label come from the
 * station's cached risk_status (joined on the assessment).
 */
function buildApiRows(data: RiskAssessment[]): FcRow[] {
  const byStation = new Map<number, RiskAssessment[]>();
  for (const a of data) {
    const arr = byStation.get(a.stationId);
    if (arr) arr.push(a);
    else byStation.set(a.stationId, [a]);
  }
  const rows: FcRow[] = [];
  byStation.forEach((arr) => {
    arr.sort((x, y) => x.forecastDate.localeCompare(y.forecastDate));
    const station = arr[0].station;
    const scores = arr.map((a) => a.riskScore ?? 0);
    const today = scores[0] ?? 0;
    let peakVal = today;
    let pi = 0;
    scores.forEach((v, i) => {
      if (v > peakVal) {
        peakVal = v;
        pi = i;
      }
    });
    const meta = riskMeta(station?.riskStatus ?? null);
    rows.push({
      id: arr[0].stationId,
      stationCode: station?.stationCode ?? `#${arr[0].stationId}`,
      name: station?.name ?? '—',
      provinceName: station?.province?.name ?? '—',
      score: Math.round(today),
      spark: scores.map((v) => sparkBar(v)),
      peakDay: weekday(arr[pi].forecastDate),
      peakVal: Math.round(peakVal),
      riskColor: meta.color,
      riskLabel: meta.label,
    });
  });
  return rows.sort((a, b) => b.peakVal - a.peakVal);
}

export default function ForecastView() {
  const { patch, showToast } = useApp();

  const [rows, setRows] = useState<FcRow[]>(buildMockRows);
  const [live, setLive] = useState(false);
  const [total, setTotal] = useState<number>(STATIONS.length);

  // Load the at-risk station list from API 36 (grouped per station) + the total
  // station count from Group C. Keep the mock rows already on screen if the call
  // fails or returns nothing (the Risk Engine may not have run yet). setState
  // only happens in async callbacks — never synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    apiListRiskStations({ size: 100, sort: 'severity', includeLow: true })
      .then((res) => {
        if (cancelled) return;
        const built = buildApiRows(res.data);
        if (built.length > 0) {
          setRows(built);
          setLive(true);
        }
      })
      .catch(() => {
        /* keep mock rows as fallback */
      });
    apiListStations({ size: 1 })
      .then((res) => {
        if (!cancelled) setTotal(res.total);
      })
      .catch(() => {
        /* keep mock count as fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fcHigh = rows.filter((r) => r.peakVal >= 50).length;
  const fcVeryHigh = rows.filter((r) => r.peakVal >= 70).length;
  const fcActiveEvents = EVENTS.filter((e) => e.state === 'active' || e.state === 'monitor').length;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 1260, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Trạm theo dõi</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{total}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Trên toàn mạng lưới</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px', borderLeft: '3px solid #F97316' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Nguy cơ Cao</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4, color: '#F97316' }}>{fcHigh}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Chỉ số ≥ 50 trong 5–7 ngày</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px', borderLeft: '3px solid #EE0033' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Nguy cơ Rất cao</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4, color: '#EE0033' }}>{fcVeryHigh}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Cần ứng cứu ưu tiên</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Sự kiện đang hoạt động</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{fcActiveEvents}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Bão / mưa lớn / lũ</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Danh sách trạm nguy cơ ngập</div>
          <span style={{ fontSize: 12, color: '#9AA0A6' }}>· sắp xếp theo chỉ số rủi ro</span>
          <span
            title={live ? 'Đang lấy từ API /risk/stations' : 'Risk Engine chưa có dữ liệu — đang hiển thị dữ liệu mẫu'}
            style={{ fontSize: 11, fontWeight: 700, color: live ? '#16794A' : '#6B7280', background: live ? '#F3FBF6' : '#F1F2F4', border: `1px solid ${live ? '#CDEBD8' : '#E2E5EA'}`, padding: '2px 8px', borderRadius: 7 }}
          >
            {live ? 'Dữ liệu trực tiếp' : 'Dữ liệu mẫu'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => showToast('Đang tạo báo cáo nguy cơ (Word)… sẽ tải về khi hoàn tất.')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 14px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            Xuất Word
          </button>
          <button
            onClick={() => showToast('Đang tạo báo cáo nguy cơ (PDF)… sẽ tải về khi hoàn tất.')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', border: 'none', background: '#EE0033', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(238,0,51,.24)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v11m0 0l-4-4m4 4l4-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Xuất báo cáo PDF
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px 80px 160px 96px 96px', gap: 12, padding: '12px 18px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 11.5, fontWeight: 700, color: '#8A9099', letterSpacing: 0.3, textTransform: 'uppercase' }}>
            <span>Mã trạm</span><span>Tên trạm</span><span>Tỉnh / thành</span><span>Hôm nay</span><span>Xu hướng 7 ngày</span><span>Ngày đỉnh</span><span style={{ textAlign: 'right' }}>Mức</span>
          </div>
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => patch({ route: 'map', selectedId: r.id })}
              style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px 80px 160px 96px 96px', gap: 12, padding: '11px 18px', border: 'none', borderBottom: '1px solid #F2F3F5', background: '#fff', cursor: 'pointer', alignItems: 'center', textAlign: 'left', width: '100%' }}
            >
              <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{r.stationCode}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span style={{ fontSize: 12.5, color: '#6B7280' }}>{r.provinceName}</span>
              <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: r.riskColor }}>{r.score}</span>
              <span style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 30 }}>
                {r.spark.map((d, i) => (
                  <span key={i} style={{ flex: 1, borderRadius: 2, background: d.color, height: d.h, minHeight: 3 }} />
                ))}
              </span>
              <span style={{ fontSize: 12, color: '#6B7280', fontFamily: "'IBM Plex Mono',monospace" }}>{r.peakDay} · {r.peakVal}</span>
              <span style={{ textAlign: 'right' }}>
                <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#fff', background: r.riskColor, padding: '3px 9px', borderRadius: 7 }}>{r.riskLabel}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
