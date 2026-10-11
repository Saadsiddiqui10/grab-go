import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BusinessDetail } from '@grabgo/types';
import { Badge, CafeProfileEditor, MenuEditor, PageHeader, QueryState, Toast } from '@grabgo/ui';
import { api } from '../api';

/**
 * One cafe, edited on its behalf: its public profile and its menu. These are
 * the same editors the cafe uses in its own dashboard, against the same
 * endpoints (which admit admins for every cafe), so the two can never drift.
 * Every change is attributed to the admin in the audit log by the API.
 */
export function CafeEditorPage(): React.JSX.Element {
  const { businessId = '' } = useParams<{ businessId: string }>();
  const client = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const cafe = useQuery({
    queryKey: ['admin-cafe', businessId],
    queryFn: () => api.get<BusinessDetail>(`/cafes/${businessId}`),
    enabled: Boolean(businessId),
  });

  return (
    <>
      <div className="gg-small" style={{ marginBottom: 8 }}>
        <Link to="/cafes">← All cafes</Link>
      </div>

      <QueryState
        isLoading={cafe.isLoading}
        isError={cafe.isError}
        onRetry={() => void cafe.refetch()}
        loadingRows={2}
      >
        {cafe.data ? (
          <>
            <PageHeader
              title={cafe.data.name}
              description={[cafe.data.areaName, cafe.data.cityName].filter(Boolean).join(', ')}
              actions={
                <Badge tone={cafe.data.status === 'ACTIVE' ? 'success' : 'warning'} dot>
                  {cafe.data.status.replace(/_/g, ' ').toLowerCase()}
                </Badge>
              }
            />
            <CafeProfileEditor
              key={cafe.data.id}
              client={api}
              business={cafe.data}
              onSaved={() => {
                setToast('Cafe profile saved');
                void client.invalidateQueries({ queryKey: ['admin-cafe', businessId] });
              }}
            />
          </>
        ) : null}
      </QueryState>

      {businessId ? (
        <div style={{ marginTop: 'var(--space-xl)' }}>
          <MenuEditor
            client={api}
            businessId={businessId}
            title="Menu"
            description="Edits apply immediately and show on the customer app."
          />
        </div>
      ) : null}

      <Toast message={toast} />
    </>
  );
}
