import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CafeStaffMember, StaffRole } from '@grabgo/types';
import {
  ApiError,
  Badge,
  Button,
  Card,
  DAY_NAMES,
  Dialog,
  NumberField,
  PageHeader,
  QueryState,
  SelectField,
  TextAreaField,
  TextField,
  Toast,
  Toggle,
  formatDate,
  minutesToTimeInput,
  timeInputToMinutes,
} from '@grabgo/ui';
import { merchantApi, type MerchantBusiness } from '../api';
import { useDashboard } from '../store';

/**
 * Cafe settings: trading controls, opening hours and staff.
 *
 * The controls at the top are the ones used daily — pause orders, change the
 * prep estimate, cap how many orders can be in flight at once. Everything below
 * is configured occasionally.
 */
export function SettingsPage(): React.JSX.Element {
  const client = useQueryClient();
  const business = useDashboard((state) => state.currentBusiness());
  const isManager = useDashboard((state) => state.isManager());
  const [toast, setToast] = useState<string | null>(null);

  const refreshBusinesses = async (): Promise<void> => {
    await useDashboard.getState().bootstrap();
    void client.invalidateQueries();
  };

  const settings = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      merchantApi.updateSettings(business?.id ?? '', body),
    onSuccess: async () => {
      setToast('Settings saved');
      await refreshBusinesses();
    },
    onError: (error) =>
      setToast(error instanceof ApiError ? error.displayMessage : 'Could not save settings'),
  });

  if (!business) {
    return <PageHeader title="Settings" description="Choose a cafe first." />;
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${business.name} · ${business.areaName ?? ''}`}
      />

      {/* ------------------------------------------------------- profile */}
      {isManager ? (
        <ProfileCard
          key={business.id}
          business={business}
          onSaved={() => {
            setToast('Cafe profile saved');
            void refreshBusinesses();
          }}
        />
      ) : null}

      {/* ------------------------------------------------------- trading */}
      <Card>
        <div className="gg-stack">
          <h3>Trading</h3>

          <Toggle
            label="Accepting Grab & Go orders"
            checked={business.acceptingOrders}
            onChange={(next) => settings.mutate({ acceptingOrders: next })}
            hint="Turn off to pause new orders without closing the cafe. Existing orders are unaffected."
          />

          <div className="gg-grid">
            <NumberField
              label="Preparation time"
              value={business.prepTimeMinutes}
              onChange={(next) => settings.mutate({ prepTimeMinutes: next })}
              min={1}
              max={120}
              suffix="minutes"
              hint="Shown to customers as “ready in ~N min”."
            />

            <NumberField
              label="Minimum lead time"
              value={business.minLeadTimeMinutes}
              onChange={(next) => settings.mutate({ minLeadTimeMinutes: next })}
              min={0}
              max={120}
              suffix="minutes"
              hint="The earliest a customer can ask to collect."
            />
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------ capacity */}
      <Card>
        <div className="gg-stack">
          <h3>Order capacity</h3>
          <p className="gg-muted gg-small">
            When you hit the ceiling, customers keep ordering but are quoted a longer pickup
            time instead of being turned away. This is what stops a rush overwhelming the bar.
          </p>

          <CapacityEditor
            businessId={business.id}
            onSaved={() => {
              setToast('Capacity updated');
              void refreshBusinesses();
            }}
          />
        </div>
      </Card>

      {/* --------------------------------------------------------- hours */}
      <HoursCard
        businessId={business.id}
        hours={business.openingHours}
        onSaved={() => {
          setToast('Opening hours saved');
          void refreshBusinesses();
        }}
      />

      {/* ------------------------------------------------------ holidays */}
      <Card>
        <div className="gg-stack">
          <div className="gg-spread">
            <h3>Holidays and special hours</h3>
            <HolidayButton
              businessId={business.id}
              onSaved={() => {
                setToast('Holiday saved');
                void refreshBusinesses();
              }}
            />
          </div>

          {business.holidays.length === 0 ? (
            <p className="gg-muted gg-small">
              No dates configured. Add one to close for a public holiday or trade shorter hours.
            </p>
          ) : (
            <div className="gg-stack">
              {business.holidays.map((holiday) => (
                <div key={holiday.id} className="gg-spread">
                  <div>
                    <strong>{formatDate(`${holiday.date}T00:00:00.000Z`)}</strong>
                    {holiday.name ? <span className="gg-muted"> · {holiday.name}</span> : null}
                  </div>
                  <div className="gg-row">
                    <Badge tone={holiday.isClosed ? 'danger' : 'warning'}>
                      {holiday.isClosed
                        ? 'Closed'
                        : `${minutesToTimeInput(holiday.opensAt)}–${minutesToTimeInput(holiday.closesAt)}`}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void merchantApi
                          .deleteHoliday(business.id, holiday.id)
                          .then(refreshBusinesses);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* --------------------------------------------------------- staff */}
      <StaffCard businessId={business.id} canManage={isManager} onToast={setToast} />

      <Toast message={toast} />
    </>
  );
}

/* -------------------------------------------------------------- capacity */

function CapacityEditor({
  businessId,
  onSaved,
}: {
  businessId: string;
  onSaved: () => void;
}): React.JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useState(10);

  const save = useMutation({
    mutationFn: (value: number | null) =>
      merchantApi.updateSettings(businessId, { maxConcurrentOrders: value }),
    onSuccess: onSaved,
  });

  return (
    <div className="gg-grid">
      <NumberField
        label="Maximum simultaneous orders"
        value={maxConcurrent}
        onChange={setMaxConcurrent}
        min={1}
        max={200}
        hint="Orders between accepted and ready. Leave high if you never want a cap."
      />

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <Button loading={save.isPending} onClick={() => save.mutate(maxConcurrent)}>
          Save capacity
        </Button>
        <Button variant="secondary" onClick={() => save.mutate(null)}>
          No limit
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- hours */

function HoursCard({
  businessId,
  hours,
  onSaved,
}: {
  businessId: string;
  hours: Array<{ dayOfWeek: number; opensAt: number | null; closesAt: number | null; isClosed: boolean }>;
  onSaved: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(
    () =>
      Array.from({ length: 7 }, (_, dayOfWeek) => {
        const row = hours.find((entry) => entry.dayOfWeek === dayOfWeek);
        return {
          dayOfWeek,
          isClosed: row?.isClosed ?? false,
          opensAt: row?.opensAt ?? 8 * 60,
          closesAt: row?.closesAt ?? 23 * 60,
        };
      }),
  );

  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      merchantApi.updateHours(
        businessId,
        draft.map((row) => ({
          dayOfWeek: row.dayOfWeek,
          isClosed: row.isClosed,
          opensAt: row.isClosed ? null : row.opensAt,
          closesAt: row.isClosed ? null : row.closesAt,
        })),
      ),
    onSuccess: onSaved,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save hours'),
  });

  return (
    <Card>
      <div className="gg-stack">
        <div className="gg-spread">
          <h3>Opening hours</h3>
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save hours
          </Button>
        </div>

        <p className="gg-muted gg-small">
          A closing time earlier than the opening time means you trade past midnight — 08:00 to
          01:00 is a valid day.
        </p>

        {draft.map((row) => (
          <div key={row.dayOfWeek} className="gg-row" style={{ flexWrap: 'wrap' }}>
            <span style={{ minWidth: 96, fontWeight: 500 }}>{DAY_NAMES[row.dayOfWeek]}</span>

            <input
              type="checkbox"
              checked={!row.isClosed}
              aria-label={`${DAY_NAMES[row.dayOfWeek]} open`}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((entry) =>
                    entry.dayOfWeek === row.dayOfWeek
                      ? { ...entry, isClosed: !event.target.checked }
                      : entry,
                  ),
                )
              }
              style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }}
            />

            {row.isClosed ? (
              <span className="gg-muted gg-small">Closed</span>
            ) : (
              <>
                <input
                  className="gg-input"
                  type="time"
                  style={{ width: 130 }}
                  aria-label={`${DAY_NAMES[row.dayOfWeek]} opens at`}
                  value={minutesToTimeInput(row.opensAt)}
                  onChange={(event) => {
                    const minutes = timeInputToMinutes(event.target.value);
                    if (minutes === null) return;
                    setDraft((current) =>
                      current.map((entry) =>
                        entry.dayOfWeek === row.dayOfWeek ? { ...entry, opensAt: minutes } : entry,
                      ),
                    );
                  }}
                />
                <span className="gg-muted">to</span>
                <input
                  className="gg-input"
                  type="time"
                  style={{ width: 130 }}
                  aria-label={`${DAY_NAMES[row.dayOfWeek]} closes at`}
                  value={minutesToTimeInput(row.closesAt)}
                  onChange={(event) => {
                    const minutes = timeInputToMinutes(event.target.value);
                    if (minutes === null) return;
                    setDraft((current) =>
                      current.map((entry) =>
                        entry.dayOfWeek === row.dayOfWeek ? { ...entry, closesAt: minutes } : entry,
                      ),
                    );
                  }}
                />
              </>
            )}
          </div>
        ))}

        {error ? <div className="gg-error">{error}</div> : null}
      </div>
    </Card>
  );
}

function HolidayButton({
  businessId,
  onSaved,
}: {
  businessId: string;
  onSaved: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: () => merchantApi.addHoliday(businessId, { date, name, isClosed: true }),
    onSuccess: () => {
      setOpen(false);
      setDate('');
      setName('');
      onSaved();
    },
  });

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Add date
      </Button>

      <Dialog
        open={open}
        title="Closed for a day"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!date} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="gg-field">
          <label className="gg-label" htmlFor="holiday-date">
            Date
          </label>
          <input
            id="holiday-date"
            className="gg-input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>

        <TextField label="Reason (optional)" value={name} onChange={setName} placeholder="Eid" />
      </Dialog>
    </>
  );
}

/* ----------------------------------------------------------------- staff */

function StaffCard({
  businessId,
  canManage,
  onToast,
}: {
  businessId: string;
  canManage: boolean;
  onToast: (message: string) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const [inviting, setInviting] = useState(false);

  const staff = useQuery({
    queryKey: ['staff', businessId],
    queryFn: () => merchantApi.staff(businessId),
  });

  const update = useMutation({
    mutationFn: (input: { staffId: string; isActive?: boolean; staffRole?: StaffRole }) =>
      merchantApi.updateStaff(businessId, input.staffId, {
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.staffRole ? { staffRole: input.staffRole } : {}),
      }),
    onSuccess: () => {
      onToast('Staff updated');
      void client.invalidateQueries({ queryKey: ['staff', businessId] });
    },
    onError: (error) =>
      onToast(error instanceof ApiError ? error.displayMessage : 'Could not update staff'),
  });

  return (
    <Card flush>
      <div className="gg-spread" style={{ padding: 'var(--space-base)' }}>
        <h3>Staff</h3>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setInviting(true)}>
            Invite staff
          </Button>
        ) : null}
      </div>

      <QueryState
        isLoading={staff.isLoading}
        isError={staff.isError}
        isEmpty={(staff.data?.length ?? 0) === 0}
        emptyTitle="No staff yet"
        onRetry={() => void staff.refetch()}
        loadingRows={3}
      >
        <div className="gg-table-wrap">
          <table className="gg-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>

            <tbody>
              {staff.data?.map((member: CafeStaffMember) => (
                <tr key={member.id}>
                  <td>{member.fullName || '—'}</td>
                  <td className="gg-muted">{member.email ?? '—'}</td>
                  <td>
                    <Badge tone={member.staffRole === 'OWNER' ? 'primary' : 'neutral'}>
                      {member.staffRole}
                    </Badge>
                  </td>
                  <td>
                    {member.isActive ? (
                      <Badge tone="success" dot>
                        Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Disabled</Badge>
                    )}
                  </td>
                  {canManage ? (
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update.mutate({ staffId: member.id, isActive: !member.isActive })
                        }
                      >
                        {member.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>

      <InviteStaffDialog
        businessId={businessId}
        open={inviting}
        onClose={() => setInviting(false)}
        onSaved={(message) => {
          setInviting(false);
          onToast(message);
          void client.invalidateQueries({ queryKey: ['staff', businessId] });
        }}
      />
    </Card>
  );
}

function InviteStaffDialog({
  businessId,
  open,
  onClose,
  onSaved,
}: {
  businessId: string;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffRole>('STAFF');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      merchantApi.inviteStaff(businessId, { email, fullName, staffRole: role }),
    onSuccess: (result) => {
      if (result.temporaryPassword) {
        // Shown once, here, because the server never stores it in plain text.
        setTemporaryPassword(result.temporaryPassword);
        return;
      }
      onSaved('Staff member added');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not add that person'),
  });

  return (
    <Dialog
      open={open}
      title="Invite staff"
      onClose={() => {
        setTemporaryPassword(null);
        onClose();
      }}
      footer={
        temporaryPassword ? (
          <Button
            onClick={() => {
              setTemporaryPassword(null);
              onSaved('Staff member added');
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
              loading={save.isPending}
              disabled={!email.includes('@') || fullName.trim().length < 2}
              onClick={() => save.mutate()}
            >
              Add
            </Button>
          </>
        )
      }
    >
      {temporaryPassword ? (
        <div className="gg-stack">
          <p>
            {fullName} can now sign in with <strong>{email}</strong>.
          </p>
          <div>
            <div className="gg-overline">Temporary password</div>
            <div className="gg-mono" style={{ fontSize: 20, fontWeight: 700 }}>
              {temporaryPassword}
            </div>
          </div>
          <p className="gg-hint">
            This is shown once. Pass it on securely and ask them to change it after signing in.
          </p>
        </div>
      ) : (
        <>
          <TextField label="Name" value={fullName} onChange={setFullName} autoFocus />
          <TextField label="Email" value={email} onChange={setEmail} type="email" />
          <SelectField
            label="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'STAFF', label: 'Staff — works the live order board' },
              { value: 'MANAGER', label: 'Manager — can also edit menu and staff' },
              { value: 'OWNER', label: 'Owner — full access' },
            ]}
          />
          {error ? <div className="gg-error">{error}</div> : null}
        </>
      )}
    </Dialog>
  );
}

/**
 * What customers see about the cafe: its name, blurb, phone, address and the
 * logo that sits on its map pin. Images are linked by URL; there is no upload
 * service yet, so the field takes a hosted image (the cafe's website, Instagram
 * CDN, etc.) and previews it before saving.
 */
function ProfileCard({
  business,
  onSaved,
}: {
  business: MerchantBusiness;
  onSaved: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description ?? '');
  const [phone, setPhone] = useState(business.phone ?? '');
  const [addressLine, setAddressLine] = useState(business.addressLine);
  const [logoUrl, setLogoUrl] = useState(business.logoUrl ?? '');
  const [coverImageUrl, setCoverImageUrl] = useState(business.coverImageUrl ?? '');
  const [logoBroken, setLogoBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isUrl = (value: string): boolean => value === '' || /^https?:\/\/\S+$/i.test(value.trim());

  const save = useMutation({
    mutationFn: () =>
      merchantApi.updateProfile(business.id, {
        name: name.trim(),
        description: description.trim() || null,
        phone: phone.trim() || null,
        addressLine: addressLine.trim(),
        logoUrl: logoUrl.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
      }),
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.displayMessage : 'Could not save the profile'),
  });

  const invalid =
    name.trim().length < 2 || addressLine.trim().length < 4 || !isUrl(logoUrl) || !isUrl(coverImageUrl);

  return (
    <Card>
      <div className="gg-stack">
        <h3>Cafe profile</h3>
        <p className="gg-muted gg-small">
          Shown on your cafe page. Your logo also appears on your pin on the customer map.
        </p>

        <div className="gg-grid">
          <TextField label="Cafe name" value={name} onChange={setName} required />
          <TextField label="Phone" value={phone} onChange={setPhone} placeholder="+92 21 ..." />
        </div>
        <TextField label="Address" value={addressLine} onChange={setAddressLine} required />
        <TextAreaField
          label="About"
          value={description}
          onChange={setDescription}
          rows={3}
          placeholder="What you're known for"
        />

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <TextField
              label="Logo image URL"
              value={logoUrl}
              onChange={(next) => {
                setLogoUrl(next);
                setLogoBroken(false);
              }}
              placeholder="https://..."
              hint="A square image works best. Leave blank to show your initials."
              error={!isUrl(logoUrl) ? 'Enter a link starting with https://' : logoBroken ? 'That image could not be loaded' : undefined}
            />
          </div>
          <div
            aria-label="Logo preview"
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid var(--gg-border, #ddd)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              marginBottom: 24,
            }}
          >
            {logoUrl && isUrl(logoUrl) && !logoBroken ? (
              <img
                src={logoUrl}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <strong>
                {business.name
                  .split(/\s+/)
                  .filter((word) => /[A-Za-z0-9]/.test(word[0] ?? ''))
                  .slice(0, 2)
                  .map((word) => word[0]?.toUpperCase())
                  .join('')}
              </strong>
            )}
          </div>
        </div>

        <TextField
          label="Cover image URL"
          value={coverImageUrl}
          onChange={setCoverImageUrl}
          placeholder="https://..."
          error={!isUrl(coverImageUrl) ? 'Enter a link starting with https://' : undefined}
        />

        {error ? <p className="gg-error gg-small">{error}</p> : null}

        <div>
          <Button onClick={() => save.mutate()} disabled={invalid || logoBroken} loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </div>
    </Card>
  );
}
