import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { RealtimeEvent, type OrderDetail, type OrderRejectionReason } from '@grabgo/types';
import { REJECTION_REASON_LABELS } from '@grabgo/types';
import {
  ApiError,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  QueryState,
  SelectField,
  TextField,
  Toast,
  formatPKR,
  formatTime,
  minutesSince,
} from '@grabgo/ui';
import { api, merchantApi, REALTIME_URL } from '../api';
import { useDashboard } from '../store';
import { usePosStatus } from './PosIntegration';

/**
 * The live order board.
 *
 * This is the screen a cafe actually runs on, so it is built for a counter:
 * four columns, large codes, one obvious action per ticket, and a waiting timer
 * that makes the oldest order impossible to miss.
 *
 * New tickets arrive over the socket. Polling every 20 seconds is the backstop —
 * a missed order is a customer standing at a counter for nothing.
 */

type Column = 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED';

export function LiveOrdersPage(): React.JSX.Element {
  const client = useQueryClient();
  const businessId = useDashboard((state) => state.businessId);

  const [toast, setToast] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OrderDetail | null>(null);
  const [verifying, setVerifying] = useState<OrderDetail | null>(null);

  const orders = useQuery({
    queryKey: ['orders', businessId, 'board'],
    queryFn: async () => {
      const [nw, preparing, ready, completed] = await Promise.all([
        merchantApi.orders(businessId as string, 'NEW'),
        merchantApi.orders(businessId as string, 'PREPARING'),
        merchantApi.orders(businessId as string, 'READY'),
        merchantApi.orders(businessId as string, 'COMPLETED'),
      ]);

      return {
        NEW: nw.items,
        PREPARING: preparing.items,
        READY: ready.items,
        // The completed column is a short tail, not a history page.
        COMPLETED: completed.items.slice(0, 12),
      } satisfies Record<Column, OrderDetail[]>;
    },
    enabled: Boolean(businessId),
    refetchInterval: 20_000,
  });

  /* -------------------------------------------------------------- realtime */

  useEffect(() => {
    if (!businessId) return;

    const token = api.accessToken();
    if (!token) return;

    const socket: Socket = io(REALTIME_URL, {
      path: '/realtime',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('subscribe:business', businessId);
    });

    const refresh = (): void => {
      void client.invalidateQueries({ queryKey: ['orders', businessId] });
    };

    socket.on(RealtimeEvent.ORDER_CREATED, () => {
      refresh();
      setToast('New order received');
      // An audible cue matters in a noisy cafe where nobody is watching the screen.
      void chime();
    });

    socket.on(RealtimeEvent.ORDER_STATUS_CHANGED, refresh);
    socket.on(RealtimeEvent.ORDER_PAYMENT_CHANGED, refresh);

    return () => {
      socket.emit('unsubscribe:business', businessId);
      socket.disconnect();
    };
  }, [businessId, client]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  /* -------------------------------------------------------------- actions */

  const act = useMutation({
    mutationFn: async (input: { order: OrderDetail; action: 'accept' | 'preparing' | 'ready' | 'complete' }) => {
      const id = input.order.id;
      switch (input.action) {
        case 'accept':
          return merchantApi.accept(businessId as string, id);
        case 'preparing':
          return merchantApi.preparing(businessId as string, id);
        case 'ready':
          return merchantApi.ready(businessId as string, id);
        case 'complete':
          return merchantApi.complete(businessId as string, id);
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['orders', businessId] });
    },
    onError: (error) => {
      setToast(error instanceof ApiError ? error.displayMessage : 'That did not work');
    },
  });

  if (!businessId) {
    return <EmptyState title="No cafe selected" body="Choose a cafe to see its orders." />;
  }

  const board = orders.data;
  const newCount = board?.NEW.length ?? 0;

  return (
    <>
      <PageHeader
        title="Live orders"
        description="Accept, prepare and hand over Grab & Go orders."
        actions={
          <>
            {newCount > 0 ? (
              <Badge tone="primary" dot>
                {newCount} waiting
              </Badge>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void orders.refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      {businessId ? <PosAlert businessId={businessId} onToast={setToast} /> : null}

      <QueryState
        isLoading={orders.isLoading}
        isError={orders.isError}
        onRetry={() => void orders.refetch()}
      >
        <div className="gg-board">
          <BoardColumn
            title="New"
            tone="primary"
            orders={board?.NEW ?? []}
            emptyLabel="No new orders"
            renderActions={(order) => (
              <div className="gg-row">
                <Button
                  size="sm"
                  onClick={() => act.mutate({ order, action: 'accept' })}
                  loading={act.isPending}
                >
                  Accept
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRejecting(order)}>
                  Reject
                </Button>
              </div>
            )}
          />

          <BoardColumn
            title="Preparing"
            tone="warning"
            orders={board?.PREPARING ?? []}
            emptyLabel="Nothing being made"
            renderActions={(order) =>
              order.status === 'ACCEPTED' ? (
                <div className="gg-row">
                  <Button size="sm" onClick={() => act.mutate({ order, action: 'preparing' })}>
                    Start preparing
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => act.mutate({ order, action: 'ready' })}
                  >
                    Mark ready
                  </Button>
                </div>
              ) : (
                <Button size="sm" block onClick={() => act.mutate({ order, action: 'ready' })}>
                  Mark ready
                </Button>
              )
            }
          />

          <BoardColumn
            title="Ready"
            tone="success"
            orders={board?.READY ?? []}
            emptyLabel="Nothing waiting for pickup"
            showCode
            renderActions={(order) => (
              <Button size="sm" block onClick={() => setVerifying(order)}>
                Verify pickup
              </Button>
            )}
          />

          <BoardColumn
            title="Completed"
            tone="neutral"
            orders={board?.COMPLETED ?? []}
            emptyLabel="No orders collected yet"
            renderActions={(order) =>
              order.status === 'PICKED_UP' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => act.mutate({ order, action: 'complete' })}
                >
                  Close order
                </Button>
              ) : null
            }
          />
        </div>
      </QueryState>

      <RejectDialog
        order={rejecting}
        onClose={() => setRejecting(null)}
        onDone={(message) => {
          setRejecting(null);
          setToast(message);
          void client.invalidateQueries({ queryKey: ['orders', businessId] });
        }}
      />

      <VerifyDialog
        order={verifying}
        onClose={() => setVerifying(null)}
        onDone={(message) => {
          setVerifying(null);
          setToast(message);
          void client.invalidateQueries({ queryKey: ['orders', businessId] });
        }}
      />

      <Toast message={toast} />
    </>
  );
}

