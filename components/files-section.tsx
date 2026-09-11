'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDate } from '@/lib/utils/format';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Image as ImageIcon, Upload, Trash2, Download } from 'lucide-react';
import { FileRecord } from '@/lib/types';
import { FILE_CATEGORIES } from '@/lib/types';

export function FilesSection({
  entityType,
  entityId,
  companyId,
}: {
  entityType: string;
  entityId: string;
  companyId: string;
}) {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<string>('Other');

  const loadFiles = useCallback(async () => {
    const { data } = await supabase
      .from('files')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false });

    setFiles((data ?? []) as FileRecord[]);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !user) return;

    setUploading(true);
    for (const file of Array.from(selectedFiles)) {
      const storagePath = `${companyId}/${entityType}/${entityId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('crm-files')
        .upload(storagePath, file);

      if (!uploadError) {
        await supabase.from('files').insert({
          company_id: companyId,
          entity_type: entityType,
          entity_id: entityId,
          uploaded_by: user.id,
          storage_path: storagePath,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          category,
        });
        await supabase.from('activity_events').insert({
          company_id: companyId,
          actor_id: user.id,
          entity_type: entityType,
          entity_id: entityId,
          event_type: 'file_uploaded',
          metadata: { file_name: file.name, category },
        });
      }
    }
    await loadFiles();
    setUploading(false);
    e.target.value = '';
  };

  const handleDelete = async (file: FileRecord) => {
    await supabase.storage.from('crm-files').remove([file.storage_path]);
    await supabase.from('files').delete().eq('id', file.id);
    await loadFiles();
  };

  const handleDownload = async (file: FileRecord) => {
    const { data } = await supabase.storage.from('crm-files').createSignedUrl(file.storage_path, 3600);
    if (data) {
      window.open(data.signedUrl, '_blank');
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILE_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label>
          <Button variant="default" size="sm" className="gap-1.5 cursor-pointer" disabled={uploading} asChild>
            <span>
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload'}
            </span>
          </Button>
          <input type="file" multiple className="hidden" onChange={handleUpload} />
        </label>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No files yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              {file.file_type.startsWith('image/') ? (
                <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {file.category} · {formatDate(file.created_at)}
                </p>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => handleDownload(file)}>
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-destructive"
                onClick={() => handleDelete(file)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
