import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

/*
  The one button. Every action in the app used to carry its own copy of a long
  class string with slightly different heights, radii and hover colours; this
  gives them a single definition.

    primary   — the main action on a surface (filled accent)
    secondary — everything else that's a real action (outlined)
    ghost     — toolbar-style, low emphasis (no border until hover)
    danger    — destructive toolbar action (critical text, soft hover)
*/

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Shows a spinner in place of the icon and blocks clicks. */
  loading?: boolean;
  /**
   * Hide the text label below the `xl` breakpoint and keep the icon — for
   * dense toolbars in a narrow window. The label stays available to
   * assistive tech and as a tooltip.
   */
  collapseLabel?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--on-accent)] font-semibold hover:bg-[var(--accent-strong)] active:bg-[var(--accent-strong)]',
  secondary:
    'border border-[var(--border-strong)] bg-transparent text-[var(--text)] font-medium hover:bg-[var(--surface-hover)]',
  ghost:
    'text-[var(--text-muted)] font-medium hover:bg-[var(--surface-hover)] hover:text-[var(--text)]',
  danger: 'text-[var(--critical)] font-medium hover:bg-[var(--critical-soft)]',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-[12px]',
  md: 'h-8 gap-2 px-3.5 text-[13px]',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  collapseLabel = false,
  disabled,
  className = '',
  type = 'button',
  title,
  children,
  ...rest
}: ButtonProps) {
  const iconOnly = collapseLabel && Icon;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      title={title}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      {children !== undefined && (
        <span className={iconOnly ? 'sr-only xl:not-sr-only' : undefined}>{children}</span>
      )}
    </button>
  );
}
