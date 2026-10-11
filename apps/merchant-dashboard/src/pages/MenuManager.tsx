import { MenuEditor, PageHeader } from '@grabgo/ui';
import { api } from '../api';
import { useDashboard } from '../store';

/** The cafe's own menu; the editor itself is shared with the admin dashboard. */
export function MenuPage(): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);

  if (!businessId) {
    return <PageHeader title="Menu" description="Choose a cafe first." />;
  }

  return <MenuEditor key={businessId} client={api} businessId={businessId} />;
}
