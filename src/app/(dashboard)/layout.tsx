import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { events } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  TrendingUp,
  Settings as SettingsIcon,
  LogOut,
  Sparkles,
  Check,
  Trash2,
  CalendarDays,
} from 'lucide-react';
import {
  approveAllPendingAction,
  discardAllPendingAction,
  overridePendingDateAction,
  logoutAction,
} from '@/app/actions';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Get pending count
  const pendingCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.userId, session.userId), eq(events.isPending, 1)));
  const pendingCount = pendingCountResult[0]?.count || 0;

  const todayStr = new Date().toLocaleDateString('en-CA');

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 bg-card border-r border-border flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="h-16 flex items-center px-6 border-b border-border gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            <span className="font-extrabold text-lg tracking-wider bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              CALENDAR V2
            </span>
          </div>

          {/* Nav Navigation */}
          <nav className="mt-6 px-4 space-y-1">
            <Link
              href={`/calendar/${todayStr}`}
              className="flex items-center px-4 py-3 text-sm font-medium rounded-lg text-foreground hover:bg-secondary transition-all gap-3"
            >
              <CalendarIcon className="h-5 w-5 text-muted-foreground" />
              Daily View
            </Link>
            <Link
              href={`/weekly/${todayStr}`}
              className="flex items-center px-4 py-3 text-sm font-medium rounded-lg text-foreground hover:bg-secondary transition-all gap-3"
            >
              <CalendarIcon className="h-5 w-5 text-muted-foreground" />
              Weekly View
            </Link>
            <Link
              href={`/stats/${todayStr}`}
              className="flex items-center px-4 py-3 text-sm font-medium rounded-lg text-foreground hover:bg-secondary transition-all gap-3"
            >
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              Weekly Stats
            </Link>
            <Link
              href="/settings"
              className="flex items-center px-4 py-3 text-sm font-medium rounded-lg text-foreground hover:bg-secondary transition-all gap-3"
            >
              <SettingsIcon className="h-5 w-5 text-muted-foreground" />
              Settings
            </Link>
          </nav>
        </div>

        {/* User profile & Logout */}
        <div className="p-4 border-t border-border space-y-3">
          <div className="px-4 py-2 bg-secondary/50 rounded-lg flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center font-bold text-primary-foreground text-sm uppercase">
              {session.username[0]}
            </div>
            <div className="truncate">
              <p className="text-sm font-semibold truncate">{session.username}</p>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full flex items-center px-4 py-2.5 text-sm font-medium rounded-lg text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-all gap-3 cursor-pointer"
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Pending Import Banner */}
        {pendingCount > 0 && (
          <div className="bg-amber-950/30 border-b border-amber-500/30 p-4 flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 glass-panel">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-amber-400 animate-pulse" />
              <p className="text-sm font-medium text-amber-200">
                You have <span className="font-bold underline">{pendingCount}</span> pending events staged from log import.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Approve All */}
              <form action={approveAllPendingAction}>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-semibold shadow transition cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve All
                </button>
              </form>
              
              {/* Discard All */}
              <form action={discardAllPendingAction}>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold shadow transition cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard All
                </button>
              </form>

              {/* Shift Date */}
              <form action={overridePendingDateAction} className="flex items-center gap-2">
                <input
                  type="date"
                  name="newDate"
                  required
                  defaultValue={todayStr}
                  className="bg-secondary border border-border px-2 py-1 rounded text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 w-32"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold shadow transition cursor-pointer"
                >
                  Shift Date
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto relative flex flex-col min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
