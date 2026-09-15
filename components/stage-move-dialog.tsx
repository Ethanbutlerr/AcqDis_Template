'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function StageMoveDialog({
  open,
  fromStage,
  toStage,
  requiresConfirmation = false,
  saving = false,
  error = '',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  fromStage: string;
  toStage: string;
  requiresConfirmation?: boolean;
  saving?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (note: string) => Promise<boolean | void> | boolean | void;
}) {
  const [note, setNote] = useState('');
  const trimmedNote = note.trim();

  const close = () => {
    if (saving) return;
    setNote('');
    onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requiresConfirmation ? 'Confirm Stage Move' : 'Move to Another Stage'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Move this record from <strong>{fromStage}</strong> to <strong>{toStage}</strong>.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="stage-move-note">Stage note <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="stage-move-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add context if this move needs an explanation"
              rows={4}
              autoFocus
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">If left blank, the stage change is recorded automatically.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              const completed = await onConfirm(trimmedNote);
              if (completed !== false) setNote('');
            }}
            disabled={saving}
          >
            {saving ? 'Moving…' : 'Move Stage'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
