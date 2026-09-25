import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

// Tables that fill a card edge to edge should also carry the `table-flush`
// class (see index.css) so their first/last columns align with the card's
// header inset.

export function Th({ children, className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[var(--border)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text-muted)] ${className}`}
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
      className={`border-b border-[var(--border)] transition-colors last:border-0 hover:bg-[var(--surface-hover)] ${className}`}
      {...rest}
    >
      {children}
    </tr>
  );
}
