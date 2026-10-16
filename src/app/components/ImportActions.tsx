'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Trash2 } from 'lucide-react';
import { useUndo } from '@/app/components/UndoToast';
import {
  approveAllPendingAction,
  discardAllPendingAction,
  restoreDiscardedImportAction,
  unapproveImportAction,
} from '@/app/actions';

const plural = (n: number) => `${n} event${n === 1 ? '' : 's'}`;

/** Approve All / Discard All for the pending banner, each with Undo. */
export default function ImportActions() {
  const router = useRouter();
  const { raiseUndo } = useUndo();
  const [busy, startTransition] = useTransition();

  const approve = () =>
    startTransition(async () => {
      const snapshot = await approveAllPendingAction();
      router.refresh();
      raiseUndo({
        message: `Approved ${plural(snapshot.ids.length + snapshot.absorbed.length)}`,
        undo: async () => {
          await unapproveImportAction(snapshot);
          router.refresh();
        },
      });
    });

  const discard = () =>
    startTransition(async () => {
      const snapshot = await discardAllPendingAction();
      router.refresh();
      raiseUndo({
        message: `Discarded ${plural(snapshot.rows.length)}`,
        undo: async () => {
          await restoreDiscardedImportAction(snapshot);
          router.refresh();
        },
      });
    });

  return (
    <>
      <button
        type="button"
        onClick={approve}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded text-xs font-semibold shadow transition cursor-pointer"
      >
        <Check className="h-3.5 w-3.5" />
        Approve All
      </button>

      <button
        type="button"
        onClick={discard}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-xs font-semibold shadow transition cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Discard All
      </button>
    </>
  );
}
