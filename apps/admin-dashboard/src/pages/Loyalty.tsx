import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoyaltyConfig, PlatformConfig, ReferralConfig } from '@grabgo/types';
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
  Toggle,
  formatNumber,
  formatPKR,
} from '@grabgo/ui';
import { adminApi } from '../api';

/**
 * Loyalty, referral and platform configuration.
 *
 * These are the values the whole product runs on — "Rs. 100 = 1 point",
 * "3 friends earn a free coffee", "orders expire after 10 unaccepted minutes".
 * None of them is hardcoded anywhere; this screen is where they live, and the
 * API reads them on every order.
 */
export function LoyaltyPage(): React.JSX.Element {
  const client = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const config = useQuery({ queryKey: ['admin-config'], queryFn: adminApi.config });

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['admin-config'] });
  };

  return (
    <>
      <PageHeader
        title="Loyalty and rules"
        description="Points, referrals and the platform-wide order rules."
      />

      <QueryState
        isLoading={config.isLoading}
        isError={config.isError}
        onRetry={() => void config.refetch()}
      >
        {config.data ? (
          <>
            <LoyaltyForm
              value={config.data.loyalty}
              onSaved={() => {
                setToast('Loyalty rules saved. New orders use them immediately.');
                invalidate();
              }}
            />

            <ReferralForm
              value={config.data.referral}
              onSaved={() => {
                setToast('Referral rules saved.');
                invalidate();
              }}
            />

            <PlatformForm
              value={config.data.platform}
              onSaved={() => {
                setToast('Platform rules saved.');
                invalidate();
              }}
            />
          </>
        ) : null}
      </QueryState>

      <RewardsCard onToast={setToast} />
      <PromotionsCard onToast={setToast} />

      <Toast message={toast} />
    </>
  );
}

/* --------------------------------------------------------------- loyalty */

