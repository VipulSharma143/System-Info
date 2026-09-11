import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

export function Th({ children, className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-[var(--border)] px-3 py-2 text-left text-[12px] font-normal text-[var(--text-faint)] ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = '',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
  return (
    <td className={`px-3 py-2 text-[13px] text-[var(--text)] ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function Tr({
  children,
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-hover)] ${className}`}
      {...rest}
    >
      {children}
    </tr>
  );
}
