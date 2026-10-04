/** Dot + label for chart series. */
export default function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </span>
  );
}