function LoyaltyForm({
  value,
  onSaved,
}: {
  value: LoyaltyConfig;
  onSaved: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const save = useMutation({
    mutationFn: () => adminApi.saveLoyalty(draft),
    onSuccess: onSaved,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save'),
  });

  const set = <K extends keyof LoyaltyConfig>(key: K, next: LoyaltyConfig[K]): void =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <Card>
      <div className="gg-stack">
        <div className="gg-spread">
          <h3>Grab Points</h3>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>

        <p className="gg-muted gg-small">
          Currently: {formatPKR(draft.earnRateAmount)} spent earns {draft.earnRatePoints}{' '}
          {draft.earnRatePoints === 1 ? 'point' : 'points'}
          {draft.pointsMultiplier !== 1 ? `, multiplied by ${draft.pointsMultiplier}` : ''}.
        </p>

        <Toggle
          label="Loyalty programme enabled"
          checked={draft.isEnabled}
          onChange={(next) => set('isEnabled', next)}
          hint="Turning this off stops points accruing platform-wide."
        />

        <div className="gg-grid">
          <NumberField
            label="Spend per point block"
            value={draft.earnRateAmount / 100}
            onChange={(next) => set('earnRateAmount', Math.round(next * 100))}
            min={1}
            suffix="Rs."
          />

          <NumberField
            label="Points awarded per block"
            value={draft.earnRatePoints}
            onChange={(next) => set('earnRatePoints', next)}
            min={1}
          />

          <NumberField
            label="Promotional multiplier"
            value={draft.pointsMultiplier}
            onChange={(next) => set('pointsMultiplier', next)}
            min={0.1}
            step={0.5}
            hint="2 means double points."
          />

          <NumberField
            label="Points expire after"
            value={draft.expiryDays}
            onChange={(next) => set('expiryDays', next)}
            min={0}
            suffix="days"
            hint="0 means points never expire."
          />

          <SelectField
            label="Earn on"
            value={draft.earnBasis}
            onChange={(next) => set('earnBasis', next)}
            options={[
              { value: 'NET', label: 'Amount paid, after discounts' },
              { value: 'SUBTOTAL', label: 'Basket total, before discounts' },
            ]}
          />

          <SelectField
            label="Award points when"
            value={draft.awardOnStatus}
            onChange={(next) => set('awardOnStatus', next)}
            options={[
              { value: 'PICKED_UP', label: 'The customer collects the order' },
              { value: 'COMPLETED', label: 'The cafe closes the order' },
            ]}
          />
        </div>

        {error ? <div className="gg-error">{error}</div> : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- referral */

function ReferralForm({
  value,
  onSaved,
}: {
  value: ReferralConfig;
  onSaved: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const save = useMutation({
    mutationFn: () => adminApi.saveReferral(draft),
    onSuccess: onSaved,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save'),
  });

  const set = <K extends keyof ReferralConfig>(key: K, next: ReferralConfig[K]): void =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <Card>
      <div className="gg-stack">
        <div className="gg-spread">
          <h3>Referrals</h3>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>

        <p className="gg-muted gg-small">
          A referral qualifies only when the invited person collects an order worth at least{' '}
          {formatPKR(draft.minimumQualifyingOrderTotal)} — signing up alone never pays out.
        </p>

        <Toggle
          label="Referral programme enabled"
          checked={draft.isEnabled}
          onChange={(next) => set('isEnabled', next)}
        />

        <div className="gg-grid">
          <NumberField
            label="Qualified referrals per reward"
            value={draft.referralsRequiredForReward}
            onChange={(next) => set('referralsRequiredForReward', next)}
            min={1}
            max={50}
          />

          <NumberField
            label="Points to the referrer"
            value={draft.referrerPointsPerQualified}
            onChange={(next) => set('referrerPointsPerQualified', next)}
            min={0}
            hint="Per qualified referral, on top of the reward."
          />

          <NumberField
            label="Welcome points for the new customer"
            value={draft.refereeSignupPoints}
            onChange={(next) => set('refereeSignupPoints', next)}
            min={0}
          />

          <NumberField
            label="Minimum qualifying order"
            value={draft.minimumQualifyingOrderTotal / 100}
            onChange={(next) => set('minimumQualifyingOrderTotal', Math.round(next * 100))}
            min={0}
            suffix="Rs."
          />

          <NumberField
            label="Monthly cap per referrer"
            value={draft.maxQualifiedPerMonth}
            onChange={(next) => set('maxQualifiedPerMonth', next)}
            min={1}
            hint="Abuse guard. Referrals beyond this do not pay out."
          />

          <SelectField
            label="Qualify when"
            value={draft.qualifyOnStatus}
            onChange={(next) => set('qualifyOnStatus', next)}
            options={[
              { value: 'PICKED_UP', label: 'The order is collected' },
              { value: 'COMPLETED', label: 'The order is closed' },
            ]}
          />
        </div>

        <Toggle
          label="Require a verified phone number"
          checked={draft.requireVerifiedPhone}
          onChange={(next) => set('requireVerifiedPhone', next)}
          hint="The strongest single guard against referral farming."
        />

        {error ? <div className="gg-error">{error}</div> : null}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- platform */

function PlatformForm({
  value,
  onSaved,
}: {
  value: PlatformConfig;
  onSaved: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const save = useMutation({
    mutationFn: () => adminApi.savePlatform(draft),
    onSuccess: onSaved,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save'),
  });

  const set = <K extends keyof PlatformConfig>(key: K, next: PlatformConfig[K]): void =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <Card>
      <div className="gg-stack">
        <div className="gg-spread">
          <h3>Order rules</h3>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>

        <div className="gg-grid">
          <NumberField
            label="Default commission"
            value={draft.defaultCommissionBasisPoints / 100}
            onChange={(next) => set('defaultCommissionBasisPoints', Math.round(next * 100))}
            min={0}
            max={50}
            step={0.5}
            suffix="%"
            hint="Applied to new cafes. Existing orders keep the rate they were placed at."
          />

          <NumberField
            label="Pickup slot interval"
            value={draft.pickupSlotIntervalMinutes}
            onChange={(next) => set('pickupSlotIntervalMinutes', next)}
            min={5}
            max={60}
            suffix="minutes"
          />

          <NumberField
            label="Cafe accept window"
            value={draft.merchantAcceptWindowMinutes}
            onChange={(next) => set('merchantAcceptWindowMinutes', next)}
            min={1}
            max={60}
            suffix="minutes"
            hint="Unaccepted orders expire after this and the customer is refunded."
          />

          <NumberField
            label="Customer cancel window"
            value={draft.customerCancelWindowMinutes}
            onChange={(next) => set('customerCancelWindowMinutes', next)}
            min={0}
            max={60}
            suffix="minutes"
            hint="How long after acceptance a customer can still cancel themselves."
          />

          <NumberField
            label="Pickup code attempts"
            value={draft.maxPickupCodeAttempts}
            onChange={(next) => set('maxPickupCodeAttempts', next)}
            min={3}
            max={20}
            hint="Wrong codes allowed before an order locks and needs a manager."
          />

          <NumberField
            label="Maximum scheduling ahead"
            value={Math.round(draft.maxScheduleAheadMinutes / 60)}
            onChange={(next) => set('maxScheduleAheadMinutes', next * 60)}
            min={1}
            max={168}
            suffix="hours"
          />
        </div>

        {error ? <div className="gg-error">{error}</div> : null}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- rewards */

function RewardsCard({ onToast }: { onToast: (message: string) => void }): React.JSX.Element {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);

  const rewards = useQuery({ queryKey: ['admin-rewards'], queryFn: adminApi.rewards });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      adminApi.updateReward(input.id, { isActive: input.isActive }),
    onSuccess: () => {
      onToast('Reward updated');
      void client.invalidateQueries({ queryKey: ['admin-rewards'] });
    },
  });

  return (
    <Card flush>
      <div className="gg-spread" style={{ padding: 'var(--space-base)' }}>
        <div>
          <h3>Rewards</h3>
          <p className="gg-muted gg-small">What customers can spend Grab Points on.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          New reward
        </Button>
      </div>

      <QueryState
        isLoading={rewards.isLoading}
        isError={rewards.isError}
        isEmpty={(rewards.data?.length ?? 0) === 0}
        emptyTitle="No rewards configured"
        emptyBody="Add one so points have somewhere to go."
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
                  <td className="gg-muted gg-small">
                    {reward.type === 'FIXED_DISCOUNT'
                      ? formatPKR(reward.discountAmount ?? 0)
                      : reward.type === 'PERCENTAGE_DISCOUNT'
                        ? `${reward.discountPercentage ?? 0}% off`
                        : 'Free item'}
                  </td>
                  <td>{formatNumber(reward.usageCount)}</td>
                  <td>
                    <Badge tone={reward.isActive ? 'success' : 'neutral'} dot>
                      {reward.isActive ? 'Active' : 'Off'}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggle.mutate({ id: reward.id, isActive: !reward.isActive })}
                    >
                      {reward.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <RewardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          onToast('Reward created');
          void client.invalidateQueries({ queryKey: ['admin-rewards'] });
        }}
      />
    </Card>
  );
}

function RewardDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [points, setPoints] = useState(100);
  const [type, setType] = useState<'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT'>('FIXED_DISCOUNT');
  const [amount, setAmount] = useState(150);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      adminApi.createReward({
        name: name.trim(),
        pointsRequired: points,
        type,
        ...(type === 'FIXED_DISCOUNT'
          ? { discountAmount: Math.round(amount * 100) }
          : { discountPercentage: amount, maxDiscountAmount: 100000 }),
        freeItemMenuItemIds: [],
        isActive: true,
      }),
    onSuccess: () => {
      setName('');
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not create'),
  });

  return (
    <Dialog
      open={open}
      title="New reward"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Free coffee" autoFocus />

      <NumberField label="Points required" value={points} onChange={setPoints} min={1} />

      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: 'FIXED_DISCOUNT', label: 'Fixed amount off' },
          { value: 'PERCENTAGE_DISCOUNT', label: 'Percentage off' },
        ]}
      />

      <NumberField
        label={type === 'FIXED_DISCOUNT' ? 'Discount' : 'Percentage'}
        value={amount}
        onChange={setAmount}
        min={1}
        suffix={type === 'FIXED_DISCOUNT' ? 'Rs.' : '%'}
      />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}

