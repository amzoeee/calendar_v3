const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Date-bearing views whose date should carry across view switches.
const DATE_VIEWS = ['calendar', 'weekly', 'stats'];

export interface NavLink {
  key: string;
  href: string;
  label: string;
}

/**
 * Shared by SidebarNav (desktop) and MobileTabBar (mobile) so the currently-viewed
 * date carries across view switches (e.g. calendar/2026-08-15 -> weekly/2026-08-15)
 * consistently in both places. Falls back to `todayStr` when the current page
 * carries no date (e.g. Settings).
 */
export function getNavLinks(pathname: string, todayStr: string): { links: NavLink[]; activeKey: string | null } {
  const segments = pathname.split('/').filter(Boolean);
  const view = DATE_VIEWS.includes(segments[0]) ? segments[0] : null;
  const activeDate = segments[1] && DATE_RE.test(segments[1]) ? segments[1] : todayStr;

  const links: NavLink[] = [
    { key: 'calendar', href: `/calendar/${activeDate}`, label: 'Daily View' },
    { key: 'weekly', href: `/weekly/${activeDate}`, label: 'Weekly View' },
    { key: 'stats', href: `/stats/${activeDate}`, label: 'Stats' },
    { key: 'settings', href: '/settings', label: 'Settings' },
  ];

  const activeKey = segments[0] === 'settings' ? 'settings' : view;

  return { links, activeKey };
}
