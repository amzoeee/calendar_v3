'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { resetPasswordAction } from '@/app/admin-actions';
import Button from '@/app/components/Button';

export default function ResetPasswordButton({ userId, username }: { userId: number; username: string }) {
  const { confirm } = useConfirm();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    const ok = await confirm({
      title: `Reset ${username}'s password?`,
      message: 'Their current password stops working right away. You’ll get a temporary one to send them.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await resetPasswordAction(userId);
    setBusy(false);
    setResult('password' in res ? res.password : res.error);
  };

  if (result) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Temporary password:</span>
        <code className="px-2 py-1 rounded bg-secondary font-mono text-foreground select-all">{result}</code>
      </span>
    );
  }

  return (
    <Button
      size="none"
      type="button"
      onClick={reset}
      disabled={busy}
      className="inline-flex gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
    >
      <KeyRound className="h-3.5 w-3.5" />
      Reset password
    </Button>
  );
}
