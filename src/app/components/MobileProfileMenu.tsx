'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { LogOut, Settings as SettingsIcon } from 'lucide-react';

/**
 * Rendered in a portal with fixed positioning so it escapes the dashboard
 * layout's overflow-hidden containers — otherwise it gets clipped/hidden
 * behind the page content (same issue EventSearch's dropdown solves).
 */
export default function MobileProfileMenu({
  username,
  logoutAction,
}: {
  username: string;
  logoutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const menu =
    open && rect
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: rect.bottom + 8,
              right: Math.max(8, window.innerWidth - rect.right),
            }}
            className="w-44 z-[100] bg-card border border-border rounded-lg shadow-2xl p-2 space-y-1"
          >
            <p className="px-2 py-1 text-sm font-semibold text-foreground truncate">{username}</p>
            {/* Settings lives here rather than in the tab bar — see MobileTabBar. */}
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="w-full flex items-center px-2 py-2 text-sm font-medium rounded-md text-foreground hover:bg-secondary transition-all gap-2"
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-full flex items-center px-2 py-2 text-sm font-medium rounded-md text-red-400 hover:bg-red-950/20 hover:text-red-300 transition-all gap-2 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </form>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        className="h-7 w-7 rounded-full bg-muted flex items-center justify-center font-bold text-foreground text-xs uppercase cursor-pointer"
      >
        {username[0]}
      </button>
      {menu}
    </>
  );
}
