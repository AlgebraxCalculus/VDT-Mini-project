import { useEffect, useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { riskMeta, floodLevel } from '../lib/display';
import { ApiError, apiGetStationForecast, apiListEvents, apiListRiskStations, apiListStations } from '../lib/api';
import { exportReport } from '../lib/report';
import type { ClassifiedForecastPoint, RiskAssessment } from '../types';

// Top at-risk stations shown; each gets a full day-series fetched for its sparkline.
const TOP_N = 24;
// Forecast horizon rendered in the trend sparkline.
const FORECAST_DAYS = 5;

/** A station row with its full-window risk sparkline + peak. */
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

// API 36 pages per station×day (partial days per station); API 38 supplies the full
// series the sparkline needs. Ranking record carries the meta, series carries the bars.
function buildRow(a: RiskAssessment, series: ClassifiedForecastPoint[]): FcRow {
  const station = a.station;
  const scores = series.length ? series.map((p) => p.riskScore ?? 0) : [Math.round(a.riskScore ?? 0)];
  const dates = series.length ? series.map((p) => p.date) : [a.forecastDate];
  let peakVal = scores[0] ?? 0;
  let pi = 0;
  scores.forEach((v, i) => {
    if (v > peakVal) {
      peakVal = v;
      pi = i;
    }
  });
  const meta = riskMeta(station?.riskStatus ?? null);
  return {
    id: a.stationId,
    stationCode: station?.stationCode ?? `#${a.stationId}`,
    name: station?.name ?? '—',
    provinceName: station?.province?.name ?? '—',
    score: Math.round(scores[0] ?? 0),
    spark: scores.map((v) => sparkBar(v)),
    peakDay: weekday(dates[pi]),
    peakVal: Math.round(peakVal),
    riskColor: meta.color,
    riskLabel: meta.label,
  };
}

export default function ForecastView() {
  const { patch, showToast } = useApp();

  const [rows, setRows] = useState<FcRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState<number>(0);
  const [fcHigh, setFcHigh] = useState<number>(0);
  const [fcVeryHigh, setFcVeryHigh] = useState<number>(0);
  const [activeEvents, setActiveEvents] = useState<number>(0);
  const [exporting, setExporting] = useState(false);

  // Load the at-risk list (API 36), total station count (Group C), and ongoing-event
  // count (API 20). All stay empty/zero on failure (the Risk Engine may not have run).
  useEffect(() => {
    let cancelled = false;
    apiListRiskStations({ size: 100, sort: 'severity', includeLow: true })
      .then(async (res) => {
        // Severity sort → each station's first row is its worst day; dedupe to rank by peak.
        const rankByStation = new Map<number, RiskAssessment>();
        for (const a of res.data) if (!rankByStation.has(a.stationId)) rankByStation.set(a.stationId, a);
        const ranked = [...rankByStation.values()];
        if (!cancelled) {
          setFcHigh(ranked.filter((a) => (a.riskScore ?? 0) >= 50).length);
          setFcVeryHigh(ranked.filter((a) => (a.riskScore ?? 0) >= 70).length);
        }
        const top = ranked.slice(0, TOP_N);
        const seriesList = await Promise.all(
          top.map((a) => apiGetStationForecast(a.stationId).then((f) => f.series.slice(0, FORECAST_DAYS)).catch(() => [])),
        );
        if (cancelled) return;
        setRows(top.map((a, i) => buildRow(a, seriesList[i])).sort((x, y) => y.peakVal - x.peakVal));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    apiListStations({ size: 1 })
      .then((res) => {
        if (!cancelled) setTotal(res.total);
      })
      .catch(() => {});
    // API 20 — ongoing-event count for the KPI.
    apiListEvents({ status: 'ONGOING', size: 1 })
      .then((res) => {
        if (!cancelled) setActiveEvents(res.total);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Export the risk summary (APIs 40–43): "Word" saves the HTML as .doc; "PDF" prints it.
  const runReport = async (delivery: 'download' | 'print', asWord: boolean) => {
    if (exporting) return;
    setExporting(true);
    showToast(asWord ? 'Đang tạo báo cáo Word…' : 'Đang tạo báo cáo PDF…');
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const meta = await exportReport(
        { kind: 'risk-summary', format: 'html' },
        delivery,
        asWord ? `bao-cao-nguy-co_${stamp}.doc` : undefined,
      );
      showToast(`Đã xuất báo cáo (${meta.rowCount.toLocaleString('vi-VN')} trạm nguy cơ).`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Xuất báo cáo thất bại.');
    } finally {
      setExporting(false);
    }
  };

  const liveData = loaded && rows.length > 0;

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
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Chỉ số ≥ 50 trong 5 ngày</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px', borderLeft: '3px solid #EE0033' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Nguy cơ Rất cao</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4, color: '#EE0033' }}>{fcVeryHigh}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Cần ứng cứu ưu tiên</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px' }}>
            <div style={{ fontSize: 12, color: '#9AA0A6', fontWeight: 600 }}>Sự kiện đang hoạt động</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{activeEvents}</div>
            <div style={{ fontSize: 11.5, color: '#9AA0A6', marginTop: 2 }}>Bão / mưa lớn / lũ</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Danh sách trạm nguy cơ ngập</div>
          <span style={{ fontSize: 12, color: '#9AA0A6' }}>· sắp xếp theo chỉ số rủi ro</span>
          <span
            title={loaded ? 'Đang lấy từ API /risk/stations' : 'Đang tải dữ liệu nguy cơ…'}
            style={{ fontSize: 11, fontWeight: 700, color: liveData ? '#16794A' : '#6B7280', background: liveData ? '#F3FBF6' : '#F1F2F4', border: `1px solid ${liveData ? '#CDEBD8' : '#E2E5EA'}`, padding: '2px 8px', borderRadius: 7 }}
          >
            {!loaded ? 'Đang tải…' : liveData ? 'Dữ liệu trực tiếp' : 'Chưa có dữ liệu'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => runReport('download', true)}
            disabled={exporting}
            title="Tải báo cáo tổng hợp nguy cơ dạng Word (.doc)"
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 14px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 13, fontWeight: 600, color: '#3A3F47', cursor: exporting ? 'default' : 'pointer', opacity: exporting ? 0.6 : 1 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            {exporting ? 'Đang xuất…' : 'Xuất Word'}
          </button>
          <button
            onClick={() => runReport('print', false)}
            disabled={exporting}
            title="Mở báo cáo in được rồi lưu thành PDF từ trình duyệt"
            style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', border: 'none', background: '#EE0033', borderRadius: 9, fontSize: 13, fontWeight: 700, color: '#fff', cursor: exporting ? 'default' : 'pointer', boxShadow: '0 4px 12px rgba(238,0,51,.24)', opacity: exporting ? 0.6 : 1 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v11m0 0l-4-4m4 4l4-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
            Xuất báo cáo PDF
          </button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 150px 80px 160px 96px 96px', gap: 12, padding: '12px 18px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 11.5, fontWeight: 700, color: '#8A9099', letterSpacing: 0.3, textTransform: 'uppercase' }}>
            <span>Mã trạm</span><span>Tên trạm</span><span>Tỉnh / thành</span><span>Hôm nay</span><span>Xu hướng 5 ngày</span><span>Ngày đỉnh</span><span style={{ textAlign: 'right' }}>Mức</span>
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
          {rows.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9AA0A6', fontSize: 13, padding: '28px 0' }}>
              {loaded ? 'Chưa có trạm nguy cơ trong 5 ngày tới.' : 'Đang tải dữ liệu nguy cơ…'}
            </div>
          )}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
