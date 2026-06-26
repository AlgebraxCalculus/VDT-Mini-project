import { useApp } from '../state/AppStateContext';
import { IMPORT_PREVIEW } from '../data/mockData';

function stepStyleFor(n: number, cur: number) {
  const done = cur > n;
  const active = cur === n || (n === 3 && cur >= 3);
  const c = active ? '#EE0033' : done ? '#16A34A' : '#CBD0D6';
  const bg = active ? '#FDE7EB' : done ? '#ECFDF3' : '#F4F5F7';
  return { c, bg };
}

export default function ImportView() {
  const { state, patch, showToast, runImport, resetImport } = useApp();
  const { importStep, importProgress } = state;

  const is1 = importStep === 1;
  const is2 = importStep === 2;
  const is3 = importStep >= 3;
  const is4 = importStep === 4;

  const importValid = IMPORT_PREVIEW.filter((r) => r.ok).length;
  const importInvalid = IMPORT_PREVIEW.filter((r) => !r.ok).length;

  const step1Style = stepStyleFor(1, importStep);
  const step2Style = stepStyleFor(2, importStep);
  const step3Style = stepStyleFor(3, importStep);
  const step4Style = stepStyleFor(4, importStep);

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

        {is1 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: 26 }}>
            <div style={{ border: '2px dashed #D9DDE3', borderRadius: 14, padding: 46, textAlign: 'center', background: '#FCFCFD' }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: '#FDE7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7 9m5-5 5 5" stroke="#EE0033" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="#EE0033" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>Kéo thả file vào đây hoặc bấm để chọn</div>
              <div style={{ fontSize: 13, color: '#9AA0A6', marginTop: 6 }}>Hỗ trợ .CSV, .XLSX · tối đa 10.000 dòng / lần</div>
              <button onClick={() => patch({ importStep: 2 })} style={{ marginTop: 18, height: 42, padding: '0 22px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                Chọn file để tải lên
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, padding: '13px 16px', background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="#16A34A" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="#16A34A" strokeWidth="1.6" /></svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>File mẫu nhập trạm</div>
                  <div style={{ fontSize: 11.5, color: '#9AA0A6' }}>mau_nhap_tram.xlsx — gồm cột bắt buộc & hướng dẫn</div>
                </div>
              </div>
              <button style={{ height: 36, padding: '0 14px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>Tải file mẫu</button>
            </div>
          </div>
        )}

        {is2 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid #EEF0F3' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 3h8l4 4v14H6V3Z" stroke="#475569" strokeWidth="1.6" strokeLinejoin="round" /><path d="M14 3v4h4" stroke="#475569" strokeWidth="1.6" /></svg>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>tram_mienbac_062026.xlsx</div>
                <div style={{ fontSize: 12, color: '#9AA0A6' }}>{IMPORT_PREVIEW.length} dòng · phát hiện trước khi xử lý</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', background: '#ECFDF3', padding: '5px 11px', borderRadius: 8 }}>{importValid} hợp lệ</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#EE0033', background: '#FDE7EB', padding: '5px 11px', borderRadius: 8 }}>{importInvalid} lỗi</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 130px 1fr 130px 150px 1.2fr', gap: 12, padding: '10px 20px', background: '#FAFBFC', borderBottom: '1px solid #EEF0F3', fontSize: 11, fontWeight: 700, color: '#8A9099', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              <span>Dòng</span><span>Mã trạm</span><span>Tên trạm</span><span>Tỉnh</span><span>Tọa độ</span><span>Trạng thái kiểm tra</span>
            </div>
            {IMPORT_PREVIEW.map((r) => (
              <div key={r.row} style={{ display: 'grid', gridTemplateColumns: '60px 130px 1fr 130px 150px 1.2fr', gap: 12, padding: '10px 20px', borderBottom: '1px solid #F2F3F5', alignItems: 'center', fontSize: 12.5 }}>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#9AA0A6' }}>#{r.row}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{r.id}</span>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: '#6B7280' }}>{r.prov}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: '#6B7280' }}>{r.lat}, {r.lng}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: r.ok ? '#16794A' : '#EE0033' }}>{r.msg}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px' }}>
              <button onClick={resetImport} style={{ height: 42, padding: '0 18px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>‹ Chọn file khác</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12.5, color: '#9AA0A6' }}>{importInvalid} dòng lỗi sẽ bị bỏ qua</span>
                <button onClick={runImport} style={{ height: 42, padding: '0 20px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                  Bắt đầu nhập {importValid} trạm
                </button>
              </div>
            </div>
          </div>
        )}

        {is3 && (
          <div style={{ background: '#fff', border: '1px solid #E8EAEE', borderRadius: 14, padding: 30 }}>
            {is4 && (
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
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>5</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Kích thước lô</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace" }}>1.000</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Thành công</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: '#16A34A' }}>{importValid}</div>
              </div>
              <div style={{ background: '#FAFBFC', border: '1px solid #EEF0F3', borderRadius: 11, padding: '13px 15px' }}>
                <div style={{ fontSize: 11.5, color: '#9AA0A6', fontWeight: 600 }}>Lỗi</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "'IBM Plex Mono',monospace", color: '#EE0033' }}>{importInvalid}</div>
              </div>
            </div>
            {is4 && (
              <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
                <button onClick={() => showToast('Đang tải báo cáo lỗi (errors_B-205.csv)…')} style={{ height: 42, padding: '0 18px', border: '1.5px solid #E2E5EA', background: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: '#3A3F47', cursor: 'pointer' }}>
                  Tải báo cáo lỗi (CSV)
                </button>
                <button onClick={resetImport} style={{ height: 42, padding: '0 20px', border: 'none', background: '#EE0033', borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
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
