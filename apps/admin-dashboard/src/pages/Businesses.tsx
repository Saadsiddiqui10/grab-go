import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  Badge,
  Button,
  Card,
  Dialog,
  PageHeader,
  QueryState,
  SelectField,
  TextAreaField,
  TextField,
  Toast,
  formatDate,
} from '@grabgo/ui';
import { adminApi, type AdminBusinessRow } from '../api';

/**
 * Cafe management.
 *
 * Applications land as PENDING_APPROVAL and appear at the top, because an
 * unreviewed cafe is a partner waiting on us. Onboarding creates the business
 * and its owner account together and shows the temporary password once.
 */
export function BusinessesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [decision, setDecision] = useState<{ business: AdminBusinessRow; kind: 'reject' | 'suspend' } | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const businesses = useQuery({
    queryKey: ['admin-businesses', search, status],
    queryFn: () => adminApi.businesses({ q: search || undefined, status }),
  });

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['admin-businesses'] });
  };

  const approve = useMutation({
    mutationFn: (businessId: string) => adminApi.approveBusiness(businessId),
    onSuccess: () => {
      setToast('Cafe approved and live.');
      invalidate();
    },
    // e.g. a claimed listing whose owner has not added a menu yet.
    onError: (caught) =>
      setToast(caught instanceof ApiError ? caught.displayMessage : 'Could not approve that cafe'),
  });

  const reinstate = useMutation({
    mutationFn: (businessId: string) => adminApi.reinstateBusiness(businessId),
    onSuccess: () => {
      setToast('Cafe reinstated.');
      invalidate();
    },
  });

  const pending = businesses.data?.items.filter(
    (business) => business.status === 'PENDING_APPROVAL',
  );

  return (
    <>
      <PageHeader
        title="Cafes"
        description="Approve applications, and manage partners already on the platform."
        actions={<Button onClick={() => setOnboarding(true)}>Onboard a cafe</Button>}
      />

      {pending && pending.length > 0 ? (
        <Card>
          <div className="gg-stack">
            <div className="gg-row">
              <h3>Waiting for review</h3>
              <Badge tone="warning" dot>
                {pending.length}
              </Badge>
            </div>

            {pending.map((business) => (
              <div key={business.id} className="gg-spread">
                <div>
                  <strong>{business.name}</strong>
                  <div className="gg-muted gg-small">
                    {business.areaName ? `${business.areaName}, ` : ''}
                    {business.cityName} · applied {formatDate(business.createdAt)}
                  </div>
                </div>

                <div className="gg-row">
                  <Button
                    size="sm"
                    loading={approve.isPending}
                    onClick={() => approve.mutate(business.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDecision({ business, kind: 'reject' })}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="gg-row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <TextField label="Search" value={search} onChange={setSearch} placeholder="Cafe name" />
          </div>
          <div style={{ minWidth: 200 }}>
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ALL', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'PENDING_APPROVAL', label: 'Pending approval' },
                { value: 'SUSPENDED', label: 'Suspended' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card flush>
        <QueryState
          isLoading={businesses.isLoading}
          isError={businesses.isError}
          isEmpty={(businesses.data?.items.length ?? 0) === 0}
          emptyTitle="No cafes matched"
          onRetry={() => void businesses.refetch()}
        >
          <div className="gg-table-wrap">
            <table className="gg-table">
              <thead>
                <tr>
                  <th>Cafe</th>
                  <th>Location</th>
                  <th>Orders</th>
                  <th>Rating</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>

              <tbody>
                {businesses.data?.items.map((business) => (
                  <tr key={business.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{business.name}</div>
                      <div className="gg-muted gg-small">{business.slug}</div>
                    </td>
                    <td className="gg-muted gg-small">
                      {[business.areaName, business.cityName].filter(Boolean).join(', ')}
                    </td>
                    <td>{business.orderCount}</td>
                    <td>{business.rating !== null ? business.rating.toFixed(1) : '—'}</td>
                    <td>
                      <Badge
                        tone={
                          business.status === 'ACTIVE'
                            ? 'success'
                            : business.status === 'PENDING_APPROVAL'
                              ? 'warning'
                              : business.status === 'SUSPENDED' || business.status === 'REJECTED'
                                ? 'danger'
                                : 'neutral'
                        }
                        dot
                      >
                        {business.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                    <td>
                      <div className="gg-row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/cafes/${business.id}`)}>
                          Manage
                        </Button>
                        {business.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDecision({ business, kind: 'suspend' })}
                          >
                            Suspend
                          </Button>
                        ) : business.status === 'SUSPENDED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => reinstate.mutate(business.id)}
                          >
                            Reinstate
                          </Button>
                        ) : business.status === 'PENDING_APPROVAL' ? (
                          <Button size="sm" onClick={() => approve.mutate(business.id)}>
                            Approve
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

      <DecisionDialog
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={(message) => {
          setDecision(null);
          setToast(message);
          invalidate();
        }}
      />

      <OnboardDialog
        open={onboarding}
        onClose={() => setOnboarding(false)}
        onDone={(message) => {
          setToast(message);
          invalidate();
        }}
      />

      <Toast message={toast} />
    </>
  );
}

function DecisionDialog({
  decision,
  onClose,
  onDone,
}: {
  decision: { business: AdminBusinessRow; kind: 'reject' | 'suspend' } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    // Both endpoints answer with a different boolean key, so the result is
    // normalised here rather than widening the mutation's type.
    mutationFn: async (): Promise<void> => {
      if (!decision) return;
      if (decision.kind === 'reject') {
        await adminApi.rejectBusiness(decision.business.id, note);
        return;
      }
      await adminApi.suspendBusiness(decision.business.id, note);
    },
    onSuccess: () => {
      setNote('');
      onDone(decision?.kind === 'reject' ? 'Application rejected.' : 'Cafe suspended.');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'That did not work'),
  });

  return (
    <Dialog
      open={decision !== null}
      title={
        decision?.kind === 'reject'
          ? `Reject ${decision.business.name}?`
          : `Suspend ${decision?.business.name ?? ''}?`
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={note.trim().length === 0}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {decision?.kind === 'reject' ? 'Reject' : 'Suspend'}
          </Button>
        </>
      }
    >
      <p className="gg-muted gg-small">
        {decision?.kind === 'reject'
          ? 'The applicant is told why. They can reapply.'
          : 'The cafe stops taking orders immediately. Orders already in progress are unaffected.'}
      </p>

      <TextAreaField label="Reason" value={note} onChange={setNote} rows={3} />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}

function OnboardDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const [form, setForm] = useState({
    name: '',
    addressLine: '',
    areaId: '',
    latitude: '24.8607',
    longitude: '67.0011',
    ownerName: '',
    ownerEmail: '',
  });

  const [result, setResult] = useState<{ temporaryPassword: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = useMutation({
    mutationFn: () =>
      adminApi.createBusiness({
        name: form.name.trim(),
        type: 'CAFE',
        addressLine: form.addressLine.trim(),
        areaId: form.areaId.trim(),
        coordinates: {
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
        },
        ownerName: form.ownerName.trim(),
        ownerEmail: form.ownerEmail.trim(),
      }),
    onSuccess: (created) => {
      setResult({ temporaryPassword: created.temporaryPassword });
      onDone('Cafe created. It is pending approval.');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not create that cafe'),
  });

  return (
    <Dialog
      open={open}
      title="Onboard a cafe"
      onClose={() => {
        setResult(null);
        onClose();
      }}
      footer={
        result ? (
          <Button
            onClick={() => {
              setResult(null);
              onClose();
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={submit.isPending}
              disabled={!form.name || !form.areaId || !form.ownerEmail}
              onClick={() => submit.mutate()}
            >
              Create
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="gg-stack">
          <p>
            {form.name} was created and is waiting for approval. The owner signs in with{' '}
            <strong>{form.ownerEmail}</strong>.
          </p>

          {result.temporaryPassword ? (
            <div>
              <div className="gg-overline">Temporary password</div>
              <div className="gg-mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {result.temporaryPassword}
              </div>
              <p className="gg-hint">Shown once. Pass it on securely.</p>
            </div>
          ) : (
            <p className="gg-hint">That email already had an account; their existing password works.</p>
          )}
        </div>
      ) : (
        <>
          <TextField label="Cafe name" value={form.name} onChange={set('name')} autoFocus />
          <TextField label="Address" value={form.addressLine} onChange={set('addressLine')} />
          <TextField
            label="Area id"
            value={form.areaId}
            onChange={set('areaId')}
            hint="From the cities endpoint. Seeded Karachi areas are listed in the API README."
          />

          <div className="gg-row">
            <TextField label="Latitude" value={form.latitude} onChange={set('latitude')} />
            <TextField label="Longitude" value={form.longitude} onChange={set('longitude')} />
          </div>

          <TextField label="Owner name" value={form.ownerName} onChange={set('ownerName')} />
          <TextField
            label="Owner email"
            type="email"
            value={form.ownerEmail}
            onChange={set('ownerEmail')}
          />

          {error ? <div className="gg-error">{error}</div> : null}
        </>
      )}
    </Dialog>
  );
}
