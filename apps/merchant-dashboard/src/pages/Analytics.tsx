import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
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
  formatNumber,
  formatPKR,
  formatPercent,
} from '@grabgo/ui';
import { merchantApi } from '../api';
import { useDashboard } from '../store';

/**
 * Cafe analytics.
 *
 * The numbers a cafe owner asks about: how many orders, what they were worth,
 * how much reached the cafe after commission, how long orders actually took, and
 * what sells. Everything is computed server-side from settled orders only —
 * revenue counts when a customer collects, not when they tap pay.
 */

type Preset = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER';

export function AnalyticsPage(): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);
  const [preset, setPreset] = useState<Preset>('WEEK');

  const analytics = useQuery({
    queryKey: ['analytics', businessId, preset],
    queryFn: () => merchantApi.analytics(businessId as string, preset),
    enabled: Boolean(businessId),
  });

  const data = analytics.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Orders and revenue for this cafe."
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
              <Stat
                label="Collected"
                value={formatNumber(data.completedCount)}
                detail={`${formatNumber(data.cancelledCount)} cancelled`}
              />
              <Stat label="Gross revenue" value={formatPKR(data.grossRevenue)} />
              <Stat
                label="Your earnings"
                value={formatPKR(data.netEarnings)}
                detail="After platform commission"
                tone="success"
              />
              <Stat label="Average order" value={formatPKR(data.averageOrderValue)} />
              <Stat
                label="Average prep time"
                value={data.averagePrepMinutes !== null ? `${data.averagePrepMinutes} min` : '—'}
                detail="Accepted to ready"
              />
              <Stat
                label="Repeat customers"
                value={formatPercent(data.repeatCustomerRate)}
                detail="Ordered more than once in this period"
              />
            </div>

            <Card>
              <h3 style={{ marginBottom: 'var(--space-base)' }}>Orders per day</h3>

              {data.ordersByDay.length === 0 ? (
                <EmptyState title="No orders in this period" />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.ordersByDay}>
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
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="orders"
                      stroke="var(--color-primary)"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card>
              <h3 style={{ marginBottom: 'var(--space-base)' }}>Top items</h3>

              {data.topItems.length === 0 ? (
                <EmptyState title="Nothing sold in this period" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, data.topItems.length * 38)}>
                  <BarChart data={data.topItems} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                    <XAxis
                      type="number"
                      stroke="var(--color-text-muted)"
                      fontSize={12}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="var(--color-text-muted)"
                      fontSize={12}
                      width={140}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--color-surface-muted)' }}
                      contentStyle={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12,
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <Bar dataKey="quantity" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </>
        ) : null}
      </QueryState>
    </>
  );
}
