import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Badge,
  Button,
  Card,
  Dialog,
  NumberField,
  PageHeader,
  QueryState,
  SelectField,
  TextAreaField,
  TextField,
  Toast,
  formatDate,
  formatNumber,
  formatPKR,
  StatusBadge,
} from '@grabgo/ui';
import { adminApi, type AdminUserRow } from '../api';

/**
 * User management.
 *
 * Search, inspect, suspend and adjust. Suspending revokes every session
 * immediately rather than waiting for a token to expire, and a points
 * adjustment writes a ledger row like any other — there is no path here that
 * edits a balance directly.
 */
export function UsersPage(): React.JSX.Element {
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED'>('ALL');
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin-users', search, status],
    queryFn: () => adminApi.users({ q: search || undefined, status }),
  });

  return (
    <>
      <PageHeader title="Users" description="Customers, merchants and staff accounts." />

      <Card>
        <div className="gg-row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <TextField
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Name, email, phone or referral code"
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card flush>
        <QueryState
          isLoading={users.isLoading}
          isError={users.isError}
          isEmpty={(users.data?.items.length ?? 0) === 0}
          emptyTitle="No users matched"
          onRetry={() => void users.refetch()}
        >
          <div className="gg-table-wrap">
            <table className="gg-table gg-table--clickable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Role</th>
                  <th>Points</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {users.data?.items.map((user) => (
                  <tr key={user.id} onClick={() => setSelected(user)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{user.fullName || '—'}</div>
                      <div className="gg-muted gg-small gg-mono">{user.referralCode}</div>
                    </td>
                    <td className="gg-muted gg-small">
                      {user.email ?? '—'}
                      {user.phone ? <div>{user.phone}</div> : null}
                    </td>
                    <td>
                      <Badge tone={user.role === 'CUSTOMER' ? 'neutral' : 'primary'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td>{formatNumber(user.pointsBalance)}</td>
                    <td className="gg-muted gg-small">{formatDate(user.createdAt)}</td>
                    <td>
                      <Badge
                        tone={
                          user.status === 'ACTIVE'
                            ? 'success'
                            : user.status === 'SUSPENDED'
                              ? 'danger'
                              : 'neutral'
                        }
                        dot
                      >
                        {user.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <UserDialog
        user={selected}
        onClose={() => setSelected(null)}
        onChanged={(message) => {
          setToast(message);
          void client.invalidateQueries({ queryKey: ['admin-users'] });
        }}
      />

      <Toast message={toast} />
    </>
  );
}

function UserDialog({
  user,
  onClose,
  onChanged,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [pointsDelta, setPointsDelta] = useState(0);
  const [cafeId, setCafeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['admin-user', user?.id],
    queryFn: () => adminApi.user(user?.id ?? ''),
    enabled: user !== null,
  });

  // Any live cafe can be credited (goodwill at a cafe they have not ordered
  // from yet); the customer's own cards are listed first.
  const cafes = useQuery({
    queryKey: ['admin-active-cafes'],
    queryFn: () => adminApi.businesses({ status: 'ACTIVE' }),
    enabled: user !== null,
  });
  const cafeOptions = [
    ...(detail.data?.points.cafes ?? []).map((card) => ({
      value: card.businessId,
      label: `${card.businessName} (${formatNumber(card.balance)} pts)`,
    })),
    ...(cafes.data?.items ?? [])
      .filter((cafe) => !detail.data?.points.cafes.some((card) => card.businessId === cafe.id))
      .map((cafe) => ({ value: cafe.id, label: cafe.name })),
  ];
  const selectedCafe = cafeId || cafeOptions[0]?.value || '';

  const suspend = useMutation({
    mutationFn: () => adminApi.suspendUser(user?.id ?? '', reason),
    onSuccess: () => {
      onChanged('User suspended and signed out everywhere.');
      onClose();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not suspend'),
  });

  const restore = useMutation({
    mutationFn: () => adminApi.restoreUser(user?.id ?? ''),
    onSuccess: () => {
      onChanged('User restored.');
      onClose();
    },
  });

  const adjust = useMutation({
    mutationFn: () =>
      adminApi.adjustPoints(user?.id ?? '', selectedCafe, pointsDelta, reason || 'Manual adjustment'),
    onSuccess: () => {
      onChanged('Points adjusted. The ledger records who did it and why.');
      setPointsDelta(0);
      void detail.refetch();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not adjust points'),
  });

  return (
    <Dialog open={user !== null} title={user?.fullName || 'User'} onClose={onClose}>
      {detail.data ? (
        <>
          <div className="gg-grid">
            <div>
              <div className="gg-overline">Points balance</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {formatNumber(detail.data.points.balance)}
              </div>
              <div className="gg-muted gg-small">
                {formatNumber(detail.data.points.lifetimeEarned)} earned ·{' '}
                {formatNumber(detail.data.points.lifetimeRedeemed)} redeemed
              </div>
              {detail.data.points.cafes.length > 0 ? (
                <div className="gg-stack gg-small" style={{ marginTop: 6, gap: 2 }}>
                  {detail.data.points.cafes.map((card) => (
                    <div key={card.businessId} className="gg-spread">
                      <span className="gg-muted">{card.businessName}</span>
                      <span>{formatNumber(card.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="gg-muted gg-small">No cafe cards yet.</div>
              )}
            </div>

            <div>
              <div className="gg-overline">Orders</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{detail.data.orderCount}</div>
              <div className="gg-muted gg-small">
                {detail.data.referralCount} referrals made
              </div>
            </div>
          </div>

          <div>
            <div className="gg-overline" style={{ marginBottom: 8 }}>
              Recent orders
            </div>
            {detail.data.recentOrders.length === 0 ? (
              <p className="gg-muted gg-small">No orders yet.</p>
            ) : (
              <div className="gg-stack">
                {detail.data.recentOrders.slice(0, 6).map((order) => (
                  <div key={order.id} className="gg-spread gg-small">
                    <span className="gg-mono">{order.orderNumber}</span>
                    <span className="gg-muted">{order.businessName}</span>
                    <StatusBadge status={order.status} />
                    <span>{formatPKR(order.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)' }} />

          <TextAreaField
            label="Reason"
            value={reason}
            onChange={setReason}
            placeholder="Required for suspension and recorded on every points adjustment."
            rows={2}
          />

          <SelectField
            label="Cafe card to adjust"
            value={selectedCafe}
            onChange={setCafeId}
            options={cafeOptions}
            hint="Points are earned and spent per cafe."
          />

          <div className="gg-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <NumberField
                label="Adjust points"
                value={pointsDelta}
                onChange={setPointsDelta}
                min={-100000}
                max={100000}
                hint="Negative to deduct. Written to the ledger, never applied directly."
              />
            </div>
            <Button
              variant="secondary"
              disabled={pointsDelta === 0 || reason.trim().length === 0 || !selectedCafe}
              loading={adjust.isPending}
              onClick={() => adjust.mutate()}
            >
              Apply
            </Button>
          </div>

          {error ? <div className="gg-error">{error}</div> : null}

          <div className="gg-row" style={{ justifyContent: 'flex-end' }}>
            {detail.data.status === 'SUSPENDED' ? (
              <Button loading={restore.isPending} onClick={() => restore.mutate()}>
                Restore account
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={reason.trim().length === 0}
                loading={suspend.isPending}
                onClick={() => suspend.mutate()}
              >
                Suspend account
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className="gg-muted">Loading…</p>
      )}
    </Dialog>
  );
}
