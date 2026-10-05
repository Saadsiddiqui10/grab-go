import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BRAND } from '@grabgo/config';
import { ApiError, Badge, Button, Card, TextField } from '@grabgo/ui';
import { useAdmin } from './store';
import { UsersPage } from './pages/Users';
import { BusinessesPage } from './pages/Businesses';
import { ListingsPage } from './pages/Listings';
import { OrdersPage } from './pages/Orders';
import { LoyaltyPage } from './pages/Loyalty';

/** The overview is the only route that needs the charting library. */
const OverviewPage = lazy(async () => ({
  default: (await import('./pages/Overview')).OverviewPage,
}));


/**
 * Admin dashboard shell.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status >= 500 && failureCount < 2,
      staleTime: 30_000,
    },
    mutations: { retry: false },
  },
});

export function App(): React.JSX.Element {
  const status = useAdmin((state) => state.status);
  const bootstrap = useAdmin((state) => state.bootstrap);

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
      {status === 'authenticated' ? (
        <BrowserRouter>
          <div className="gg-shell">
            <Sidebar />
            <main className="gg-main">
              <Routes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route
                  path="/overview"
                  element={
                    <Suspense fallback={<span className="gg-muted">Loading…</span>}>
                      <OverviewPage />
                    </Suspense>
                  }
                />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/cafes" element={<BusinessesPage />} />
                <Route path="/listings" element={<ListingsPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/loyalty" element={<LoyaltyPage />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      ) : (
        <LoginPage />
      )}
    </QueryClientProvider>
  );
}

function Sidebar(): React.JSX.Element {
  const user = useAdmin((state) => state.user);
  const signOut = useAdmin((state) => state.signOut);

  return (
    <nav className="gg-sidebar" aria-label="Admin navigation">
      <div className="gg-brand">
        <div className="gg-brand-mark">G</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{BRAND.name}</div>
          <div className="gg-muted" style={{ fontSize: 11 }}>
            Admin
          </div>
        </div>
      </div>

      <div className="gg-nav">
        <NavLink className="gg-nav-link" to="/overview">
          Overview
        </NavLink>
        <NavLink className="gg-nav-link" to="/orders">
          Orders
        </NavLink>
        <NavLink className="gg-nav-link" to="/cafes">
          Cafes
        </NavLink>
        <NavLink className="gg-nav-link" to="/listings">
          Listings
        </NavLink>
        <NavLink className="gg-nav-link" to="/users">
          Users
        </NavLink>
        <NavLink className="gg-nav-link" to="/loyalty">
          Loyalty and rules
        </NavLink>
      </div>

      <div style={{ marginTop: 'auto' }} className="gg-stack">
        <Badge tone="primary">{user?.role.replace('_', ' ').toLowerCase()}</Badge>
        <div className="gg-small gg-muted">{user?.fullName ?? ''}</div>
        <Button variant="secondary" size="sm" block onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}

function LoginPage(): React.JSX.Element {
  const signIn = useAdmin((state) => state.signIn);

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
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.displayMessage
          : caught instanceof Error
            ? caught.message
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
            <div className="gg-muted gg-small">Admin</div>
          </div>
        </div>

        <Card>
          <form onSubmit={(event) => void submit(event)} className="gg-stack">
            <h2>Sign in</h2>

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
      </div>
    </div>
  );
}
