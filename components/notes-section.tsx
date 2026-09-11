'use client';

import { useState, useEffect, useCallback } from 'react';
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
  contactId,
}: {
  entityType: string;
  entityId: string;
  companyId: string;
  contactId?: string;
}) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadNotes = useCallback(async () => {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    setNotes((data ?? []) as Note[]);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    loadNotes();
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
      // Also write to conversation if this is an acquisition_record note with a linked contact
      if (entityType === 'acquisition_record' && contactId) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .eq('company_id', companyId)
          .eq('contact_id', contactId)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (conv) {
          await supabase.from('messages').insert({
            company_id: companyId,
            conversation_id: conv.id,
            contact_id: contactId,
            direction: 'outbound',
            body: newNote.trim(),
            status: 'delivered',
            is_simulated: false,
            is_automated: false,
            created_by: user.id,
          });
          await supabase.from('conversations').update({
            last_message_at: new Date().toISOString(),
            last_message_preview: `[Note] ${newNote.trim().slice(0, 60)}`,
            updated_at: new Date().toISOString(),
          }).eq('id', conv.id);
        }
      }

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
                {formatRelativeTime(note.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
