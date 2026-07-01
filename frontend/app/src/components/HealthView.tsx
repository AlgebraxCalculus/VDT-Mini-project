import { useCallback, useEffect, useState } from 'react';
import {
  apiGetIntegrationsHealth,
  apiRefreshIntegrationsHealth,
  apiGetRecentJobs,
  ApiError,
  type RecentJob,
  type SourceHealth,
} from '../lib/api';

// Friendly VN label + description per backend source `code` (API 35 sends only the code).
// Keys must match the WeatherSource codes in HEALTH_PROVIDERS (backend):
// forecast chain Open-Meteo → MET Norway → WeatherAPI; disaster chain GDACS →
// ReliefWeb → EONET; GloFAS supplies river water level.
const SOURCE_META: Record<string, { name: string; desc: string }> = {
  OpenMeteo: { name: 'Open-Meteo', desc: 'Dự báo thời tiết · nguồn chính' },
  MetNorway: { name: 'MET Norway (Yr)', desc: 'Dự báo · dự phòng #1' },
  WeatherAPI: { name: 'WeatherAPI.com', desc: 'Dự báo · dự phòng #2' },
  GDACS: { name: 'GDACS', desc: 'Cảnh báo thiên tai · nguồn chính' },
  ReliefWeb: { name: 'ReliefWeb (UN OCHA)', desc: 'Thiên tai · dự phòng #1' },
  EONET: { name: 'NASA EONET', desc: 'Thiên tai · dự phòng #2' },
  GloFAS: { name: 'GloFAS (Copernicus)', desc: 'Mực nước sông · cập nhật theo ngày' },
};

// A source that is UP but slower than this (ms) is surfaced as "Phản hồi chậm".
const SLOW_MS = 3000;

type Tone = [label: string, color: string, bg: string];

// Map (configured + status + latency) → display tone. The backend has no "slow"
// state, so it is derived here from latencyMs.
function tone(s: SourceHealth): Tone {
  if (!s.configured) return ['Chưa cấu hình', '#6B7280', '#F1F2F4'];
  if (s.status === 'DOWN') return ['Gián đoạn', '#EE0033', '#FDE7EB'];
  if (s.status === 'UNKNOWN') return ['Chưa kiểm tra', '#6B7280', '#F1F2F4'];
  if (s.latencyMs != null && s.latencyMs > SLOW_MS) return ['Phản hồi chậm', '#B45309', '#FEF3C7'];
  return ['Ổn định', '#16A34A', '#ECFDF3'];
}

const fmtLatency = (ms: number | null) =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtErrRate = (r: number) => `${(r * 100).toFixed(1)}%`;

// Friendly VN label per BullMQ queue (the backend sends the raw queue name).
const QUEUE_LABEL: Record<RecentJob['queue'], string> = {
  weather: 'Đồng bộ thời tiết',
  reports: 'Xuất báo cáo',
  'stations-import': 'Nhập trạm hàng loạt',
};

// state → [label, color, bg] for the status badge.
const JOB_TONE: Record<RecentJob['state'], Tone> = {
  active: ['Đang chạy', '#B45309', '#FEF3C7'],
  completed: ['Hoàn tất', '#16A34A', '#ECFDF3'],
  failed: ['Thất bại', '#EE0033', '#FDE7EB'],
  waiting: ['Đang chờ', '#6B7280', '#F1F2F4'],
  delayed: ['Đang chờ', '#6B7280', '#F1F2F4'],
  paused: ['Tạm dừng', '#6B7280', '#F1F2F4'],
  unknown: ['—', '#6B7280', '#F1F2F4'],
};

// The most relevant timestamp for a job, by lifecycle stage.
const jobTime = (j: RecentJob) => fmtTime(j.finishedAt ?? j.startedAt ?? j.createdAt);

// A short VN status line under the job title.
function jobInfo(j: RecentJob): string {
  if (j.state === 'active') return `Đang xử lý · ${j.progress}%`;
  if (j.state === 'failed') return (j.failedReason ?? 'Tác vụ thất bại').slice(0, 90);
  if (j.state === 'completed') return `Hoàn tất · ${j.queue}`;
  if (j.state === 'waiting' || j.state === 'delayed') return 'Đang chờ trong hàng đợi';
  return j.queue;
}

