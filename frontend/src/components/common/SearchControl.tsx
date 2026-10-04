import { Search } from 'lucide-react';

interface SearchControlProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchControl({ value, onChange, placeholder }: SearchControlProps) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full min-w-[200px] rounded-full bg-surface-2 pl-9 pr-4 text-[13px] text-ink placeholder:text-faint focus:outline-2 focus:outline-[var(--focus)]"
      />
    </div>
  );
}
