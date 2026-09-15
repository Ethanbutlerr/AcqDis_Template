'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatRelativeTime } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pin, PinOff, Trash2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Note } from '@/lib/types';

export function NotesSection({
  entityType,
  entityId,
  companyId,
  relatedEntities = [],
}: {
  entityType: string;
  entityId: string;
  companyId: string;
  relatedEntities?: { entityType: string; entityId: string; label?: string }[];
}) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authors, setAuthors] = useState<Record<string, { name: string; roles: string[] }>>({});
  const [loadError, setLoadError] = useState('');
  const requestId = useRef(0);
  const relatedEntityKey = relatedEntities.map((target) => `${target.entityType}:${target.entityId}`).join('|');

  const loadNotes = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoadError('');
    try {
    const relatedTargets = relatedEntityKey
      ? relatedEntityKey.split('|').map((target) => {
        const separator = target.indexOf(':');
        return { entityType: target.slice(0, separator), entityId: target.slice(separator + 1) };
      })
      : [];
    const targets = [
      { entityType, entityId },
      ...relatedTargets,
    ].filter((target, index, all) => all.findIndex((candidate) => candidate.entityType === target.entityType && candidate.entityId === target.entityId) === index);
    const results = await Promise.all(targets.map((target) => supabase
      .from('notes')
      .select('*')
      .eq('company_id', companyId)
      .eq('entity_type', target.entityType)
      .eq('entity_id', target.entityId)));

    if (currentRequest !== requestId.current) return;
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    const loadedNotes = results.flatMap((result) => (result.data ?? []) as Note[])
      .filter((note, index, all) => all.findIndex((candidate) => candidate.id === note.id) === index)
      .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setNotes(loadedNotes);
    setAuthors({});
    setLoading(false);

    // Batch author lookups; missing profiles or restricted roles must not hide notes.
    const ids = Array.from(new Set(loadedNotes.map((note) => note.author_id).filter((id): id is string => Boolean(id))));
    const authorMap: Record<string, { name: string; roles: string[] }> = {};
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const [profiles, memberships] = await Promise.all([
        supabase.from('profiles').select('id, full_name, first_name, last_name').eq('company_id', companyId).in('id', batch),
        supabase.from('user_roles').select('user_id, roles!inner(name, company_id)').eq('roles.company_id', companyId).in('user_id', batch),
      ]);
      if (currentRequest !== requestId.current) return;
      for (const profile of profiles.data ?? []) {
        authorMap[profile.id] = {
          name: profile.full_name?.trim() || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unknown author',
          roles: [],
        };
      }
      for (const membership of memberships.data ?? []) {
        const roles = Array.isArray(membership.roles) ? membership.roles : [membership.roles];
        const author = authorMap[membership.user_id];
        if (author) author.roles = Array.from(new Set([...author.roles, ...roles.filter(Boolean).map((role) => role.name)])).sort();
      }
    }
    if (currentRequest === requestId.current) setAuthors(authorMap);
    } catch {
      if (currentRequest === requestId.current) {
        setLoadError('Some note information could not be loaded. Please retry.');
        setLoading(false);
      }
    }
  }, [entityType, entityId, companyId, relatedEntityKey]);

  useEffect(() => {
    setNotes([]);
    setAuthors({});
    setLoading(true);
    loadNotes();
    return () => { requestId.current += 1; };
  }, [loadNotes]);

  const addNote = async () => {
    if (!newNote.trim() || !user) return;
    setSaving(true);
    const mentions = Array.from(newNote.matchAll(/@(\w+)/g)).map((m) => m[1]);
    const { error } = await supabase.from('notes').insert({
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      author_id: user.id,
      body: newNote.trim(),
      mentions,
    });
    if (!error) {
      setNewNote('');
      await loadNotes();
      await supabase.from('activity_events').insert({
        company_id: companyId,
        actor_id: user.id,
        entity_type: entityType,
        entity_id: entityId,
        event_type: 'note_added',
      });
    }
    setSaving(false);
  };

  const togglePin = async (note: Note) => {
    await supabase.from('notes').update({ is_pinned: !note.is_pinned }).eq('id', note.id);
    await loadNotes();
  };

  const deleteNote = async (note: Note) => {
    await supabase.from('notes').delete().eq('id', note.id);
    await loadNotes();
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      {loadError && <div role="alert" className="text-sm text-destructive">{loadError} <Button variant="ghost" size="sm" onClick={loadNotes}>Retry</Button></div>}
      <div className="flex gap-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note... use @ to mention someone"
          className="min-h-[60px] resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addNote();
            }
          }}
        />
        <Button size="icon" onClick={addNote} disabled={saving || !newNote.trim()} className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No notes yet.</p>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                'rounded-lg border p-3',
                note.is_pinned && 'border-primary/50 bg-primary/5'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm whitespace-pre-wrap flex-1">{note.body}</p>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => togglePin(note)}
                  >
                    {note.is_pinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {note.author_id === user?.id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={() => deleteNote(note)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {note.entity_type !== entityType && (
                  <><BadgeSource label={relatedEntities.find((target) => target.entityType === note.entity_type && target.entityId === note.entity_id)?.label ?? note.entity_type.replaceAll('_', ' ')} />{' · '}</>
                )}
                <span className="font-medium">{note.author_id ? authors[note.author_id]?.name ?? 'Unknown author' : 'Unknown author'}</span>
                {' · '}
                <span title="Current role; historical roles were not saved with this note">
                  {note.author_id && authors[note.author_id]?.roles.length ? authors[note.author_id].roles.join(', ') : 'Role unavailable'}
                </span>
                {' · '}
                {formatRelativeTime(note.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeSource({ label }: { label: string }) {
  return <span className="capitalize">{label}</span>;
}
