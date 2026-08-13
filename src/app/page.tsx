import { getSession } from '../lib/auth';
import { redirect } from 'next/navigation';
import { todayForViewer } from '../lib/server-timezone';

export default async function IndexPage() {
  const session = await getSession();
  const today = await todayForViewer();
  if (session) {
    redirect(`/calendar/${today}`);
  } else {
    redirect('/login');
  }
}
