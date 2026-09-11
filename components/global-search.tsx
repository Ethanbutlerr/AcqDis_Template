'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { Search, User, Building2, Target, TrendingUp, TrendingDown, X } from 'lucide-react';
import type { GlobalSearchResult } from '@/lib/types';

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  contact: User, property: Building2, opportunity: Target,
  acquisition: TrendingUp, disposition: TrendingDown,
};
const TYPE_LABELS: Record<string, string> = {
  contact: 'Contacts', property: 'Properties', opportunity: 'Opportunities',
  acquisition: 'Acquisitions', disposition: 'Dispositions',
};

export function GlobalSearch() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!companyId || q.length < 2) { setResults([]); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc('global_search', { p_company_id: companyId, p_query: q, p_limit: 10 });
    if (!error && data) {
      setResults(data as GlobalSearchResult[]);
    }
    setLoading(false);
  }, [companyId]);

  const onQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const navigate = (href: string) => {
    router.push(href);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const grouped = results.reduce<Record<string, GlobalSearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && results[0]) navigate(results[0].href); }}
        placeholder="Search contacts, properties, deals... (Ctrl+K)"
        className="w-full rounded-md border border-input bg-background px-9 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {query && (
        <button onClick={() => { setQuery(''); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (query.length >= 2) && (
        <div className="absolute top-full mt-1 w-full rounded-md border bg-popover shadow-lg z-50 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground text-center">Searching...</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No results found</div>
          ) : (
            <div className="p-2">
              {Object.entries(grouped).map(([type, items]) => {
                const Icon = TYPE_ICONS[type] ?? Search;
                return (
                  <div key={type} className="mb-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 mb-1">{TYPE_LABELS[type] ?? type}</p>
                    {items.map((r) => (
                      <button
                        key={`${r.type}-${r.id}`}
                        onClick={() => navigate(r.href)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
                      >
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{r.label}</p>
                          {r.sub && <p className="text-xs text-muted-foreground truncate">{r.sub}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
