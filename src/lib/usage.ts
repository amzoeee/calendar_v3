import { db } from '@/db';
import { usageEvents } from '@/db/schema';
import type { UsageName, UsageProps } from '@/lib/usage-catalog';

// Never throws: losing a usage row must not fail the action it describes.
export function track(userId: number | null, name: UsageName, props?: UsageProps): void {
  try {
    db.insert(usageEvents)
      .values({ userId, name, props: props ? JSON.stringify(props) : null })
      .run();
  } catch (error) {
    console.error(`[usage] could not record ${name}:`, error);
  }
}
