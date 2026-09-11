import { Search } from 'lucide-react';

interface SearchControlProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchControl({ value, onChange, placeholder }: SearchControlProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--surface-raised)] py-1.5 pl-8 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none"
      />
    </div>
  );
}
