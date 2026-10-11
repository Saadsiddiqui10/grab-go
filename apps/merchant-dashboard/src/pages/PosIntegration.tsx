import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Badge,
  Button,
  Card,
  SelectField,
  TextField,
  Toggle,
  formatDateTime,
  formatRelative,
} from '@grabgo/ui';
import { merchantApi, type PosStatus } from '../api';

/**
 * Point-of-sale connection.
 *
 * Grab & Go stays the order board; this sends each order event to the café's
 * POS too, so the till and kitchen printer see app orders without anyone
 * re-keying them. Deliveries that fail are retried automatically and listed
 * here, where any staff member can push them again once the POS is back.
 */

export function usePosStatus(businessId: string) {
  return useQuery({
    queryKey: ['pos-status', businessId],
    queryFn: () => merchantApi.posStatus(businessId),
    enabled: Boolean(businessId),
    refetchInterval: 30_000,
  });
}

export function PosCard({
  businessId,
  isManager,
  onToast,
}: {
  businessId: string;
  isManager: boolean;
  onToast: (message: string) => void;
}): React.JSX.Element {
  const status = usePosStatus(businessId);

  return (
    <Card>
      <div className="gg-stack" id="pos">
        <div className="gg-spread">
          <h3>Point of sale</h3>
          {status.data ? <ConnectionBadge status={status.data} /> : null}
        </div>
        <p className="gg-muted gg-small">
          Send every Grab &amp; Go order to your till or kitchen system as it comes in and as it
          changes. If your POS is down, orders still work here; we keep retrying in the
          background and list anything that didn&apos;t get through below.
        </p>

        {status.data ? (
          <>
            <ConnectionForm
              key={`${status.data.provider}:${status.data.endpointUrl ?? ''}`}
              businessId={businessId}
              status={status.data}
              isManager={isManager}
              onToast={onToast}
            />
            <SyncProblems businessId={businessId} status={status.data} onToast={onToast} />
            <ReceiverNotes />
          </>
        ) : status.isError ? (
          <span className="gg-error gg-small">Could not load the POS connection.</span>
        ) : (
          <span className="gg-muted gg-small">Loading…</span>
        )}
      </div>
    </Card>
  );
}

function ConnectionBadge({ status }: { status: PosStatus }): React.JSX.Element {
  if (status.provider === 'NONE' || !status.isEnabled) return <Badge tone="neutral">Not connected</Badge>;
  if (status.failedCount > 0) return <Badge tone="danger" dot>{status.failedCount} failed</Badge>;
  if (status.lastFailureAt && (!status.lastSuccessAt || status.lastFailureAt > status.lastSuccessAt)) {
    return <Badge tone="warning" dot>Retrying</Badge>;
  }
  return <Badge tone="success" dot>Connected</Badge>;
}

function ConnectionForm({
  businessId,
  status,
  isManager,
  onToast,
}: {
  businessId: string;
  status: PosStatus;
  isManager: boolean;
  onToast: (message: string) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const [provider, setProvider] = useState<'NONE' | 'WEBHOOK'>(status.provider);
  const [endpointUrl, setEndpointUrl] = useState(status.endpointUrl ?? '');
  const [enabled, setEnabled] = useState(status.provider === 'NONE' ? true : status.isEnabled);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = (): void => void client.invalidateQueries({ queryKey: ['pos-status', businessId] });
  const fail = (caught: unknown, fallback: string): void =>
    setError(caught instanceof ApiError ? caught.displayMessage : fallback);

  const save = useMutation({
    mutationFn: () =>
      merchantApi.configurePos(businessId, {
        provider,
        endpointUrl: provider === 'NONE' ? null : endpointUrl.trim(),
        isEnabled: enabled,
      }),
    onSuccess: (result) => {
      setError(null);
      if (result.secret) setSecret(result.secret);
      onToast(provider === 'NONE' ? 'POS disconnected' : 'POS connection saved');
      refresh();
    },
    onError: (caught) => fail(caught, 'Could not save the connection'),
  });

  const rotate = useMutation({
    mutationFn: () => merchantApi.rotatePosSecret(businessId),
    onSuccess: (result) => {
      setSecret(result.secret);
      onToast('New signing secret created');
    },
    onError: (caught) => fail(caught, 'Could not create a new secret'),
  });

  const test = useMutation({
    mutationFn: () => merchantApi.testPos(businessId),
    onSuccess: (result) => {
      setTestResult(result);
      refresh();
    },
    onError: (caught) => fail(caught, 'Could not send a test'),
  });

  const connected = status.provider !== 'NONE';

  return (
    <div className="gg-stack">
      <div className="gg-grid">
        <SelectField
          label="Connection"
          value={provider}
          onChange={setProvider}
          options={[
            { value: 'NONE', label: 'Not connected' },
            { value: 'WEBHOOK', label: 'Webhook (any POS that accepts HTTPS)' },
          ]}
        />
        {provider === 'WEBHOOK' ? (
          <TextField
            label="Endpoint URL"
            value={endpointUrl}
            onChange={setEndpointUrl}
            placeholder="https://pos.example.com/grabgo"
            hint="Your POS vendor gives you this. It must be https://."
            disabled={!isManager}
          />
        ) : null}
      </div>

      {provider === 'WEBHOOK' ? (
        <Toggle
          label="Send orders to this POS"
          checked={enabled}
          onChange={setEnabled}
          hint="Turn off to pause sending without losing the setup."
        />
      ) : null}

      {secret ? (
        <div
          role="status"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-warning-muted)',
          }}
          className="gg-stack"
        >
          <strong className="gg-small">Copy this signing secret now. It will not be shown again.</strong>
          <code style={{ wordBreak: 'break-all' }}>{secret}</code>
          <div className="gg-row">
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(secret)}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              I&apos;ve saved it
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <div className="gg-error gg-small">{error}</div> : null}

      {testResult ? (
        <div className={testResult.ok ? 'gg-small' : 'gg-error gg-small'}>
          {testResult.ok ? '✓ ' : ''}
          {testResult.message}
        </div>
      ) : null}

      {connected && status.isEnabled ? (
        <div className="gg-small gg-muted">
          {status.lastSuccessAt ? `Last delivered ${formatRelative(status.lastSuccessAt)}. ` : 'Nothing delivered yet. '}
          {status.lastError && status.lastFailureAt && (!status.lastSuccessAt || status.lastFailureAt > status.lastSuccessAt)
            ? `Last problem ${formatRelative(status.lastFailureAt)}: ${status.lastError}`
            : ''}
        </div>
      ) : null}

      {isManager ? (
        <div className="gg-row" style={{ flexWrap: 'wrap' }}>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={provider === 'WEBHOOK' && endpointUrl.trim().length === 0}
          >
            Save connection
          </Button>
          {connected ? (
            <>
              <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
                Send a test
              </Button>
              <Button
                variant="ghost"
                loading={rotate.isPending}
                onClick={() => {
                  if (window.confirm('Create a new signing secret? Your POS must be updated with it, or deliveries will be rejected.')) {
                    rotate.mutate();
                  }
                }}
              >
                New signing secret
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="gg-muted gg-small">Only a manager can change the connection.</p>
      )}
    </div>
  );
}

