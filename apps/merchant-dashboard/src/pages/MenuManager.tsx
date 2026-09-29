import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MenuItem } from '@grabgo/types';
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
  Toggle,
  formatPKR,
} from '@grabgo/ui';
import { merchantApi } from '../api';
import { useDashboard } from '../store';

/**
 * Menu management.
 *
 * Two speeds, because a cafe uses this screen in two very different ways: the
 * sold-out toggle on every row is a one-tap action for the middle of a rush, and
 * the full editor behind it is for the quiet hour when someone actually changes
 * prices.
 *
 * Prices are entered in rupees and converted to paisa here, so nobody has to
 * think in minor units.
 */
export function MenuPage(): React.JSX.Element {
  const client = useQueryClient();
  const businessId = useDashboard((state) => state.businessId);

  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);

  const menu = useQuery({
    queryKey: ['menu', businessId],
    queryFn: () => merchantApi.menu(businessId as string),
    enabled: Boolean(businessId),
  });

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['menu', businessId] });
  };

  const availability = useMutation({
    mutationFn: (input: { itemId: string; isSoldOut?: boolean; isAvailable?: boolean }) =>
      merchantApi.setAvailability(businessId as string, input.itemId, {
        ...(input.isSoldOut !== undefined ? { isSoldOut: input.isSoldOut } : {}),
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
      }),
    onSuccess: () => {
      invalidate();
      setToast('Menu updated');
    },
    onError: () => setToast('Could not update that item'),
  });

  return (
    <>
      <PageHeader
        title="Menu"
        description="What customers can order, and what is available right now."
        actions={
          <>
            <Button variant="secondary" onClick={() => setAddingCategory(true)}>
              Add category
            </Button>
          </>
        }
      />

      <QueryState
        isLoading={menu.isLoading}
        isError={menu.isError}
        isEmpty={(menu.data?.categories.length ?? 0) === 0}
        emptyTitle="No menu yet"
        emptyBody="Add a category, then add the items customers can order."
        onRetry={() => void menu.refetch()}
      >
        <div className="gg-stack" style={{ gap: 'var(--space-xl)' }}>
          {menu.data?.categories.map((category) => (
            <section key={category.id} className="gg-stack">
              <div className="gg-spread">
                <div className="gg-row">
                  <h2>{category.name}</h2>
                  {!category.isActive ? <Badge tone="neutral">Hidden</Badge> : null}
                  <span className="gg-muted gg-small">
                    {category.items.length} {category.items.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                <Button size="sm" variant="secondary" onClick={() => setCreatingIn(category.id)}>
                  Add item
                </Button>
              </div>

              <Card flush>
                <div className="gg-table-wrap">
                  <table className="gg-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price</th>
                        <th>Options</th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>

                    <tbody>
                      {category.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{item.name}</div>
                            {item.description ? (
                              <div className="gg-muted gg-small">{item.description}</div>
                            ) : null}
                          </td>

                          <td>{formatPKR(item.basePrice)}</td>

                          <td className="gg-muted gg-small">
                            {[
                              item.variants.length > 0 ? `${item.variants.length} sizes` : null,
                              item.modifiers.length > 0
                                ? `${item.modifiers.length} option groups`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </td>

                          <td>
                            {item.isSoldOut ? (
                              <Badge tone="danger">Sold out</Badge>
                            ) : !item.isAvailable ? (
                              <Badge tone="neutral">Hidden</Badge>
                            ) : (
                              <Badge tone="success" dot>
                                Available
                              </Badge>
                            )}
                          </td>

                          <td>
                            <div className="gg-row" style={{ justifyContent: 'flex-end' }}>
                              <Button
                                size="sm"
                                variant={item.isSoldOut ? 'secondary' : 'ghost'}
                                onClick={() =>
                                  availability.mutate({
                                    itemId: item.id,
                                    isSoldOut: !item.isSoldOut,
                                  })
                                }
                              >
                                {item.isSoldOut ? 'Back in stock' : 'Mark sold out'}
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                                Edit
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}

                      {category.items.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="gg-muted gg-small">
                            Nothing in this category yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          ))}
        </div>
      </QueryState>

      <ItemDialog
        item={editing}
        categoryId={creatingIn}
        open={editing !== null || creatingIn !== null}
        onClose={() => {
          setEditing(null);
          setCreatingIn(null);
        }}
        onSaved={(message) => {
          setEditing(null);
          setCreatingIn(null);
          setToast(message);
          invalidate();
        }}
      />

      <CategoryDialog
        open={addingCategory}
        onClose={() => setAddingCategory(false)}
        onSaved={() => {
          setAddingCategory(false);
          setToast('Category added');
          invalidate();
        }}
      />

      <Toast message={toast} />
    </>
  );
}

/* ---------------------------------------------------------------- dialogs */

function ItemDialog({
  item,
  categoryId,
  open,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categoryId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rupees, setRupees] = useState(0);
  const [prepMinutes, setPrepMinutes] = useState(0);
  const [isPopular, setIsPopular] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Fill the form once per opened item rather than on every render.
  const key = item?.id ?? categoryId ?? '';
  if (open && loadedFor !== key) {
    setName(item?.name ?? '');
    setDescription(item?.description ?? '');
    setRupees(item ? item.basePrice / 100 : 0);
    setPrepMinutes(item?.prepTimeMinutes ?? 0);
    setIsPopular(item?.isPopular ?? false);
    setIsAvailable(item?.isAvailable ?? true);
    setError(null);
    setLoadedFor(key);
  }

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        // Rupees in, paisa stored: money never touches a float on the wire.
        basePrice: Math.round(rupees * 100),
        prepTimeMinutes: prepMinutes > 0 ? prepMinutes : null,
        isPopular,
        isAvailable,
      };

      if (item) {
        return merchantApi.updateItem(businessId as string, item.id, body);
      }

      return merchantApi.createItem(businessId as string, {
        ...body,
        categoryId,
        isSoldOut: false,
        tags: [],
        variants: [],
        modifiers: [],
      });
    },
    onSuccess: () => {
      setLoadedFor(null);
      onSaved(item ? 'Item updated' : 'Item added');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save that item'),
  });

  return (
    <Dialog
      open={open}
      title={item ? `Edit ${item.name}` : 'New item'}
      onClose={() => {
        setLoadedFor(null);
        onClose();
      }}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setLoadedFor(null);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={name.trim().length < 1 || rupees <= 0}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Iced Latte" autoFocus />

      <TextAreaField
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder="Double shot over ice, milk of your choice."
      />

      <NumberField
        label="Price"
        value={rupees}
        onChange={setRupees}
        min={0}
        step={10}
        suffix="Rs."
        hint="Customers see this as the starting price, before size and extras."
      />

      <NumberField
        label="Preparation time"
        value={prepMinutes}
        onChange={setPrepMinutes}
        min={0}
        max={120}
        suffix="minutes"
        hint="Leave at 0 to use the cafe default."
      />

      <Toggle
        label="Show as popular"
        checked={isPopular}
        onChange={setIsPopular}
        hint="Highlighted on your cafe page and in search."
      />

      <Toggle
        label="Visible on the menu"
        checked={isAvailable}
        onChange={setIsAvailable}
        hint="Turn off to hide without deleting."
      />

      {error ? <div className="gg-error">{error}</div> : null}

      {item && (item.variants.length > 0 || item.modifiers.length > 0) ? (
        <div className="gg-hint">
          This item has {item.variants.length} sizes and {item.modifiers.length} option groups.
          Editing those is coming to the dashboard; they are seeded and served correctly today.
        </div>
      ) : null}
    </Dialog>
  );
}

function CategoryDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const businessId = useDashboard((state) => state.businessId);
  const [name, setName] = useState('');
  const [visible, setVisible] = useState<'true' | 'false'>('true');

  const save = useMutation({
    mutationFn: () =>
      merchantApi.createCategory(businessId as string, {
        name: name.trim(),
        isActive: visible === 'true',
      }),
    onSuccess: () => {
      setName('');
      onSaved();
    },
  });

  return (
    <Dialog
      open={open}
      title="New category"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={name.trim().length < 1}
            onClick={() => save.mutate()}
          >
            Add category
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Coffee" autoFocus />
      <SelectField
        label="Visibility"
        value={visible}
        onChange={setVisible}
        options={[
          { value: 'true', label: 'Visible to customers' },
          { value: 'false', label: 'Hidden for now' },
        ]}
      />
    </Dialog>
  );
}
