import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getBuildInfo } from '@/lib/version';
import SettingsClient from './SettingsClient';
import { getWeekStart } from '@/lib/server-week';
import { getSubtagDisplay } from '@/lib/server-tags';
import { getLinksForUser } from '@/lib/discord-link';
import { getTags } from '@/features/tags/server/queries';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Fetch all tags for user
  const dbTags = await getTags(session.userId);

  return (
    <SettingsClient
      initialTags={dbTags}
      buildInfo={getBuildInfo()}
      weekStart={await getWeekStart()}
      subtagDisplay={await getSubtagDisplay()}
      discordLinks={await getLinksForUser(session.userId)}
    />
  );
}