function SyncProblems({
  businessId,
  status,
  onToast,
}: {
  businessId: string;
  status: PosStatus;
  onToast: (message: string) => void;
}): React.JSX.Element | null {
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: (jobId?: string) => merchantApi.retryPos(businessId, jobId),
    onSuccess: (result) => {
      client.setQueryData(['pos-status', businessId], result.status);
      const left = result.status.failedCount + result.status.pendingCount;
      onToast(left === 0 ? 'Everything reached your POS' : `Retried ${result.retried}; ${left} still not through`);
    },
    onError: (caught) =>
      onToast(caught instanceof ApiError ? caught.displayMessage : 'Could not retry'),
  });

  if (status.recentProblems.length === 0) return null;

  return (
    <div className="gg-stack">
      <div className="gg-spread">
        <strong className="gg-small">Not yet in your POS</strong>
        <Button size="sm" variant="secondary" onClick={() => retry.mutate(undefined)} loading={retry.isPending}>
          Retry all
        </Button>
      </div>
      <div className="gg-table-wrap">
        <table className="gg-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Event</th>
              <th>Status</th>
              <th>Problem</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {status.recentProblems.map((job) => (
              <tr key={job.id}>
                <td className="gg-mono">{job.orderNumber}</td>
                <td className="gg-small">{job.event.replace('order.', '').replace(/_/g, ' ')}</td>
                <td>
                  {job.status === 'FAILED' ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : (
                    <Badge tone="warning">
                      Retrying{job.nextAttemptAt ? ` ${formatRelative(job.nextAttemptAt)}` : ''}
                    </Badge>
                  )}
                </td>
                <td className="gg-small gg-muted" title={formatDateTime(job.createdAt)}>
                  {job.lastError ?? '—'} · {job.attempts} {job.attempts === 1 ? 'attempt' : 'attempts'}
                </td>
                <td>
                  <Button size="sm" variant="ghost" onClick={() => retry.mutate(job.id)}>
                    Retry
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What a POS developer needs, without leaving the page. */
function ReceiverNotes(): React.JSX.Element {
  return (
    <details className="gg-small">
      <summary>For your POS developer</summary>
      <div className="gg-stack" style={{ marginTop: 8 }}>
        <p>
          Each event is a JSON POST. Events: <code>order.created</code>, <code>order.paid</code>,{' '}
          <code>order.accepted</code>, <code>order.preparing</code>, <code>order.ready</code>,{' '}
          <code>order.picked_up</code>, <code>order.completed</code>,{' '}
          <code>order.cancelled_by_customer</code>, <code>order.cancelled_by_cafe</code>,{' '}
          <code>order.cancelled_by_admin</code>, <code>order.expired</code>, and <code>ping</code> for
          tests.
          Amounts are in paisa.
        </p>
        <p>
          Verify <code>X-GrabGo-Signature</code>: it is <code>v1=</code> followed by the hex
          HMAC-SHA256 of <code>{'`${X-GrabGo-Timestamp}.${rawBody}`'}</code> with the signing
          secret. Reject timestamps older than five minutes.
        </p>
        <p>
          Delivery is at least once: deduplicate on <code>X-GrabGo-Delivery</code>. Answer 2xx
          to accept. 408, 429 and 5xx are retried (30s, 2m, 10m, 30m, 2h, 6h); any other 4xx is
          treated as a rejected payload and is not retried automatically.
        </p>
      </div>
    </details>
  );
}