/* ---------------------------------------------------------------- column */

function BoardColumn({
  title,
  tone,
  orders,
  emptyLabel,
  showCode,
  renderActions,
}: {
  title: string;
  tone: 'primary' | 'warning' | 'success' | 'neutral';
  orders: OrderDetail[];
  emptyLabel: string;
  showCode?: boolean;
  renderActions: (order: OrderDetail) => React.ReactNode;
}): React.JSX.Element {
  const modifier =
    tone === 'primary'
      ? 'gg-ticket--new'
      : tone === 'warning'
        ? 'gg-ticket--preparing'
        : tone === 'success'
          ? 'gg-ticket--ready'
          : '';

  return (
    <section className="gg-column" aria-label={title}>
      <div className="gg-column__header">
        <h3>{title}</h3>
        <Badge tone={tone}>{orders.length}</Badge>
      </div>

      {orders.length === 0 ? (
        <Card>
          <span className="gg-muted gg-small">{emptyLabel}</span>
        </Card>
      ) : (
        orders.map((order) => (
          <article key={order.id} className={`gg-ticket ${modifier}`}>
            <div className="gg-spread">
              <strong style={{ fontSize: 15 }}>{order.orderNumber}</strong>
              <WaitTimer order={order} />
            </div>

            {/* Curbside: the plate is how the runner finds the car, so it sits
                right under the order number, big enough to read across a bar. */}
            {order.pickupMethod === 'CURBSIDE' ? (
              <div
                className="gg-row"
                style={{
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-info-muted, #e8f0fe)',
                }}
                aria-label={`Bring to car, plate ${order.vehiclePlate ?? 'not given'}`}
              >
                <span aria-hidden>🚗</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="gg-overline">Bring to car</div>
                  {order.vehicleDetails ? (
                    <div className="gg-small gg-muted">{order.vehicleDetails}</div>
                  ) : null}
                </div>
                <strong
                  style={{
                    fontSize: 16,
                    letterSpacing: 1,
                    padding: '2px 8px',
                    border: '2px solid currentColor',
                    borderRadius: 6,
                    background: 'var(--color-surface, #fff)',
                  }}
                >
                  {order.vehiclePlate}
                </strong>
              </div>
            ) : null}

            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} className="gg-stack">
              {order.items.map((item) => (
                <li key={item.id}>
                  <div className="gg-row" style={{ alignItems: 'flex-start', gap: 8 }}>
                    <span className="gg-muted" style={{ minWidth: 22 }}>
                      {item.quantity}×
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{item.name}</div>
                      {item.variantName || item.modifiers.length > 0 ? (
                        <div className="gg-muted gg-small">
                          {[item.variantName, ...item.modifiers.map((m) => m.optionName)]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                      {item.notes ? (
                        <div
                          className="gg-small"
                          style={{ color: 'var(--color-warning)', fontStyle: 'italic' }}
                        >
                          “{item.notes}”
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {order.customerNote ? (
              <div
                className="gg-small"
                style={{
                  background: 'var(--color-warning-muted)',
                  color: 'var(--amber-600)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Note: {order.customerNote}
              </div>
            ) : null}

            {showCode && order.pickupCode ? (
              <div>
                <div className="gg-overline">Pickup code</div>
                <div className="gg-ticket__code">{order.pickupCode}</div>
              </div>
            ) : null}

            <div className="gg-spread gg-small gg-muted">
              <span>Pickup {formatTime(order.pickupAt)}</span>
              <span>{formatPKR(order.total)}</span>
            </div>

            {order.paymentStatus !== 'PAID' ? (
              <Badge tone={order.paymentMethod === 'CASH_ON_PICKUP' ? 'info' : 'warning'}>
                {order.paymentMethod === 'CASH_ON_PICKUP' ? 'Pay at counter' : 'Payment pending'}
              </Badge>
            ) : null}

            {renderActions(order)}
          </article>
        ))
      )}
    </section>
  );
}

/**
 * How long this ticket has been waiting.
 *
 * Turns amber past five minutes and red past ten — the number a barista needs
 * is "am I late", not a timestamp.
 */
function WaitTimer({ order }: { order: OrderDetail }): React.JSX.Element {
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const waiting = minutesSince(order.createdAt);
  const tone = waiting >= 10 ? 'danger' : waiting >= 5 ? 'warning' : 'neutral';

  return <Badge tone={tone}>{waiting} min</Badge>;
}

/* ---------------------------------------------------------------- dialogs */

function RejectDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderDetail | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);
  const [reason, setReason] = useState<OrderRejectionReason>('ITEM_UNAVAILABLE');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      merchantApi.reject(businessId as string, order?.id ?? '', reason, note || undefined),
    onSuccess: () => onDone('Order rejected. The customer has been told.'),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not reject that order'),
  });

  return (
    <Dialog
      open={order !== null}
      title={`Reject ${order?.orderNumber ?? ''}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep order
          </Button>
          <Button variant="danger" loading={submit.isPending} onClick={() => submit.mutate()}>
            Reject order
          </Button>
        </>
      }
    >
      <p className="gg-muted gg-small">
        The customer is notified with the reason you choose, and any payment is refunded.
      </p>

      <SelectField
        label="Reason"
        value={reason}
        onChange={setReason}
        options={(Object.keys(REJECTION_REASON_LABELS) as OrderRejectionReason[]).map(
          (value) => ({ value, label: REJECTION_REASON_LABELS[value] }),
        )}
      />

      <TextField
        label="Note to the customer (optional)"
        value={note}
        onChange={setNote}
        placeholder="We ran out of oat milk"
      />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}

/**
 * Pickup verification.
 *
 * The code is sent to the server, which compares it in constant time and
 * attempt-limits the order. Nothing is compared in the browser — a check that
 * runs on the client is a check anyone can skip.
 */
function VerifyDialog({
  order,
  onClose,
  onDone,
}: {
  order: OrderDetail | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode('');
    setError(null);
  }, [order]);

  const submit = useMutation({
    mutationFn: () => merchantApi.verifyPickup(businessId as string, order?.id ?? '', code),
    onSuccess: () => onDone('Order handed over.'),
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.displayMessage : 'That code could not be verified',
      ),
  });

  return (
    <Dialog
      open={order !== null}
      title={`Hand over ${order?.orderNumber ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={code.trim().length < 4}
            onClick={() => submit.mutate()}
          >
            Verify and complete
          </Button>
        </>
      }
    >
      <p className="gg-muted gg-small">
        Ask the customer for their Grab code, or scan the QR on their screen.
      </p>

      <TextField
        label="Pickup code"
        value={code}
        onChange={(next) => {
          setCode(next.toUpperCase());
          setError(null);
        }}
        placeholder="G2H4KX"
        autoFocus
      />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}

/**
 * A short two-tone chime for a new order.
 *
 * Synthesised rather than shipped as an audio file so there is no asset to load
 * and no autoplay policy to fight; browsers allow this once the page has been
 * interacted with, and a cafe dashboard always has been.
 */
async function chime(): Promise<void> {
  try {
    const context = new AudioContext();
    const now = context.currentTime;

    for (const [index, frequency] of [880, 1174].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + index * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, now + index * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.14 + 0.18);

      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + index * 0.14);
      oscillator.stop(now + index * 0.14 + 0.2);
    }

    setTimeout(() => void context.close(), 800);
  } catch {
    // Audio unavailable or blocked; the visual banner still fires.
  }
}

/**
 * Shown only when orders have not reached the café's POS: it is the screen
 * staff actually look at, so a broken till integration cannot go unnoticed.
 */
function PosAlert({
  businessId,
  onToast,
}: {
  businessId: string;
  onToast: (message: string) => void;
}): React.JSX.Element | null {
  const client = useQueryClient();
  const status = usePosStatus(businessId);
  const retry = useMutation({
    mutationFn: () => merchantApi.retryPos(businessId),
    onSuccess: (result) => {
      client.setQueryData(['pos-status', businessId], result.status);
      const left = result.status.failedCount + result.status.recentProblems.length;
      onToast(left === 0 ? 'Everything reached your POS' : 'Some orders still did not reach your POS');
    },
    onError: () => onToast('Could not retry'),
  });

  const data = status.data;
  if (!data || data.provider === 'NONE' || !data.isEnabled) return null;
  const stuck = new Set(data.recentProblems.map((job) => job.orderNumber));
  if (stuck.size === 0) return null;

  return (
    <div
      role="alert"
      className="gg-spread"
      style={{
        flexWrap: 'wrap',
        marginBottom: 'var(--space-base)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        background: data.failedCount > 0 ? 'var(--color-danger-muted)' : 'var(--color-warning-muted)',
      }}
    >
      <span className="gg-small" style={{ flex: '1 1 280px' }}>
        <strong>
          {stuck.size} {stuck.size === 1 ? 'order has' : 'orders have'} not reached your POS
        </strong>{' '}
        ({[...stuck].slice(0, 3).join(', ')}
        {stuck.size > 3 ? '…' : ''}). {data.failedCount > 0 ? 'Retries have stopped.' : 'Retrying automatically.'}{' '}
        They are all here on the board.
      </span>
      <div className="gg-row">
        <Button size="sm" variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending}>
          Retry now
        </Button>
        <a className="gg-small" href="/settings#pos">
          Details
        </a>
      </div>
    </div>
  );
}
