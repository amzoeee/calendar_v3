import { getSession } from '../lib/auth';
import { redirect } from 'next/navigation';

export default async function IndexPage() {
  const session = await getSession();
  const today = new Date().toLocaleDateString('en-CA');
  if (session) {
    redirect(`/calendar/${today}`);
  } else {
    redirect('/login');
  }
}
