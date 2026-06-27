'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  Trash2,
  Edit2,
  FileDown,
  FileUp,
  MessageSquareCode,
  GripVertical,
  X,
  Plus,
} from 'lucide-react';
import {
  addTagAction,
  updateTagAction,
  deleteTagAction,
  archiveTagAction,
  unarchiveTagAction,
  reorderTagsAction,
  stageLogAction,
} from '@/app/actions';

interface Tag {
  id: number;
  name: string;
  color: string;
  isArchived: number;
  orderIndex: number;
}

interface SettingsClientProps {
  initialTags: Tag[];
}

export default function SettingsClient({ initialTags }: SettingsClientProps) {
  const router = useRouter();

  // --- Tags list state ---
  const [tagsList, setTagsList] = useState<Tag[]>(initialTags);

  // --- Add Tag State ---
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6b7280');
  const [addTagError, setAddTagError] = useState('');

  // --- Edit Tag Modal State ---
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('');
  const [editTagError, setEditTagError] = useState('');

  // --- Import/Export States ---
  const [importTag, setImportTag] = useState('');
  
  // --- Discord Log State ---
  const [logText, setLogText] = useState('');
  const [logDateOverride, setLogDateOverride] = useState('');
  const [logError, setLogError] = useState('');
  const [isLogStaging, setIsLogStaging] = useState(false);

  // --- ICS Export State ---
  const [exportTagId, setExportTagId] = useState('');
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const activeTags = tagsList.filter((t) => !t.isArchived);
  const archivedTags = tagsList.filter((t) => t.isArchived === 1);

  // Drag and Drop reordering logic
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIdx(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === index) return;

    // Rearrange tags list locally
    const reordered = [...activeTags];
    const [draggedItem] = reordered.splice(draggedIdx, 1);
    reordered.splice(index, 0, draggedItem);

    // Reconstruct full tagsList
    const otherTags = tagsList.filter((t) => t.isArchived === 1);
    setTagsList([...reordered, ...otherTags]);
    setDraggedIdx(index);
  };

  const handleDragEnd = async () => {
    setDraggedIdx(null);
    const activeIds = activeTags.map((t) => t.id);
    try {
      await reorderTagsAction(activeIds);
    } catch (e: any) {
      console.error('Error saving tag order:', e);
    }
  };

  // Add tag handler
  const handleAddTagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddTagError('');
    try {
      await addTagAction(newTagName, newTagColor);
      setNewTagName('');
      setNewTagColor('#6b7280');
      // Refresh local page data
      router.refresh();
    } catch (e: any) {
      setAddTagError(e.message || 'Failed to add tag');
    }
  };

  // Edit tag handlers
  const handleOpenEditModal = (tag: Tag) => {
    setEditingTag(tag);
    setEditTagName(tag.name);
    setEditTagColor(tag.color);
    setEditTagError('');
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTag) return;
    setEditTagError('');
    try {
      await updateTagAction(editingTag.id, editTagName, editTagColor);
      setShowEditModal(false);
      setEditingTag(null);
      router.refresh();
    } catch (e: any) {
      setEditTagError(e.message || 'Failed to update tag');
    }
  };

  // Archive / unarchive handlers
  const handleArchive = async (tagId: number, name: string) => {
    if (confirm(`Archive tag "${name}"?\n\nYou will not be able to assign this tag to new events, but it will still display on the calendar.`)) {
      await archiveTagAction(tagId);
      router.refresh();
    }
  };

  const handleUnarchive = async (tagId: number) => {
    await unarchiveTagAction(tagId);
    router.refresh();
  };

  // Delete tag with check for associated events
  const handleDeleteTag = async (tagId: number, name: string) => {
    try {
      // Query our api route handler to check if tag is in use
      const res = await fetch(`/api/events?tag=${encodeURIComponent(name)}`);
      const data = await res.json();
      const count = data.events ? data.events.length : 0;

      let msg = `Delete tag "${name}"?`;
      if (count > 0) {
        msg += `\n\nThis tag is used by ${count} event(s). They will be set to untagged.`;
      }

      if (confirm(msg)) {
        await deleteTagAction(tagId);
        router.refresh();
      }
    } catch {
      // Fallback delete
      if (confirm(`Delete tag "${name}"?`)) {
        await deleteTagAction(tagId);
        router.refresh();
      }
    }
  };

  // Stage Discord Log handler
  const handleStageLog = async () => {
    setLogError('');
    if (!logText.trim()) {
      setLogError('Paste some log text first.');
      return;
    }

    setIsLogStaging(true);
    try {
      const res = await stageLogAction(logText, logDateOverride || null);
      if (res?.error) {
        setLogError(res.error);
        setIsLogStaging(false);
      } else if (res?.success && res.dateUsed) {
        // Redirect to calendar view for the resolved date
        router.push(`/calendar/${res.dateUsed}`);
      }
    } catch (e: any) {
      setLogError(e.message || 'Network error staging log');
      setIsLogStaging(false);
    }
  };

  // Export handler
  const handleExport = () => {
    let url = '/api/export-ics?';
    const params = [];
    if (exportTagId) params.push(`tag=${exportTagId}`);
    if (exportStartDate) params.push(`start_date=${exportStartDate}`);
    if (exportEndDate) params.push(`end_date=${exportEndDate}`);
    url += params.join('&');
    window.location.href = url;
  };

  // Sync state if initialTags changes
  React.useEffect(() => {
    setTagsList(initialTags);
  }, [initialTags]);

  return (
    <div className="flex-1 p-8 space-y-8 max-w-4xl mx-auto">
      
      {/* Tag Management */}
      <section className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Edit2 className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Tag Management</h2>
        </div>

        {/* Active tag list */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Tags</h3>
          <div className="space-y-1.5" id="tag-list">
            {activeTags.map((tag, idx) => (
              <div
                key={tag.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className="flex items-center justify-between p-3 bg-secondary/35 rounded-lg border border-border/40 cursor-grab active:cursor-grabbing hover:bg-secondary/55 transition-all select-none"
              >
                <div className="flex items-center gap-3 truncate">
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab flex-shrink-0" />
                  <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                  <span className="text-sm font-semibold truncate text-foreground">{tag.name}</span>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleOpenEditModal(tag)}
                    className="px-2 py-1 bg-secondary hover:bg-muted border border-border text-xs rounded font-semibold text-foreground cursor-pointer transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleArchive(tag.id, tag.name)}
                    className="px-2 py-1 bg-secondary hover:bg-muted border border-border text-xs rounded font-semibold text-amber-400 cursor-pointer transition flex items-center gap-1"
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </button>
                  <button
                    onClick={() => handleDeleteTag(tag.id, tag.name)}
                    className="px-2 py-1 bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-xs rounded font-semibold text-red-400 cursor-pointer transition flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Collapsible Archived Tags */}
        <details className="border border-border/50 rounded-lg overflow-hidden bg-secondary/15 transition-all">
          <summary className="px-4 py-3 bg-secondary/30 font-semibold text-sm cursor-pointer select-none flex items-center justify-between hover:bg-secondary/45">
            <span>Archived Tags</span>
            <span className="text-xs text-muted-foreground">▼</span>
          </summary>
          <div className="p-4 border-t border-border/50 space-y-2 bg-card">
            {archivedTags.length > 0 ? (
              archivedTags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between p-3 bg-secondary/20 rounded-lg border border-border/40 opacity-75"
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                    <span className="text-sm font-semibold truncate line-through text-muted-foreground">{tag.name}</span>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleUnarchive(tag.id)}
                      className="px-2 py-1 bg-secondary hover:bg-muted border border-border text-xs rounded font-semibold text-foreground cursor-pointer transition flex items-center gap-1"
                    >
                      <ArchiveRestore className="h-3 w-3" />
                      Unarchive
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag.id, tag.name)}
                      className="px-2 py-1 bg-red-950/20 hover:bg-red-900/30 border border-red-900/30 text-xs rounded font-semibold text-red-400 cursor-pointer transition flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">No archived tags.</p>
            )}
          </div>
        </details>

        {/* Add Tag Inline Form */}
        <div className="bg-secondary/25 border border-border/40 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-bold text-foreground">Add New Tag</h4>
          <form onSubmit={handleAddTagSubmit} className="flex flex-col md:flex-row items-end gap-3">
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-muted-foreground uppercase">Tag Name</label>
              <input
                type="text"
                required
                placeholder="Work, Health, Hobbies..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="shrink-0 w-24">
              <label className="block text-xs font-semibold text-muted-foreground uppercase">Color</label>
              <input
                type="color"
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="mt-1 block w-full h-8 rounded bg-secondary border border-border px-1 py-0.5 cursor-pointer"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Tag
            </button>
          </form>
          {addTagError && <p className="text-xs text-red-400 mt-1">{addTagError}</p>}
        </div>
      </section>

      {/* Import Calendar */}
      <section className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FileUp className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Import Google Calendar</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Import events from a Google Calendar <code className="bg-secondary px-1 rounded text-primary">.ics</code> file.
        </p>

        <form action="/api/import-ics" method="POST" encType="multipart/form-data" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase">ICS File</label>
              <input
                type="file"
                name="ics_file"
                accept=".ics"
                required
                className="mt-1 block w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase">Assign Tag</label>
              <select
                name="import_tag"
                value={importTag}
                onChange={(e) => setImportTag(e.target.value)}
                className="mt-1 block w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground cursor-pointer"
              >
                <option value="">No Tag</option>
                {activeTags.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded text-xs font-bold transition cursor-pointer"
          >
            Import ICS File
          </button>
        </form>
      </section>

      {/* Import Discord Log */}
      <section className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-center gap-3">
          <MessageSquareCode className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Import Discord Log</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste your shorthand log below. The chronological alignment logic will stage these events in pending mode.
        </p>

        <div className="space-y-4">
          <div className="flex flex-col md:flex-row items-end gap-3">
            <div className="w-48">
              <label className="block text-xs font-semibold text-muted-foreground uppercase">
                Date Override <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={logDateOverride}
                onChange={(e) => setLogDateOverride(e.target.value)}
                className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-xs text-foreground"
              />
            </div>
            <button
              onClick={handleStageLog}
              disabled={isLogStaging}
              className="px-4 py-2 bg-primary hover:bg-blue-600 disabled:opacity-50 text-white rounded text-xs font-bold transition cursor-pointer"
            >
              {isLogStaging ? 'Staging...' : 'Stage Discord Log'}
            </button>
          </div>

          <div>
            <textarea
              value={logText}
              onChange={(e) => setLogText(e.target.value)}
              placeholder="Paste Discord text log here...&#10;&#10;Example:&#10;--- Today at 9:00 AM ---&#10;900 Wake up&#10;930 Breakfast&#10;1030 Work&#10;1200 Lunch"
              rows={6}
              className="block w-full rounded bg-secondary border border-border px-3 py-2 text-xs font-mono text-foreground resize-vertical"
            />
          </div>

          {logError && <p className="text-xs text-red-400 mt-1">{logError}</p>}
        </div>
      </section>

      {/* Export Calendar */}
      <section className="bg-card rounded-xl border border-border p-6 space-y-6">
        <div className="flex items-center gap-3">
          <FileDown className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Export Calendar</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Export events as `.ics` files. Select "All Events" to download a ZIP archive containing separate files for each tag.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase">Filter by Tag</label>
            <select
              value={exportTagId}
              onChange={(e) => setExportTagId(e.target.value)}
              className="mt-1 block w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground cursor-pointer"
            >
              <option value="">All Events (ZIP)</option>
              {tagsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase">Start Date <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              type="date"
              value={exportStartDate}
              onChange={(e) => setExportStartDate(e.target.value)}
              className="mt-1 block w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase">End Date <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              type="date"
              value={exportEndDate}
              onChange={(e) => setExportEndDate(e.target.value)}
              className="mt-1 block w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground"
            />
          </div>
        </div>
        
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-primary hover:bg-blue-600 text-white rounded text-xs font-bold transition cursor-pointer"
        >
          Export ICS File
        </button>
      </section>

      {/* EDIT TAG MODAL */}
      {showEditModal && editingTag && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-card border border-border p-6 rounded-lg w-full max-w-sm space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-lg font-bold text-foreground">Edit Tag</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Tag Name</label>
                <input
                  type="text"
                  required
                  value={editTagName}
                  onChange={(e) => setEditTagName(e.target.value)}
                  className="mt-1 block w-full rounded bg-secondary border border-border px-3 py-1.5 text-sm text-foreground focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase">Color</label>
                <input
                  type="color"
                  value={editTagColor}
                  onChange={(e) => setEditTagColor(e.target.value)}
                  className="mt-1 block w-full h-8 rounded bg-secondary border border-border px-1 py-0.5 cursor-pointer"
                />
              </div>

              {editTagError && <p className="text-xs text-red-400 mt-1">{editTagError}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary hover:bg-blue-600 text-white rounded text-sm font-bold cursor-pointer transition"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 bg-secondary hover:bg-muted text-foreground rounded text-sm font-semibold cursor-pointer transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
