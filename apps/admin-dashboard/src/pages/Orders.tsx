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
  StatusBadge,
  TextAreaField,
  TextField,
  Toast,
  formatDateTime,
  formatPKR,
} from '@grabgo/ui';
import { adminApi, type AdminOrderRow } from '../api';

/**
 * Order support.
 *
 * What a support agent actually needs: find the order someone is calling about,
 * see whether it was paid, and either cancel it or refund it. Both actions are
 * audited with the reason typed here.
 */
export function OrdersPage(): React.JSX.Element {
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [acting, setActing] = useState<{ order: AdminOrderRow; kind: 'cancel' | 'refund' } | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(null);

  const orders = useQuery({
    queryKey: ['admin-orders', search, status],
    queryFn: () => adminApi.orders({ q: search || undefined, status }),
  });

  return (
    <>
      <PageHeader title="Orders" description="Find an order, resolve an issue, issue a refund." />

      <Card>
        <div className="gg-row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <TextField
              label="Search"
              value={search}
              onChange={setSearch}
              placeholder="Order number, customer email or phone"
            />
          </div>
          <div style={{ minWidth: 200 }}>
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'PENDING', label: 'Pending' },
                { value: 'ACCEPTED', label: 'Accepted' },
                { value: 'PREPARING', label: 'Preparing' },
                { value: 'READY', label: 'Ready' },
                { value: 'PICKED_UP', label: 'Collected' },
                { value: 'COMPLETED', label: 'Completed' },
                { value: 'CANCELLED_BY_CAFE', label: 'Cancelled by cafe' },
                { value: 'CANCELLED_BY_CUSTOMER', label: 'Cancelled by customer' },
                { value: 'EXPIRED', label: 'Expired' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card flush>
        <QueryState
          isLoading={orders.isLoading}
          isError={orders.isError}
          isEmpty={(orders.data?.items.length ?? 0) === 0}
          emptyTitle="No orders matched"
          onRetry={() => void orders.refetch()}
        >
          <div className="gg-table-wrap">
            <table className="gg-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Cafe</th>
                  <th>Customer</th>
                  <th>Total</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>

              <tbody>
                {orders.data?.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <div className="gg-mono" style={{ fontWeight: 600 }}>
                        {order.orderNumber}
                      </div>
                      <div className="gg-muted gg-small">{formatDateTime(order.createdAt)}</div>
                    </td>
                    <td>{order.businessName}</td>
                    <td className="gg-muted">{order.customerName || '—'}</td>
                    <td>{formatPKR(order.total)}</td>
                    <td>
                      <Badge
                        tone={
                          order.paymentStatus === 'PAID'
                            ? 'success'
                            : order.paymentStatus === 'FAILED'
                              ? 'danger'
                              : order.paymentStatus.includes('REFUND')
                                ? 'info'
                                : 'warning'
                        }
                      >
                        {order.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                    </td>
                    <td>
                      <div className="gg-row" style={{ justifyContent: 'flex-end' }}>
                        {['PENDING', 'ACCEPTED', 'PREPARING', 'READY'].includes(order.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActing({ order, kind: 'cancel' })}
                          >
                            Cancel
                          </Button>
                        ) : null}

                        {order.paymentStatus === 'PAID' ||
                        order.paymentStatus === 'PARTIALLY_REFUNDED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setActing({ order, kind: 'refund' })}
                          >
                            Refund
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <ActionDialog
        acting={acting}
        onClose={() => setActing(null)}
        onDone={(message) => {
          setActing(null);
          setToast(message);
          void client.invalidateQueries({ queryKey: ['admin-orders'] });
        }}
      />

      <Toast message={toast} />
    </>
  );
}

function ActionDialog({
  acting,
  onClose,
  onDone,
}: {
  acting: { order: AdminOrderRow; kind: 'cancel' | 'refund' } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [refundWithCancel, setRefundWithCancel] = useState(true);
  const [amountRupees, setAmountRupees] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => {
      if (!acting) throw new Error('Nothing selected');

      if (acting.kind === 'cancel') {
        return adminApi.cancelOrder(acting.order.id, reason, refundWithCancel);
      }

      // Zero means the whole remaining balance.
      return adminApi.refundOrder(
        acting.order.id,
        reason,
        amountRupees > 0 ? Math.round(amountRupees * 100) : undefined,
      );
    },
    onSuccess: () => {
      setReason('');
      setAmountRupees(0);
      onDone(acting?.kind === 'cancel' ? 'Order cancelled.' : 'Refund issued.');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'That did not work'),
  });

  return (
    <Dialog
      open={acting !== null}
      title={
        acting?.kind === 'cancel'
          ? `Cancel ${acting.order.orderNumber}`
          : `Refund ${acting?.order.orderNumber ?? ''}`
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="danger"
            disabled={reason.trim().length === 0}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {acting?.kind === 'cancel' ? 'Cancel order' : 'Issue refund'}
          </Button>
        </>
      }
    >
      <p className="gg-muted gg-small">
        Recorded in the audit log against your account, with the reason below.
      </p>

      <TextAreaField label="Reason" value={reason} onChange={setReason} rows={3} />

      {acting?.kind === 'cancel' ? (
        <label className="gg-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={refundWithCancel}
            onChange={(event) => setRefundWithCancel(event.target.checked)}
            style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }}
          />
          <span>Refund the customer as well</span>
        </label>
      ) : (
        <NumberField
          label="Amount"
          value={amountRupees}
          onChange={setAmountRupees}
          min={0}
          step={10}
          suffix="Rs."
          hint={`Leave at 0 to refund the full ${formatPKR(acting?.order.total ?? 0)}.`}
        />
      )}

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}
