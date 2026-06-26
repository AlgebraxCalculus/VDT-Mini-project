import { AppStateProvider, useApp } from './state/AppStateContext';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Toast from './components/Toast';
import MapView from './components/MapView';
import ForecastView from './components/ForecastView';
import StationsView from './components/StationsView';
import ImportView from './components/ImportView';
import EventsView from './components/EventsView';
import AccountsView from './components/AccountsView';
import HealthView from './components/HealthView';
import type { RouteKey } from './types';

const VIEWS: Record<Exclude<RouteKey, 'login'>, () => React.JSX.Element> = {
  map: MapView,
  forecast: ForecastView,
  stations: StationsView,
  import: ImportView,
  events: EventsView,
  accounts: AccountsView,
  health: HealthView,
};

function Shell() {
  const { state } = useApp();

  if (state.route === 'login') return <Login />;

  const View = VIEWS[state.route];

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar />
        <section style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#FAFAFA' }}>
          <View />
          <Toast />
        </section>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