export default function HealthView() {
  const [sources, setSources] = useState<SourceHealth[] | null>(null);
  const [jobs, setJobs] = useState<RecentJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `refresh` true → POST /integrations/health/refresh (re-probe every source now);
  // false → GET the last cached results (used on mount, fast). The button below
  // passes true so an admin can force a fresh check without waiting for the cron.
  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setSources(await (refresh ? apiRefreshIntegrationsHealth() : apiGetIntegrationsHealth()));
    } catch (e) {
      setSources(null);
      if (e instanceof ApiError && e.status === 403)
        setError('Chỉ Quản trị viên mới xem được tình trạng kết nối API bên thứ 3.');
      else if (e instanceof ApiError && e.status === 0)
        setError('Không kết nối được tới máy chủ API. Kiểm tra backend đã chạy chưa.');
      else if (e instanceof ApiError) setError(e.message);
      else setError('Đã xảy ra lỗi khi tải tình trạng hệ thống.');
    } finally {
      setLoading(false);
    }
    // Recent background jobs are non-critical — a failure just hides the panel
    // and never blanks the health cards above.
    try {
      setJobs(await apiGetRecentJobs());
    } catch {
      setJobs(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const okCount = sources?.filter((s) => s.configured && s.status === 'UP').length ?? 0;
  const total = sources?.length ?? 0;
  const lastChecked =
    sources?.reduce<string | null>(
      (acc, s) => (s.checkedAt && (!acc || s.checkedAt > acc) ? s.checkedAt : acc),
      null,
    ) ?? null;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 1260, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: '#ECFDF3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2 5 4-12 2 7h6" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Tình trạng kết nối API bên thứ 3</div>
            <div style={{ fontSize: 12.5, color: '#9AA0A6' }}>
              {loading
                ? 'Đang tải…'
                : error
                  ? 'Không tải được dữ liệu'
                  : `${okCount}/${total} nguồn ổn định · cập nhật lúc ${fmtTime(lastChecked)}`}
            </div>
          </div>
          <button onClick={() => void load(true)} disabled={loading} style={{ height: 40, padding: '0 16px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Đang kiểm tra…' : 'Kiểm tra lại tất cả'}
          </button>
        </div>

        {error && (
          <div style={{ background: '#FDE7EB', border: '1px solid #F7C6D2', borderRadius: 14, padding: '16px 20px', color: '#B4123A', fontSize: 13.5, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {!error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            {(sources ?? []).map((s) => {
              const [label, color, bg] = tone(s);
              const meta = SOURCE_META[s.code] ?? { name: s.code, desc: 'Nguồn dữ liệu ngoài' };
              return (
                <div key={s.code} style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
                      {meta.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#9AA0A6', marginTop: 4 }}>{meta.desc}</div>
                  <div style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, color, background: bg, padding: '4px 10px', borderRadius: 7, marginTop: 12 }}>{label}</div>
                  {s.status === 'DOWN' && s.error && (
                    <div style={{ fontSize: 11, color: '#B4123A', marginTop: 8, lineHeight: 1.4, wordBreak: 'break-word' }}>{s.error}</div>
                  )}
                  <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F2F3F5' }}>
                    <div>
                      <div style={{ fontSize: 10.5, color: '#9AA0A6', fontWeight: 600 }}>Độ trễ</div>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtLatency(s.latencyMs)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: '#9AA0A6', fontWeight: 600 }}>Tỉ lệ lỗi</div>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtErrRate(s.errorRate)}</div>
                    </div>
                    <div style={{ flex: 1 }} />
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10.5, color: '#9AA0A6', fontWeight: 600 }}>Lần cuối</div>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtTime(s.checkedAt)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {loading && sources == null && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#9AA0A6', fontSize: 13, padding: '28px 0' }}>Đang tải tình trạng các nguồn…</div>
            )}
            {!loading && sources?.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#9AA0A6', fontSize: 13, padding: '28px 0' }}>Chưa có nguồn nào được cấu hình.</div>
            )}
          </div>
        )}

        {/* Tác vụ nền gần đây — đọc trực tiếp từ các hàng đợi BullMQ (GET /system/jobs,
            Admin-only): đồng bộ thời tiết, xuất báo cáo, nhập trạm hàng loạt. */}
        <div style={{ fontSize: 14, fontWeight: 700, margin: '22px 0 12px' }}>Tác vụ nền gần đây</div>
        <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
          {(jobs ?? []).map((j) => {
            const [badge, badgeColor, badgeBg] = JOB_TONE[j.state];
            return (
              <div key={`${j.queue}:${j.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: '1px solid #F2F3F5' }}>
                {j.state === 'active' ? (
                  <span style={{ width: 26, height: 26, borderRadius: '50%', border: '2.5px solid #FEE2E2', borderTopColor: '#EE0033', animation: 'fwsSpin 1s linear infinite', flex: 'none' }} />
                ) : j.state === 'failed' ? (
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#FDE7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="#EE0033" strokeWidth="2.4" strokeLinecap="round" /></svg>
                  </span>
                ) : j.state === 'completed' ? (
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#ECFDF3', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4 4 10-10" stroke="#16A34A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                ) : (
                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#F1F2F4', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="#9AA0A6" strokeWidth="1.8" /><path d="M12 8v4l2.5 1.5" stroke="#9AA0A6" strokeWidth="1.8" strokeLinecap="round" /></svg>
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{QUEUE_LABEL[j.queue]}</div>
                  <div style={{ fontSize: 11.5, color: '#9AA0A6', fontFamily: "'IBM Plex Mono',monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{jobTime(j)} · {jobInfo(j)} · #{j.id.slice(0, 8)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: badgeColor, background: badgeBg, padding: '4px 10px', borderRadius: 7, flex: 'none' }}>{badge}</span>
              </div>
            );
          })}
          {jobs == null && (
            <div style={{ textAlign: 'center', color: '#9AA0A6', fontSize: 13, padding: '24px 0' }}>Không tải được danh sách tác vụ nền.</div>
          )}
          {jobs?.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9AA0A6', fontSize: 13, padding: '24px 0' }}>Chưa có tác vụ nền nào gần đây.</div>
          )}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
