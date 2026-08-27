import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ensureDefaultBoard } from '@/app/task-actions';

// /tasks has no board of its own — it lands you on your first one. Accounts
// created before tasks existed get their default board made here.
export default async function TasksIndexPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const boardId = await ensureDefaultBoard(session.userId);
  redirect(`/tasks/${boardId}`);
}
