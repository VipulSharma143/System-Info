import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';

/*
  The one button.
    primary   — the main action on a surface (inverted ink pill)
    secondary — any other real action (outlined)
    ghost     — toolbar-style, low emphasis
    danger    — destructive toolbar action
*/

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Shows a spinner in place of the icon and blocks clicks. */
  loading?: boolean;
  /** Hide the label below the `xl` breakpoint and keep the icon (still read by assistive tech). */
  collapseLabel?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--primary)] text-[var(--on-primary)] font-semibold hover:opacity-90',
  secondary: 'border border-line-strong text-ink font-medium hover:bg-surface-3',
  ghost: 'text-muted font-medium hover:bg-surface-3 hover:text-ink',
  danger: 'text-critical font-medium hover:bg-[color-mix(in_srgb,var(--critical)_14%,transparent)]',
};

const SIZE: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[12px]',
  md: 'h-9 gap-2 px-4 text-[13px]',
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
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
      )}
      {children !== undefined && (
        <span className={iconOnly ? 'sr-only xl:not-sr-only' : undefined}>{children}</span>
      )}
    </button>
  );
}
