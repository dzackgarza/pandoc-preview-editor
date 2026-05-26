import { cn } from '../lib/utils.js';

export function PaneHeader({
  detail,
  light = false,
  title,
}: {
  detail: string;
  light?: boolean;
  title: string;
}) {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center justify-between border-b px-3 text-xs uppercase',
        light
          ? 'border-[#ddd8cf] bg-[#ebe7dc] text-[#55514a]'
          : 'border-[#2b2f38] bg-[#20232b] text-[#aab2c0]',
      )}
    >
      <span>{title}</span>
      <span className="max-w-[45%] truncate normal-case">{detail}</span>
    </div>
  );
}
