import { useEffect, useMemo, useState } from 'react';
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
  TextField,
  Toast,
  formatNumber,
  formatPKR,
} from '@grabgo/ui';
import { merchantApi, type CafeReward } from '../api';
import { useDashboard } from '../store';

/**
 * The cafe's own loyalty rewards.
 *
 * Customers earn points per cafe and spend them only where they earned them, so
 * each cafe decides what its points buy. Rewards are never deleted — a reward
 * someone has already redeemed must stay resolvable — so "Retire" switches one
 * off and "Enable" brings it back.
 */

type RewardType = CafeReward['type'];

const TYPE_OPTIONS: Array<{ value: RewardType; label: string }> = [
  { value: 'FIXED_DISCOUNT', label: 'Fixed amount off' },
  { value: 'PERCENTAGE_DISCOUNT', label: 'Percentage off' },
  { value: 'FREE_ITEM', label: 'Free item' },
];

export function RewardsPage(): React.JSX.Element {
  const client = useQueryClient();
  const business = useDashboard((state) => state.currentBusiness());
  const isManager = useDashboard((state) => state.isManager());
  const [editing, setEditing] = useState<CafeReward | 'new' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const businessId = business?.id ?? '';
  const rewards = useQuery({
    queryKey: ['merchant-rewards', businessId],
    queryFn: () => merchantApi.rewards(businessId),
    enabled: Boolean(businessId),
  });
  const menu = useQuery({
    queryKey: ['merchant-menu', businessId],
    queryFn: () => merchantApi.menu(businessId),
    enabled: Boolean(businessId),
  });

  const itemNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const category of menu.data?.categories ?? []) {
      for (const item of category.items) names.set(item.id, item.name);
    }
    return names;
  }, [menu.data]);

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      merchantApi.updateReward(businessId, input.id, { isActive: input.isActive }),
    onSuccess: (_, input) => {
      setToast(input.isActive ? 'Reward enabled' : 'Reward retired');
      void client.invalidateQueries({ queryKey: ['merchant-rewards', businessId] });
    },
    onError: (error) =>
      setToast(error instanceof ApiError ? error.displayMessage : 'Could not update the reward'),
  });

  if (!business) {
    return <PageHeader title="Rewards" description="Choose a cafe first." />;
  }

  const describeValue = (reward: CafeReward): string =>
    reward.type === 'FIXED_DISCOUNT'
      ? `${formatPKR(reward.discountAmount ?? 0)} off`
      : reward.type === 'PERCENTAGE_DISCOUNT'
        ? `${reward.discountPercentage ?? 0}% off${reward.maxDiscountAmount ? ` (up to ${formatPKR(reward.maxDiscountAmount)})` : ''}`
        : `Free ${reward.freeItemMenuItemIds.map((id) => itemNames.get(id) ?? 'item').join(' or ')}`;

  return (
    <>
      <PageHeader
        title="Rewards"
        description={`What points earned at ${business.name} can be spent on. Customers can only spend them here.`}
        actions={
          isManager ? <Button onClick={() => setEditing('new')}>New reward</Button> : undefined
        }
      />

      {!business.loyaltyEnabled ? (
        <Card>
          <span className="gg-small">
            Loyalty is switched off for this cafe, so customers are not earning points right now.
            Turn it on in Settings.
          </span>
        </Card>
      ) : null}

      <Card flush>
        <QueryState
          isLoading={rewards.isLoading}
          isError={rewards.isError}
          isEmpty={(rewards.data?.length ?? 0) === 0}
          emptyTitle="No rewards yet"
          emptyBody="Add one so the points your customers earn here have something to buy."
          onRetry={() => void rewards.refetch()}
          loadingRows={3}
        >
          <div className="gg-table-wrap">
            <table className="gg-table">
              <thead>
                <tr>
                  <th>Reward</th>
                  <th>Points</th>
                  <th>Value</th>
                  <th>Redeemed</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rewards.data?.map((reward) => (
                  <tr key={reward.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{reward.name}</div>
                      {reward.description ? (
                        <div className="gg-muted gg-small">{reward.description}</div>
                      ) : null}
                    </td>
                    <td>{formatNumber(reward.pointsRequired)}</td>
                    <td className="gg-muted gg-small">{describeValue(reward)}</td>
                    <td>
                      {formatNumber(reward.usageCount)}
                      {reward.usageLimit ? ` / ${formatNumber(reward.usageLimit)}` : ''}
                    </td>
                    <td>
                      <Badge tone={reward.isActive ? 'success' : 'neutral'} dot>
                        {reward.isActive ? 'Active' : 'Retired'}
                      </Badge>
                    </td>
                    <td>
                      {isManager ? (
                        <div className="gg-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(reward)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              toggle.mutate({ id: reward.id, isActive: !reward.isActive })
                            }
                          >
                            {reward.isActive ? 'Retire' : 'Enable'}
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>

      {editing ? (
        <RewardDialog
          key={editing === 'new' ? 'new' : editing.id}
          businessId={businessId}
          reward={editing === 'new' ? null : editing}
          menuItems={[...itemNames.entries()].map(([id, name]) => ({ id, name }))}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            setToast(created ? 'Reward created' : 'Reward saved');
            void client.invalidateQueries({ queryKey: ['merchant-rewards', businessId] });
          }}
        />
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function RewardDialog({
  businessId,
  reward,
  menuItems,
  onClose,
  onSaved,
}: {
  businessId: string;
  reward: CafeReward | null;
  menuItems: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState(reward?.name ?? '');
  const [description, setDescription] = useState(reward?.description ?? '');
  const [points, setPoints] = useState(reward?.pointsRequired ?? 100);
  const [type, setType] = useState<RewardType>(reward?.type ?? 'FIXED_DISCOUNT');
  // Amounts are edited in rupees and stored in paisa.
  const [amount, setAmount] = useState(
    reward?.discountAmount ? reward.discountAmount / 100 : 150,
  );
  const [percentage, setPercentage] = useState(reward?.discountPercentage ?? 10);
  const [cap, setCap] = useState(reward?.maxDiscountAmount ? reward.maxDiscountAmount / 100 : 0);
  const [items, setItems] = useState<string[]>(reward?.freeItemMenuItemIds ?? []);
  const [usageLimit, setUsageLimit] = useState(reward?.usageLimit ?? 0);
  const [error, setError] = useState<string | null>(null);

  const body = (): Record<string, unknown> => ({
    name: name.trim(),
    description: description.trim() || null,
    pointsRequired: points,
    type,
    discountAmount: type === 'FIXED_DISCOUNT' ? Math.round(amount * 100) : null,
    discountPercentage: type === 'PERCENTAGE_DISCOUNT' ? percentage : null,
    // A free item is capped at the item's price by the pricing engine; a cap
    // here only matters for percentage rewards.
    maxDiscountAmount: type === 'PERCENTAGE_DISCOUNT' && cap > 0 ? Math.round(cap * 100) : null,
    freeItemMenuItemIds: type === 'FREE_ITEM' ? items : [],
    usageLimit: usageLimit > 0 ? usageLimit : null,
  });

  const save = useMutation({
    mutationFn: () =>
      reward
        ? merchantApi.updateReward(businessId, reward.id, body())
        : merchantApi.createReward(businessId, { ...body(), isActive: true }),
    onSuccess: () => onSaved(reward === null),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save the reward'),
  });

  const invalid =
    name.trim().length < 2 ||
    points < 1 ||
    (type === 'FIXED_DISCOUNT' && amount <= 0) ||
    (type === 'PERCENTAGE_DISCOUNT' && (percentage < 1 || percentage > 100)) ||
    (type === 'FREE_ITEM' && items.length === 0);

  return (
    <Dialog
      open
      title={reward ? `Edit ${reward.name}` : 'New reward'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            {reward ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Free flat white" autoFocus />
      <TextField
        label="Description (optional)"
        value={description}
        onChange={setDescription}
        placeholder="Any size, any milk"
      />

      <NumberField
        label="Points required"
        value={points}
        onChange={setPoints}
        min={1}
        hint="Customers earn points on every order collected here."
      />

      <SelectField label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />

      {type === 'FIXED_DISCOUNT' ? (
        <NumberField label="Discount" value={amount} onChange={setAmount} min={1} suffix="Rs." />
      ) : null}

      {type === 'PERCENTAGE_DISCOUNT' ? (
        <div className="gg-grid">
          <NumberField
            label="Percentage"
            value={percentage}
            onChange={setPercentage}
            min={1}
            max={100}
            suffix="%"
          />
          <NumberField
            label="Cap (0 for none)"
            value={cap}
            onChange={setCap}
            min={0}
            suffix="Rs."
          />
        </div>
      ) : null}

      {type === 'FREE_ITEM' ? (
        <fieldset className="gg-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="gg-label">Which items it covers</legend>
          {menuItems.length === 0 ? (
            <span className="gg-muted gg-small">Add items to your menu first.</span>
          ) : (
            <div style={{ maxHeight: 220, overflowY: 'auto' }} className="gg-stack">
              {menuItems.map((item) => (
                <label key={item.id} className="gg-row gg-small" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={items.includes(item.id)}
                    onChange={(event) =>
                      setItems((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ) : null}

      <NumberField
        label="Total redemptions allowed (0 for unlimited)"
        value={usageLimit}
        onChange={setUsageLimit}
        min={0}
      />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}
