import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { AuthUser } from '../lib/api';
import type {
  AccountForm,
  DrawerState,
  EventForm,
  EventTab,
  MapLayout,
  Role,
  RouteKey,
  WeatherLayerKey,
} from '../types';

export interface AppState {
  route: RouteKey;
  role: Role;
  currentUser: AuthUser | null;
  sidebarOpen: boolean;
  weatherLayer: WeatherLayerKey | null;
  floodOn: boolean;
  selectedId: number | null;
  searchText: string;
  scrubDay: number;
  scrubDayCount: number; // length of the forecast scrubber (≤5, from the province forecast)
  playing: boolean;
  syncing: boolean;
  mapLayout: MapLayout;
  drawer: DrawerState | null;
  stnQuery: string;
  stnProv: string;
  importStep: number;
  importProgress: number;
  importRunning: boolean;
  eventTab: EventTab;
  eventDrawerId: string | null;
  evForm: EventForm | null;
  acctForm: AccountForm | null;
  toast: string | null;
}

const initialState: AppState = {
  route: 'login',
  role: 'operator',
  currentUser: null,
  sidebarOpen: true,
  weatherLayer: null,
  floodOn: true,
  selectedId: null,
  searchText: '',
  scrubDay: 0,
  scrubDayCount: 5,
  playing: false,
  syncing: false,
  mapLayout: 'A',
  drawer: null,
  stnQuery: '',
  stnProv: 'all',
  importStep: 1,
  importProgress: 0,
  importRunning: false,
  eventTab: 'active',
  eventDrawerId: null,
  evForm: null,
  acctForm: null,
  toast: null,
};

type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

interface AppContextValue {
  state: AppState;
  patch: (p: Patch) => void;
  showToast: (msg: string) => void;
  doSync: () => void;
  togglePlay: () => void;
  runImport: () => void;
  resetImport: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const importTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const patch = useCallback((p: Patch) => {
    setState((prev) => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) }));
  }, []);

  const showToast = useCallback((msg: string) => {
    patch({ toast: msg });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ toast: null }), 2600);
  }, [patch]);

  const doSync = useCallback(() => {
    setState((prev) => {
      if (prev.syncing) return prev;
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => patch({ syncing: false }), 2600);
      return { ...prev, syncing: true };
    });
  }, [patch]);

  const togglePlay = useCallback(() => {
    setState((prev) => {
      if (prev.playing) {
        clearInterval(playTimer.current);
        return { ...prev, playing: false };
      }
      clearInterval(playTimer.current);
      playTimer.current = setInterval(() => {
        patch((s) => ({ scrubDay: (s.scrubDay + 1) % (s.scrubDayCount || 5) }));
      }, 1100);
      return { ...prev, playing: true };
    });
  }, [patch]);

  const runImport = useCallback(() => {
    setState((prev) => {
      if (prev.importRunning) return prev;
      clearInterval(importTimer.current);
      importTimer.current = setInterval(() => {
        patch((s) => {
          const p = Math.min(100, s.importProgress + (4 + Math.random() * 7));
          if (p >= 100) {
            clearInterval(importTimer.current);
            return { importProgress: 100, importRunning: false, importStep: 4 };
          }
          return { importProgress: p };
        });
      }, 220);
      return { ...prev, importStep: 3, importRunning: true, importProgress: 0 };
    });
  }, [patch]);

  const resetImport = useCallback(() => {
    clearInterval(importTimer.current);
    patch({ importStep: 1, importProgress: 0, importRunning: false });
  }, [patch]);

  return (
    <AppContext.Provider value={{ state, patch, showToast, doSync, togglePlay, runImport, resetImport }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppStateProvider');
  return ctx;
}
