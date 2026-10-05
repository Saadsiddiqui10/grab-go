import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminListing } from '@grabgo/types';
import {
  ApiError,
  Badge,
  Button,
  Card,
  Dialog,
  PageHeader,
  QueryState,
  TextField,
  Toast,
} from '@grabgo/ui';
import { adminApi } from '../api';

/**
 * Cafes that are on the customer map but not on Grab & Go yet.
 *
 * Imported from OpenStreetMap and ranked by how many customers have asked for
 * them, so the top of this list is who to approach next. "Onboard" hands a
 * listing to its real owner: they sign in to the merchant dashboard, add a
 * menu, and the cafe then appears under Cafes for approval. Until approval it
 * can never take an order.
 */
export function ListingsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [onboarding, setOnboarding] = useState<AdminListing | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listings = useQuery({
    queryKey: ['admin-listings', search],
    queryFn: () => adminApi.listings(search || undefined),
  });

  const requested = listings.data?.filter((listing) => listing.requestCount > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title="Listings"
        description="Cafes customers can see on the map but cannot order from yet, most requested first."
      />

      <Card>
        <div className="gg-row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <TextField label="Search" value={search} onChange={setSearch} placeholder="Cafe name" />
          </div>
          {listings.data ? (
            <Badge tone={requested > 0 ? 'warning' : 'neutral'} dot>
              {requested} requested
            </Badge>
          ) : null}
        </div>
      </Card>

      <Card flush>
        <QueryState
          isLoading={listings.isLoading}
          isError={listings.isError}
          isEmpty={(listings.data?.length ?? 0) === 0}
          emptyTitle="No listings matched"
          onRetry={() => void listings.refetch()}
        >
          <div className="gg-table-wrap">
            <table className="gg-table">
              <thead>
                <tr>
                  <th>Cafe</th>
                  <th>Location</th>
                  <th>Requests</th>
                  <th>Phone</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {listings.data?.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{listing.name}</div>
                      <div className="gg-muted gg-small">OSM {listing.osmId}</div>
                    </td>
                    <td className="gg-muted gg-small">
                      {[listing.addressLine !== 'Karachi' ? listing.addressLine : null, listing.areaName]
                        .filter(Boolean)
                        .join(', ') || 'Karachi'}
                    </td>
                    <td>
                      {listing.requestCount > 0 ? (
                        <Badge tone="warning">{listing.requestCount}</Badge>
                      ) : (
                        <span className="gg-muted">0</span>
                      )}
                    </td>
                    <td className="gg-muted gg-small">{listing.phone ?? '—'}</td>
                    <td>
                      <div className="gg-row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" variant="secondary" onClick={() => setOnboarding(listing)}>
                          Onboard
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      <p className="gg-muted gg-small">
        Listing data © OpenStreetMap contributors, under the Open Database Licence. Refresh it with{' '}
        <code>npm run db:import-osm</code>.
      </p>

      <ClaimDialog
        listing={onboarding}
        onClose={() => setOnboarding(null)}
        onDone={(message) => {
          setToast(message);
          void client.invalidateQueries({ queryKey: ['admin-listings'] });
          void client.invalidateQueries({ queryKey: ['admin-businesses'] });
        }}
      />

      <Toast message={toast} />
    </>
  );
}

function ClaimDialog({
  listing,
  onClose,
  onDone,
}: {
  listing: AdminListing | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.JSX.Element {
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [result, setResult] = useState<{ temporaryPassword: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    setResult(null);
    setError(null);
    setOwnerName('');
    setOwnerEmail('');
    onClose();
  };

  const submit = useMutation({
    mutationFn: () =>
      adminApi.claimListing(listing?.id ?? '', {
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
      }),
    onSuccess: (claimed) => {
      setResult({ temporaryPassword: claimed.temporaryPassword });
      onDone(`${listing?.name ?? 'Cafe'} handed to its owner. Approve it once it has a menu.`);
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not onboard that cafe'),
  });

  return (
    <Dialog
      open={listing !== null}
      title={`Onboard ${listing?.name ?? ''}`}
      onClose={close}
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              loading={submit.isPending}
              disabled={ownerName.trim().length < 2 || !ownerEmail.includes('@')}
              onClick={() => submit.mutate()}
            >
              Onboard
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="gg-stack">
          <p>
            The owner signs in to the merchant dashboard with <strong>{ownerEmail}</strong>, adds
            their menu, and the cafe then appears under Cafes for approval. It cannot take orders
            before that.
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
          <p className="gg-muted gg-small">
            Only onboard a cafe that has agreed to join. {listing?.requestCount ?? 0} customers
            have asked for it.
          </p>
          <TextField label="Owner name" value={ownerName} onChange={setOwnerName} autoFocus />
          <TextField label="Owner email" type="email" value={ownerEmail} onChange={setOwnerEmail} />
          {error ? <div className="gg-error">{error}</div> : null}
        </>
      )}
    </Dialog>
  );
}
