import { useApp } from '../state/AppStateContext';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;

  return (
    <div
      className="fws-fade"
      style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        background: '#16181D',
        color: '#fff',
        padding: '13px 18px',
        borderRadius: 11,
        boxShadow: '0 12px 32px rgba(16,20,30,.3)',
        maxWidth: 480,
      }}
    >
      <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#EE0033', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4 4 10-10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{state.toast}</span>
    </div>
  );
}
