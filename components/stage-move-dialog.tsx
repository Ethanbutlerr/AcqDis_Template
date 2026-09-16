'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  const started = useRef(false);

  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (requiresConfirmation || saving || started.current) return;
    started.current = true;
    void onConfirm('');
  }, [open, requiresConfirmation, saving, onConfirm]);

  const close = () => {
    if (saving) return;
    onCancel();
  };

  // Routine moves submit immediately; only failures or existing safety
  // confirmations need a dialog. History is still recorded by the move handler.
  if (!requiresConfirmation && !error) return null;

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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>Cancel</Button>
          <Button
            onClick={async () => {
              await onConfirm('');
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
