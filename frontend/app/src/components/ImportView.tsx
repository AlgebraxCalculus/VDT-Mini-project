import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppStateContext';
import { apiImportStations, apiGetImportJob, ApiError } from '../lib/api';
import type { ImportReport } from '../lib/api';
import { previewCsv, SAMPLE_CSV, type PreviewResult } from '../lib/csv';

const BATCH_SIZE = 1000;
const PREVIEW_LIMIT = 200; // cap rows rendered in the preview table

function stepStyleFor(n: number, cur: number) {
  const done = cur > n;
  const active = cur === n || (n === 3 && cur >= 3);
  const c = active ? '#EE0033' : done ? '#16A34A' : '#CBD0D6';
  const bg = active ? '#FDE7EB' : done ? '#ECFDF3' : '#F4F5F7';
  return { c, bg };
}

/** Trigger a client-side download of text content as a file. */
function downloadText(filename: string, content: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportView() {
  const { state, patch, showToast, resetImport } = useApp();
  const { importStep, importProgress } = state;

  // Local import session (not in global AppState): the chosen file, its client
  // preview, the running job id, and the final report.
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const is1 = importStep === 1;
  const is2 = importStep === 2;
  const is3 = importStep >= 3;
  const is4 = importStep === 4;

  const step1Style = stepStyleFor(1, importStep);
  const step2Style = stepStyleFor(2, importStep);
  const step3Style = stepStyleFor(3, importStep);
  const step4Style = stepStyleFor(4, importStep);

  // Full reset back to step 1 (clears the global stepper + the local session).
  const reset = () => {
    resetImport();
    setFile(null);
    setPreview(null);
    setJobId(null);
    setReport(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Read the picked file, parse + format-validate it client-side, advance to preview.
  const onFilePicked = async (f: File) => {
    setError(null);
    setFile(f);
    try {
      const text = await f.text();
      setPreview(previewCsv(text));
      patch({ importStep: 2 });
    } catch {
      setError('Không đọc được nội dung file.');
    }
  };

  // API 18 — upload the raw file, then poll for the report (effect below).
  const startImport = () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    apiImportStations(file)
      .then((res) => {
        setJobId(res.jobId);
        patch({ importStep: 3, importProgress: 0 });
      })
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : 'Tải lên thất bại.');
      })
      .finally(() => setUploading(false));
  };

  // API 19 — poll the job while it runs; update progress, capture the report on
  // completion. setState lives in the interval callback (not the effect body).
  useEffect(() => {
    if (!jobId || importStep !== 3) return;
    let alive = true;
    const tick = () => {
      apiGetImportJob(jobId)
        .then((s) => {
          if (!alive) return;
          patch({ importProgress: s.progress });
          if (s.state === 'completed' && s.report) {
            setReport(s.report);
            patch({ importStep: 4, importProgress: 100 });
          } else if (s.state === 'failed') {
            setError(s.failedReason ?? 'Tác vụ nhập thất bại.');
            patch({ importStep: 4 });
          }
        })
        .catch(() => { /* transient — keep polling */ });
    };
    tick();
    const timer = setInterval(tick, 800);
    return () => { alive = false; clearInterval(timer); };
  }, [jobId, importStep, patch]);

  const previewRows = preview?.rows ?? [];
  const validCount = preview?.validCount ?? 0;
  const invalidCount = preview?.invalidCount ?? 0;
  const totalBatches = report
    ? Math.max(1, Math.ceil(report.total / BATCH_SIZE))
    : Math.max(1, Math.ceil(validCount / BATCH_SIZE));

  const downloadErrors = () => {
    if (!report || report.errors.length === 0) return;
    const header = 'row,station_code,message\n';
    const body = report.errors
      .map((e) => `${e.row},"${e.stationCode.replace(/"/g, '""')}","${e.message.replace(/"/g, '""')}"`)
      .join('\n');
    downloadText('import_errors.csv', header + body);
  };

  const stepDot = (n: number, style: { c: string; bg: string }, label: string, justify: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, justifyContent: justify }}>
      <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: style.bg, color: style.c }}>{n}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: style.c }}>{label}</span>
    </div>
  );

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '24px 28px' }} className="fws-fade">
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: '16px 22px', marginBottom: 18 }}>
          {stepDot(1, step1Style, 'Tải lên file', 'flex-start')}
          <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
          {stepDot(2, step2Style, 'Kiểm tra dữ liệu', 'center')}
          <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
          {stepDot(3, step3Style, 'Xử lý theo lô', 'center')}
          <span style={{ flex: 1, height: 2, background: '#EDEFF2' }} />
          {stepDot(4, step4Style, 'Kết quả', 'flex-end')}
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#FDE7EB', border: '1px solid #F7C6D2', borderRadius: 11, color: '#B4123A', fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {is1 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: 26 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFilePicked(f);
              }}
            />
            <div style={{ border: '2px dashed #D9DDE3', borderRadius: 14, padding: 46, textAlign: 'center', background: '#FCFCFD' }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: '#FDE7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7 9m5-5 5 5" stroke="#EE0033" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="#EE0033" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>Bấm để chọn file CSV</div>
              <div style={{ fontSize: 13, color: '#9AA0A6', marginTop: 6 }}>Hỗ trợ .CSV · tối đa 10.000 dòng / lần</div>
              <button onClick={() => fileInputRef.current?.click()} style={{ marginTop: 18, height: 42, padding: '0 22px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                Chọn file để tải lên
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, padding: '13px 16px', background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="#16A34A" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="#16A34A" strokeWidth="1.6" /></svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>File mẫu nhập trạm</div>
                  <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>station_code, name, latitude, longitude, elevation, threshold_l1–l3</div>
                </div>
              </div>
              <button onClick={() => downloadText('mau_nhap_tram.csv', SAMPLE_CSV)} style={{ height: 36, padding: '0 14px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Tải file mẫu</button>
            </div>
          </div>
        )}

        {is2 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid #EEF0F3' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="#475569" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="#475569" strokeWidth="1.6" /></svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file?.name ?? 'file.csv'}</div>
                <div style={{ fontSize: 12, color: '#9AA0A6' }}>{previewRows.length} dòng · kiểm tra định dạng trước khi tải lên</div>
              </div>
              {!preview?.headerError && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', background: '#ECFDF3', padding: '5px 11px', borderRadius: 8 }}>{validCount} hợp lệ</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#EE0033', background: '#FDE7EB', padding: '5px 11px', borderRadius: 8 }}>{invalidCount} lỗi</span>
                </div>
              )}
            </div>

            {preview?.headerError ? (
              <div style={{ padding: '22px 20px', fontSize: 13.5, color: '#B4123A', fontWeight: 600 }}>{preview.headerError}</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '60px 150px 1fr 190px 1.1fr', gap: 12, padding: '10px 20px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 11, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  <span>Dòng</span><span>Mã trạm</span><span>Tên trạm</span><span>Tọa độ</span><span>Trạng thái kiểm tra</span>
                </div>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {previewRows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <div key={r.rowNum} style={{ display: 'grid', gridTemplateColumns: '60px 150px 1fr 190px 1.1fr', gap: 12, padding: '10px 20px', borderBottom: '1px solid #F2F3F5', alignItems: 'center', fontSize: 12.5 }}>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#9AA0A6' }}>#{r.rowNum}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{r.stationCode || '—'}</span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || '—'}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{r.latitude || '?'}, {r.longitude || '?'}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: r.valid ? '#16794A' : '#EE0033' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: r.valid ? '#16A34A' : '#EE0033' }} />
                        {r.message}
                      </span>
                    </div>
                  ))}
                  {previewRows.length > PREVIEW_LIMIT && (
                    <div style={{ padding: '10px 20px', fontSize: 12, color: '#9AA0A6' }}>… và {previewRows.length - PREVIEW_LIMIT} dòng nữa (hiển thị {PREVIEW_LIMIT} dòng đầu).</div>
                  )}
                </div>
              </>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderTop: '1px solid #EEF0F3' }}>
              <button onClick={reset} style={{ height: 42, padding: '0 18px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>‹ Chọn file khác</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {!preview?.headerError && <span style={{ fontSize: 12.5, color: '#9AA0A6' }}>{invalidCount} dòng lỗi sẽ bị bỏ qua</span>}
                <button
                  onClick={startImport}
                  disabled={uploading || !!preview?.headerError || validCount === 0}
                  style={{ height: 42, padding: '0 20px', border: 'none', background: uploading || !!preview?.headerError || validCount === 0 ? '#F1A9B9' : '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: uploading || validCount === 0 ? 'default' : 'pointer' }}
                >
                  {uploading ? 'Đang tải lên…' : `Bắt đầu nhập ${validCount} trạm`}
                </button>
              </div>
            </div>
          </div>
        )}

        {is3 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: 30 }}>
            {is4 && !error && (
              <div style={{ textAlign: 'center', padding: '6px 0 18px' }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#ECFDF3', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="#16A34A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Hoàn tất nhập dữ liệu</div>
                <div style={{ fontSize: 13, color: '#9AA0A6', marginTop: 5 }}>Tác vụ bất đồng bộ đã xử lý xong toàn bộ các lô.</div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Tiến độ xử lý theo lô</span>
              <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: '#EE0033' }}>{Math.round(importProgress)}%</span>
            </div>
            <div style={{ height: 12, borderRadius: 8, background: '#F1F2F4', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 8, background: 'linear-gradient(90deg,#EE0033,#FF4D6D)', width: `${importProgress}%`, transition: 'width .2s' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 20 }}>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Tổng lô</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>{totalBatches}</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Kích thước lô</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>{BATCH_SIZE.toLocaleString('vi-VN')}</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Thành công</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: '#16A34A' }}>{report ? report.success : '—'}</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Lỗi</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: '#EE0033' }}>{report ? report.failed : '—'}</div>
              </div>
            </div>

            {is4 && report && report.errors.length > 0 && (
              <div style={{ marginTop: 20, border: '1px solid #EEF0F3', borderRadius: 11, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 12.5, fontWeight: 700, color: '#6B7280' }}>
                  Dòng bị bỏ qua{report.truncatedErrors ? ` (hiển thị ${report.errors.length} dòng đầu)` : ''}
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {report.errors.map((e) => (
                    <div key={e.row} style={{ display: 'grid', gridTemplateColumns: '70px 160px 1fr', gap: 12, padding: '8px 16px', borderBottom: '1px solid #F2F3F5', fontSize: 12.5, alignItems: 'center' }}>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#9AA0A6' }}>#{e.row}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{e.stationCode || '—'}</span>
                      <span style={{ color: '#B4123A', fontWeight: 600 }}>{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {is4 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
                {report && report.errors.length > 0 && (
                  <button onClick={downloadErrors} style={{ height: 42, padding: '0 18px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>
                    Tải báo cáo lỗi (CSV)
                  </button>
                )}
                <button onClick={() => { reset(); showToast('Sẵn sàng cho lô nhập mới.'); }} style={{ height: 42, padding: '0 20px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                  Nhập lô mới
                </button>
              </div>
            )}
          </div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
