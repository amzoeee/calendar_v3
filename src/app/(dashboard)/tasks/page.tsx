import { getSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ensureDefaultBoard } from '@/app/task-actions';
import { VISIBLE_BOARDS_COOKIE } from '@/lib/tasks';

// /tasks has no board of its own. It restores the lists you last had open —
// mirrored into a cookie by the client so this server redirect can read it,
// the same trick <TimezoneSync> uses for the browser timezone. Reading it here
// rather than in the client avoids a flash of the wrong list.
//
// The cookie is taken as a hint, not as truth: /tasks/[boardId] drops ids that
// aren't yours or no longer exist and rewrites the URL to what's left, so a
// stale cookie degrades to the first list instead of erroring.
export default async function TasksIndexPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const boardId = await ensureDefaultBoard(session.userId);

  const remembered = (await cookies()).get(VISIBLE_BOARDS_COOKIE)?.value;
  if (remembered && /^\d+(,\d+)*$/.test(remembered)) {
    redirect(`/tasks/${remembered}`);
  }

  redirect(`/tasks/${boardId}`);
}