/* ------------------------------------------------------------ promotions */

function PromotionsCard({ onToast }: { onToast: (message: string) => void }): React.JSX.Element {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);

  const promotions = useQuery({ queryKey: ['admin-promotions'], queryFn: adminApi.promotions });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      adminApi.updatePromotion(input.id, { isActive: input.isActive }),
    onSuccess: () => {
      onToast('Promotion updated');
      void client.invalidateQueries({ queryKey: ['admin-promotions'] });
    },
  });

  return (
    <Card flush>
      <div className="gg-spread" style={{ padding: 'var(--space-base)' }}>
        <div>
          <h3>Promo codes</h3>
          <p className="gg-muted gg-small">
            Validated server-side on every order, including the usage limits.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          New promo code
        </Button>
      </div>

      <QueryState
        isLoading={promotions.isLoading}
        isError={promotions.isError}
        isEmpty={(promotions.data?.length ?? 0) === 0}
        emptyTitle="No promo codes"
        onRetry={() => void promotions.refetch()}
        loadingRows={3}
      >
        <div className="gg-table-wrap">
          <table className="gg-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Minimum</th>
                <th>Used</th>
                <th>Funded by</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>

            <tbody>
              {promotions.data?.map((promotion) => (
                <tr key={promotion.id}>
                  <td>
                    <div className="gg-mono" style={{ fontWeight: 600 }}>
                      {promotion.code}
                    </div>
                    {promotion.firstOrderOnly ? <Badge tone="info">First order only</Badge> : null}
                  </td>
                  <td>
                    {promotion.type === 'FIXED_DISCOUNT'
                      ? formatPKR(promotion.value)
                      : `${promotion.value}%`}
                  </td>
                  <td className="gg-muted gg-small">{formatPKR(promotion.minimumOrderTotal)}</td>
                  <td>
                    {formatNumber(promotion.usageCount)}
                    {promotion.usageLimit ? ` / ${formatNumber(promotion.usageLimit)}` : ''}
                  </td>
                  <td>
                    <Badge tone={promotion.fundedBy === 'PLATFORM' ? 'primary' : 'neutral'}>
                      {promotion.fundedBy.toLowerCase()}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={promotion.isActive ? 'success' : 'neutral'} dot>
                      {promotion.isActive ? 'Active' : 'Off'}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        toggle.mutate({ id: promotion.id, isActive: !promotion.isActive })
                      }
                    >
                      {promotion.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <PromotionDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          onToast('Promo code created');
          void client.invalidateQueries({ queryKey: ['admin-promotions'] });
        }}
      />
    </Card>
  );
}

function PromotionDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState('');
  const [type, setType] = useState<'FIXED_DISCOUNT' | 'PERCENTAGE_DISCOUNT'>('FIXED_DISCOUNT');
  const [value, setValue] = useState(50);
  const [minimum, setMinimum] = useState(300);
  const [firstOrderOnly, setFirstOrderOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      adminApi.createPromotion({
        code: code.trim().toUpperCase(),
        type,
        scope: 'PLATFORM',
        // Fixed discounts are paisa; percentages are a plain number.
        value: type === 'FIXED_DISCOUNT' ? Math.round(value * 100) : value,
        minimumOrderTotal: Math.round(minimum * 100),
        firstOrderOnly,
        fundedBy: 'PLATFORM',
        isActive: true,
      }),
    onSuccess: () => {
      setCode('');
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not create'),
  });

  return (
    <Dialog
      open={open}
      title="New promo code"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={code.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Create
          </Button>
        </>
      }
    >
      <TextField
        label="Code"
        value={code}
        onChange={(next) => setCode(next.toUpperCase())}
        placeholder="WELCOME50"
        autoFocus
      />

      <SelectField
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: 'FIXED_DISCOUNT', label: 'Fixed amount off' },
          { value: 'PERCENTAGE_DISCOUNT', label: 'Percentage off' },
        ]}
      />

      <NumberField
        label={type === 'FIXED_DISCOUNT' ? 'Discount' : 'Percentage'}
        value={value}
        onChange={setValue}
        min={1}
        suffix={type === 'FIXED_DISCOUNT' ? 'Rs.' : '%'}
      />

      <NumberField
        label="Minimum order"
        value={minimum}
        onChange={setMinimum}
        min={0}
        suffix="Rs."
      />

      <Toggle
        label="First order only"
        checked={firstOrderOnly}
        onChange={setFirstOrderOnly}
        hint="Restricts the code to customers who have never completed an order."
      />

      {error ? <div className="gg-error">{error}</div> : null}
    </Dialog>
  );
}
