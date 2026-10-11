import { Suspense, lazy, useEffect, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BRAND } from '@grabgo/config';
import { ApiError, Badge, Button, Card, TextField } from '@grabgo/ui';
import { useDashboard } from './store';
import { LiveOrdersPage } from './pages/LiveOrders';
import { MenuPage } from './pages/MenuManager';
import { RewardsPage } from './pages/Rewards';
import { SettingsPage } from './pages/Settings';

/**
 * Analytics is the only route that pulls in the charting library, so it is
 * split out: a cafe that lives on the orders board should never download it.
 */
const AnalyticsPage = lazy(async () => ({
  default: (await import('./pages/Analytics')).AnalyticsPage,
}));

/**
 * Merchant dashboard shell.
 *
 * Live orders is the default route because it is the screen a cafe leaves open
 * all day; everything else is something they visit.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status >= 500 && failureCount < 2,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

export function App(): React.JSX.Element {
  const status = useDashboard((state) => state.status);
  const bootstrap = useDashboard((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === 'loading') {
    return (
      <div className="gg-auth">
        <span className="gg-muted">Loading…</span>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {status === 'authenticated' ? <DashboardRoutes /> : <LoginPage />}
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function DashboardRoutes(): React.JSX.Element {
  return (
    <div className="gg-shell">
      <Sidebar />

      <main className="gg-main">
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<LiveOrdersPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route
            path="/analytics"
            element={
              <Suspense fallback={<span className="gg-muted">Loading analytics…</span>}>
                <AnalyticsPage />
              </Suspense>
            }
          />
          <Route path="/rewards" element={<RewardsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Sidebar(): React.JSX.Element {
  const user = useDashboard((state) => state.user);
  const businesses = useDashboard((state) => state.businesses);
  const businessId = useDashboard((state) => state.businessId);
  const selectBusiness = useDashboard((state) => state.selectBusiness);
  const signOut = useDashboard((state) => state.signOut);
  const business = useDashboard((state) => state.currentBusiness());

  return (
    <nav className="gg-sidebar" aria-label="Dashboard navigation">
      <div className="gg-brand">
        <div className="gg-brand-mark">G</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{BRAND.name}</div>
          <div className="gg-muted" style={{ fontSize: 11 }}>
            Cafe dashboard
          </div>
        </div>
      </div>

      {/* A staff account can belong to more than one cafe. */}
      {businesses.length > 1 ? (
        <select
          className="gg-select"
          value={businessId ?? ''}
          aria-label="Choose cafe"
          onChange={(event) => selectBusiness(event.target.value)}
        >
          {businesses.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      ) : null}

      <div className="gg-nav">
        <NavLink className="gg-nav-link" to="/orders">
          Live orders
        </NavLink>
        <NavLink className="gg-nav-link" to="/menu">
          Menu
        </NavLink>
        <NavLink className="gg-nav-link" to="/rewards">
          Rewards
        </NavLink>
        <NavLink className="gg-nav-link" to="/analytics">
          Analytics
        </NavLink>
        <NavLink className="gg-nav-link" to="/settings">
          Settings
        </NavLink>
      </div>

      <div style={{ marginTop: 'auto' }} className="gg-stack">
        {business ? (
          <Badge tone={business.acceptingOrders ? 'success' : 'warning'} dot>
            {business.acceptingOrders ? 'Taking orders' : 'Orders paused'}
          </Badge>
        ) : null}

        <div className="gg-small gg-muted">{user?.fullName ?? ''}</div>

        <Button variant="secondary" size="sm" block onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}

/* ----------------------------------------------------------------- login */

function LoginPage(): React.JSX.Element {
  const signIn = useDashboard((state) => state.signIn);
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await signIn(email, password);
      navigate('/orders');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : 'Something went wrong. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gg-auth">
      <div className="gg-auth__card">
        <div className="gg-row">
          <div className="gg-brand-mark" style={{ width: 44, height: 44, fontSize: 19 }}>
            G
          </div>
          <div>
            <h1 style={{ fontSize: 22 }}>{BRAND.name}</h1>
            <div className="gg-muted gg-small">Cafe dashboard</div>
          </div>
        </div>

        <Card>
          <form onSubmit={(event) => void submit(event)} className="gg-stack">
            <div>
              <h2>Sign in</h2>
              <p className="gg-muted gg-small" style={{ marginTop: 4 }}>
                Use the account your Grab &amp; Go contact set up for this cafe.
              </p>
            </div>

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoFocus
              autoComplete="username"
              required
            />

            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />

            {error ? (
              <div className="gg-error" role="alert">
                {error}
              </div>
            ) : null}

            <Button type="submit" size="lg" block loading={busy}>
              Sign in
            </Button>
          </form>
        </Card>

        <p className="gg-muted gg-small" style={{ textAlign: 'center' }}>
          {BRAND.tagline}
        </p>
      </div>
    </div>
  );
}
