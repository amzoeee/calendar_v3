'use client';

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Check, Copy, Trash2 } from 'lucide-react';
import Select from '@/app/components/Select';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { getBrowserTimeZone } from '@/lib/timezone';
import type { McpTokenView } from '@/lib/mcp-tokens';
import {
  createMcpTokenAction,
  revokeMcpTokenAction,
  setMcpTokenTimeZoneAction,
} from '@/features/mcp/server/actions';

function formatLastUsed(iso: string | null): string {
  if (!iso) return 'never used';
  return `last used ${new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

const subscribeNever = () => () => {};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1.5 rounded bg-secondary border border-border hover:bg-muted cursor-pointer transition"
      aria-label="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function McpTokens({ tokens }: { tokens: McpTokenView[] }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  // Empty during the server render, which knows neither.
  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => '');
  const browserTz = useSyncExternalStore(subscribeNever, getBrowserTimeZone, () => '');

  const zoneOptions = useMemo(() => {
    const zones = new Set(Intl.supportedValuesOf('timeZone'));
    for (const t of tokens) zones.add(t.timeZone);
    return [...zones].sort().map((z) => ({ value: z, label: z }));
  }, [tokens]);

  const endpoint = `${origin}/api/mcp`;
  const addCommand = newToken
    ? `claude mcp add --transport http calendar ${endpoint} --header "Authorization: Bearer ${newToken}"`
    : '';

  const handleCreate = async () => {
    setError('');
    setIsCreating(true);
    const res = await createMcpTokenAction(name, browserTz || getBrowserTimeZone());
    setIsCreating(false);
    if ('error' in res) {
      setError(res.error ?? '');
      return;
    }
    setNewToken(res.token);
    setName('');
    router.refresh();
  };

  const handleRevoke = async (token: McpTokenView) => {
    const ok = await confirm({
      title: `Revoke “${token.name}”?`,
      message: 'Anything using this token loses access to your calendar right away.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    await revokeMcpTokenAction(token.id);
    router.refresh();
  };

  const handleZoneChange = async (id: number, zone: string) => {
    await setMcpTokenTimeZoneAction(id, zone);
    router.refresh();
  };

  return (
    <section className="bg-card rounded-xl border border-border p-4 lg:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold tracking-tight">MCP Server</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Lets Claude and other MCP clients read and edit your events at{' '}
        <code className="bg-secondary px-1 rounded text-primary">{endpoint}</code>. Each token reads and writes
        times in its own timezone.
      </p>

      {tokens.length > 0 && (
        <ul className="space-y-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 rounded bg-secondary border border-border px-3 py-2"
            >
              <span className="text-xs text-foreground">
                <span className="font-semibold">{t.name}</span>
                <span className="ml-2 font-mono text-muted-foreground">{t.tokenPrefix}…</span>
                <span className="ml-2 text-muted-foreground">{formatLastUsed(t.lastUsedAt)}</span>
              </span>
              <div className="flex items-center gap-3">
                <Select
                  value={t.timeZone}
                  options={zoneOptions}
                  onChange={(zone) => handleZoneChange(t.id, zone)}
                  aria-label={`Timezone for ${t.name}`}
                  className="text-xs"
                />
                <button
                  onClick={() => handleRevoke(t)}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {newToken && (
        <div className="space-y-3 rounded border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs text-foreground font-semibold">Copy this token now. It won’t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-secondary border border-border px-2 py-1.5 text-xs font-mono">
              {newToken}
            </code>
            <CopyButton text={newToken} />
          </div>
          <p className="text-xs text-muted-foreground">To add it to Claude Code:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 break-all rounded bg-secondary border border-border px-2 py-1.5 text-xs font-mono">
              {addCommand}
            </code>
            <CopyButton text={addCommand} />
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer"
          >
            Done
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="w-full lg:w-64">
          <label className="block text-xs font-semibold text-muted-foreground uppercase">Token name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="Claude Code on laptop"
            maxLength={60}
            className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-xs text-foreground"
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="px-4 py-2 bg-primary hover:bg-muted disabled:opacity-50 text-primary-foreground rounded text-xs font-bold transition cursor-pointer"
        >
          {isCreating ? 'Creating...' : 'Create Token'}
        </button>
      </div>
      {browserTz && <p className="text-xs text-muted-foreground">New tokens start in {browserTz}.</p>}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </section>
  );
}
