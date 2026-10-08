import { cookies } from 'next/headers';
import { MERGE_PENDING_COOKIE } from './merge-pending';

export async function getMergePending(): Promise<boolean> {
  return (await cookies()).get(MERGE_PENDING_COOKIE)?.value === '1';
}
