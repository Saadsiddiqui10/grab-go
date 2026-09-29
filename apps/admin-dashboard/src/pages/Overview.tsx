import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Card,
  EmptyState,
  PageHeader,
  QueryState,
  SelectField,
  Stat,
  formatDateTime,
  formatNumber,
  formatPKR,
  formatPercent,
} from '@grabgo/ui';
import { adminApi } from '../api';

/**
 * Platform overview.
 *
 * The numbers that say whether the product is working: are people ordering, are
 * they coming back, is the loyalty programme being used, and are referrals
 * actually converting rather than just being shared.
 */

type Preset = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export function OverviewPage(): React.JSX.Element {
  const [preset, setPreset] = useState<Preset>('WEEK');

  const analytics = useQuery({
    queryKey: ['admin-analytics', preset],
    queryFn: () => adminApi.analytics(preset),
  });

  const audit = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminApi.auditLogs({}) });

  const data = analytics.data;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Platform activity across every cafe."
        actions={
          <div style={{ minWidth: 180 }}>
            <SelectField
              label="Period"
              value={preset}
              onChange={setPreset}
              options={[
                { value: 'TODAY', label: 'Today' },
                { value: 'WEEK', label: 'Last 7 days' },
                { value: 'MONTH', label: 'Last 30 days' },
                { value: 'QUARTER', label: 'Last 3 months' },
                { value: 'YEAR', label: 'Last year' },
              ]}
            />
          </div>
        }
      />

      <QueryState
        isLoading={analytics.isLoading}
        isError={analytics.isError}
        onRetry={() => void analytics.refetch()}
      >
        {data ? (
          <>
            <div className="gg-grid">
              <Stat label="Orders" value={formatNumber(data.orderCount)} />
              <Stat label="Gross revenue" value={formatPKR(data.grossRevenue)} />
              <Stat
                label="Platform commission"
                value={formatPKR(data.platformCommission)}
                tone="success"
              />
              <Stat label="Average order" value={formatPKR(data.averageOrderValue)} />
              <Stat
                label="Active customers"
                value={formatNumber(data.activeUsers)}
                detail={`${formatNumber(data.newUsers)} new`}
              />
              <Stat
                label="Repeat rate"
                value={formatPercent(data.repeatUserRate)}
                detail="Ordered more than once in this period"
              />
              <Stat
                label="Points issued"
                value={formatNumber(data.pointsIssued)}
                detail={`${formatNumber(data.pointsRedeemed)} redeemed`}
              />
              <Stat
                label="Referral conversions"
                value={formatNumber(data.referralConversions)}
                detail={`${formatNumber(data.referralSignups)} signed up`}
              />
            </div>

            <Card>
              <h3 style={{ marginBottom: 'var(--space-base)' }}>Revenue</h3>

              {data.ordersByDay.length === 0 ? (
                <EmptyState title="No orders in this period" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.ordersByDay}>
                    <defs>
                      <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="var(--color-text-muted)"
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--color-text-muted)"
                      fontSize={12}
                      tickLine={false}
                      tickFormatter={(value: number) => `${Math.round(value / 100000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-primary)"
                      strokeWidth={2.5}
                      fill="url(#revenue)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>

            <div className="gg-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              <Card flush>
                <h3 style={{ padding: 'var(--space-base)' }}>Top cafes</h3>
                <div className="gg-table-wrap">
                  <table className="gg-table">
                    <thead>
                      <tr>
                        <th>Cafe</th>
                        <th>Orders</th>
                        <th>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topBusinesses.map((business) => (
                        <tr key={business.businessId}>
                          <td>{business.name}</td>
                          <td>{formatNumber(business.orders)}</td>
                          <td>{formatPKR(business.revenue)}</td>
                        </tr>
                      ))}
                      {data.topBusinesses.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="gg-muted gg-small">
                            No orders yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card flush>
                <h3 style={{ padding: 'var(--space-base)' }}>Top products</h3>
                <div className="gg-table-wrap">
                  <table className="gg-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((product) => (
                        <tr key={`${product.menuItemId}-${product.name}`}>
                          <td>{product.name}</td>
                          <td>{formatNumber(product.quantity)}</td>
                        </tr>
                      ))}
                      {data.topProducts.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="gg-muted gg-small">
                            Nothing sold yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        ) : null}
      </QueryState>

      {/* --------------------------------------------------------- audit */}
      <Card flush>
        <div style={{ padding: 'var(--space-base)' }}>
          <h3>Recent admin activity</h3>
          <p className="gg-muted gg-small">
            Every privileged action, with who did it and what changed.
          </p>
        </div>

        <QueryState
          isLoading={audit.isLoading}
          isError={audit.isError}
          isEmpty={(audit.data?.length ?? 0) === 0}
          emptyTitle="Nothing logged yet"
          onRetry={() => void audit.refetch()}
          loadingRows={4}
        >
          <div className="gg-table-wrap">
            <table className="gg-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.slice(0, 25).map((entry) => (
                  <tr key={entry.id}>
                    <td className="gg-muted gg-small">{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.actorName}</td>
                    <td className="gg-mono gg-small">{entry.action}</td>
                    <td className="gg-muted gg-small">
                      {entry.targetType}
                      {entry.targetId ? ` · ${entry.targetId.slice(0, 10)}…` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>
    </>
  );
}
