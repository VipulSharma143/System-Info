import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

// Tables that fill a panel edge to edge also carry `table-flush` (see styles/components.css).

export function Th({ children, className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-medium text-faint ${className}`} {...rest}>
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
    <td className={`px-3 py-2.5 text-[13px] text-ink ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ children, className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-t border-line transition-colors first:border-0 hover:bg-surface-2 ${className}`} {...rest}>
      {children}
    </tr>
  );
}
