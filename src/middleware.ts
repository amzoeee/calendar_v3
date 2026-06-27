import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Define public and protected paths
  const isPublicPath = path === '/login' || path === '/register';
  const isProtectedPath =
    path.startsWith('/calendar') ||
    path.startsWith('/weekly') ||
    path.startsWith('/stats') ||
    path.startsWith('/settings');

  const sessionCookie = request.cookies.get('calendar_session');

  // Redirect root / to today's daily view
  if (path === '/') {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local time
    if (sessionCookie) {
      return NextResponse.redirect(new URL(`/calendar/${today}`, request.url));
    } else {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // If session cookie exists and user is on a public page, redirect to today's daily view
  if (isPublicPath && sessionCookie) {
    const today = new Date().toLocaleDateString('en-CA');
    return NextResponse.redirect(new URL(`/calendar/${today}`, request.url));
  }

  // If no session cookie exists and user is on a protected page, redirect to login
  if (isProtectedPath && !sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/register', '/calendar/:path*', '/weekly/:path*', '/stats/:path*', '/settings/:path*'],
};
