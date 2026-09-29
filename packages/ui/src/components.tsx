import { useEffect, useId, useRef, type ReactNode } from 'react';
import { orderStatusColors } from '@grabgo/config';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@grabgo/types';

/**
 * Dashboard building blocks.
 *
 * Presentational only, styled entirely through the CSS custom properties in
 * `styles.css`. Nothing here knows about the API, so both dashboards compose the
 * same pieces with their own data.
 */

/* ------------------------------------------------------------------ button */

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  title?: string;
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  block,
  title,
}: ButtonProps): React.JSX.Element {
  const classes = [
    'gg-button',
    variant !== 'primary' ? `gg-button--${variant}` : '',
    size !== 'md' ? `gg-button--${size}` : '',
    block ? 'gg-button--block' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled === true || loading === true}
      aria-busy={loading}
      title={title}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'gg-spin 700ms linear infinite',
      }}
    />
  );
}

/* -------------------------------------------------------------------- card */

export function Card({
  children,
  flush,
  style,
}: {
  children: ReactNode;
  flush?: boolean;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <div className={flush ? 'gg-card gg-card--flush' : 'gg-card'} style={style}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="gg-page-header">
      <div>
        <h1>{title}</h1>
        {description ? (
          <p className="gg-muted gg-small" style={{ marginTop: 4 }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="gg-row">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ fields */

export interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps): React.JSX.Element {
  const id = useId();

  return (
    <div className="gg-field">
      <label className="gg-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className="gg-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="gg-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  autoFocus,
  required,
  disabled,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  error?: string | undefined;
  hint?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}): React.JSX.Element {
  return (
    <Field label={label} error={error} {...(hint ? { hint } : {})}>
      {(id) => (
        <input
          id={id}
          className="gg-input"
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? 'true' : undefined}
          autoFocus={autoFocus}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  error,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  error?: string | undefined;
  suffix?: string;
}): React.JSX.Element {
  return (
    <Field label={label} error={error} {...(hint ? { hint } : {})}>
      {(id) => (
        <div className="gg-row">
          <input
            id={id}
            className="gg-input"
            type="number"
            value={Number.isFinite(value) ? value : ''}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onChange(Number(event.target.value))}
            aria-invalid={error ? 'true' : undefined}
          />
          {suffix ? <span className="gg-muted gg-small">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  hint?: string;
}): React.JSX.Element {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id) => (
        <select
          id={id}
          className="gg-select"
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}): React.JSX.Element {
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id) => (
        <textarea
          id={id}
          className="gg-textarea"
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}): React.JSX.Element {
  const id = useId();

  return (
    <div className="gg-spread">
      <div>
        <label className="gg-label" htmlFor={id} style={{ fontSize: 14 }}>
          {label}
        </label>
        {hint ? <div className="gg-hint">{hint}</div> : null}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 20, height: 20, accentColor: 'var(--color-primary)' }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<BadgeTone, { color: string; background: string }> = {
  neutral: { color: 'var(--color-text-secondary)', background: 'var(--color-surface-muted)' },
  primary: { color: 'var(--color-primary)', background: 'var(--color-primary-muted)' },
  success: { color: 'var(--color-success)', background: 'var(--color-success-muted)' },
  warning: { color: 'var(--amber-600)', background: 'var(--color-warning-muted)' },
  danger: { color: 'var(--color-danger)', background: 'var(--color-danger-muted)' },
  info: { color: 'var(--color-info)', background: 'var(--color-info-muted)' },
};

export function Badge({
  children,
  tone = 'neutral',
  dot,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}): React.JSX.Element {
  return (
    <span className="gg-badge" style={toneStyles[tone]}>
      {dot ? <span className="gg-badge__dot" /> : null}
      {children}
    </span>
  );
}

/** Order status with the colour every Grab & Go surface agrees on. */
export function StatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  const colours = orderStatusColors[status];

  return (
    <span className="gg-badge" style={{ color: colours.fg, background: colours.bg }}>
      <span className="gg-badge__dot" />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="gg-empty">
      <strong style={{ color: 'var(--color-text-primary)' }}>{title}</strong>
      {body ? <span className="gg-small">{body}</span> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  message = 'Something went wrong. Check your connection and try again.',
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div className="gg-empty" role="alert">
      <strong style={{ color: 'var(--color-danger)' }}>Could not load this</strong>
      <span className="gg-small">{message}</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
}: {
  height?: number;
  width?: number | string;
  radius?: number;
}): React.JSX.Element {
  return (
    <div
      className="gg-skeleton"
      aria-hidden
      style={{ height, width, borderRadius: radius }}
    />
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="gg-stack" style={{ padding: 'var(--space-base)' }}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={38} />
      ))}
    </div>
  );
}

/**
 * The loading / error / empty ladder, in one place.
 *
 * Screens call this rather than writing the branch themselves, which is how one
 * of the three states ends up missing.
 */
export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  loadingRows = 5,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  loadingRows?: number;
  children: ReactNode;
}): React.JSX.Element {
  if (isLoading) return <TableSkeleton rows={loadingRows} />;
  if (isError) return <ErrorState {...(onRetry ? { onRetry } : {})} />;
  if (isEmpty) return <EmptyState title={emptyTitle} {...(emptyBody ? { body: emptyBody } : {})} />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------- stats */

export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'success' | 'danger';
}): React.JSX.Element {
  return (
    <Card>
      <div className="gg-overline">{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '-0.5px',
          marginTop: 6,
          color:
            tone === 'success'
              ? 'var(--color-success)'
              : tone === 'danger'
                ? 'var(--color-danger)'
                : undefined,
        }}
      >
        {value}
      </div>
      {detail ? (
        <div className="gg-muted gg-small" style={{ marginTop: 2 }}>
          {detail}
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog so a keyboard user is not
  // left tabbing through the page behind it.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKey);
    ref.current?.focus();

    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="gg-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="gg-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="gg-spread">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {children}

        {footer ? <div className="gg-row" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- toast */

export function Toast({ message }: { message: string | null }): React.JSX.Element | null {
  if (!message) return null;

  return (
    <div className="gg-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
