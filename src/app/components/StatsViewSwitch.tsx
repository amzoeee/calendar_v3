import Link from 'next/link';
import { ChartColumn, ChartScatter } from 'lucide-react';

interface StatsViewSwitchProps {
  active: 'range' | 'lifetime';
  rangeHref: string;
}

const LIFETIME_HREF = '/stats/lifetime';

/**
 * Range / Lifetime toggle for the stats header. Desktop gets both labels;
 * mobile gets one icon linking to the other view, to keep the header short.
 */
export default function StatsViewSwitch({ active, rangeHref }: StatsViewSwitchProps) {
  const item = (key: 'range' | 'lifetime', href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
        active === key
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="hidden md:flex items-center gap-0.5 p-0.5 bg-secondary border border-border rounded-lg">
        {item('range', rangeHref, 'Range')}
        {item('lifetime', LIFETIME_HREF, 'Lifetime')}
      </div>
      <Link
        href={active === 'range' ? LIFETIME_HREF : rangeHref}
        aria-label={active === 'range' ? 'Lifetime view' : 'Range view'}
        className="md:hidden p-2 rounded-lg bg-secondary hover:bg-muted text-foreground transition"
      >
        {active === 'range' ? <ChartScatter className="h-4 w-4" /> : <ChartColumn className="h-4 w-4" />}
      </Link>
    </>
  );
}
