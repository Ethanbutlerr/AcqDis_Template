'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDate, formatRelativeTime } from '@/lib/utils/format';
import { logActivity } from '@/lib/utils/activity';
import { Task, TaskComment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { TASK_STATUSES, TASK_PRIORITIES } from '@/lib/types';
import {
  Plus, ListTodo, Calendar as CalendarIcon, Flag, Send, Trash2, Clock, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  completed: 'Completed',
  canceled: 'Canceled',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/20 text-blue-600',
  medium: 'bg-yellow-500/20 text-yellow-600',
  high: 'bg-orange-500/20 text-orange-600',
  urgent: 'bg-red-500/20 text-red-600',
};

type ViewKey = 'all' | 'my' | 'team' | 'today' | 'overdue' | 'upcoming' | 'completed';

export default function TasksPage() {
  const { user, profile } = useAuth();
  const companyId = profile?.company_id;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [activeView, setActiveView] = useState<ViewKey>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date());

  const loadTasks = useCallback(async () => {
    if (!companyId || !user) return;
    setLoading(true);

    let query = supabase.from('tasks').select('*').eq('company_id', companyId);

    const today = new Date().toISOString().split('T')[0];

    switch (activeView) {
      case 'my':
        query = query.eq('assigned_user_id', user.id);
        break;
      case 'team':
        query = query.not('assigned_team_id', 'is', null);
        break;
      case 'today':
        query = query.eq('due_date', today).neq('status', 'completed');
        break;
      case 'overdue':
        query = query.lt('due_date', today).neq('status', 'completed');
        break;
      case 'upcoming':
        query = query.gt('due_date', today).neq('status', 'completed');
        break;
      case 'completed':
        query = query.eq('status', 'completed');
        break;
    }

    query = query.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    const { data } = await query;
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  }, [companyId, user, activeView]);

  const loadMetadata = useCallback(async () => {
    if (!companyId) return;
    const [usersRes, teamsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId),
      supabase.from('teams').select('id, name').eq('company_id', companyId),
    ]);
    setUsers((usersRes.data ?? []) as { id: string; full_name: string }[]);
    setTeams((teamsRes.data ?? []) as { id: string; name: string }[]);
  }, [companyId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const toggleStatus = async (task: Task) => {
    const newStatus = task.status === 'completed' ? 'open' : 'completed';
    const updates: Partial<Task> = { status: newStatus };
    if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
    else updates.completed_at = null;

    await supabase.from('tasks').update(updates).eq('id', task.id);
    if (newStatus === 'completed') {
      await logActivity({ companyId: companyId!, actorId: user?.id, entityType: 'task', entityId: task.id, eventType: 'task_completed' });
    }
    loadTasks();
  };

  const tasksByDate = tasks.reduce<Record<string, Task[]>>((acc, t) => {
    if (t.due_date) {
      (acc[t.due_date] ??= []).push(t);
    }
    return acc;
  }, {});

  return (
    <div className="space-y-4 p-6 animate-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} tasks</p>
        </div>
        <div className="flex gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'calendar')}>
            <TabsList>
              <TabsTrigger value="list" className="gap-1.5"><ListTodo className="h-3.5 w-3.5" /> List</TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5"><CalendarIcon className="h-3.5 w-3.5" /> Calendar</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Task
          </Button>
        </div>
      </div>

      {/* View filters */}
      <div className="flex flex-wrap gap-2">
        {([
          ['all', 'All Tasks'],
          ['my', 'My Tasks'],
          ['team', 'Team Tasks'],
          ['today', 'Due Today'],
          ['overdue', 'Overdue'],
          ['upcoming', 'Upcoming'],
          ['completed', 'Completed'],
        ] as [ViewKey, string][]).map(([key, label]) => (
          <Button
            key={key}
            variant={activeView === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveView(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {view === 'list' ? (
        <div className="space-y-2">
          {loading ? (
            <p className="text-center py-12 text-muted-foreground">Loading...</p>
          ) : tasks.length === 0 ? (
            <p className="text-center py-12 text-muted-foreground">No tasks found.</p>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/30 transition-colors cursor-pointer',
                  task.status === 'completed' && 'opacity-60'
                )}
                onClick={() => setEditingTask(task)}
              >
                <Checkbox
                  checked={task.status === 'completed'}
                  onCheckedChange={() => toggleStatus(task)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm font-medium', task.status === 'completed' && 'line-through')}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                  )}
                </div>
                <Badge variant="secondary" className="text-xs">{STATUS_LABELS[task.status]}</Badge>
                <Badge className={cn('text-xs', PRIORITY_COLORS[task.priority])}>
                  <Flag className="h-2.5 w-2.5 mr-1" />
                  {task.priority}
                </Badge>
                {task.due_date && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDate(task.due_date)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex gap-6">
          <div className="flex-1">
            <Calendar
              mode="single"
              selected={calendarDate}
              onSelect={setCalendarDate}
              className="rounded-lg border"
            />
          </div>
          <div className="w-80 space-y-2">
            <h3 className="text-sm font-semibold">
              {calendarDate ? formatDate(calendarDate.toISOString()) : 'Select a date'}
            </h3>
            {((calendarDate ? tasksByDate[calendarDate.toISOString().split('T')[0]] ?? [] : []) as Task[]).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No tasks on this day.</p>
            ) : (
              (calendarDate ? tasksByDate[calendarDate.toISOString().split('T')[0]] ?? [] : []).map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border p-3 cursor-pointer hover:bg-accent/30"
                  onClick={() => setEditingTask(task)}
                >
                  <p className="text-sm font-medium">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-xs">{STATUS_LABELS[task.status]}</Badge>
                    {task.due_time && <span className="text-xs text-muted-foreground">{task.due_time}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Task Dialog */}
      {showCreate && companyId && (
        <CreateTaskDialog
          companyId={companyId}
          userId={user?.id ?? null}
          users={users}
          teams={teams}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadTasks(); }}
        />
      )}

      {/* Task Detail Sheet */}
      {editingTask && companyId && (
        <TaskDetailSheet
          task={editingTask}
          companyId={companyId}
          userId={user?.id ?? null}
          users={users}
          teams={teams}
          onClose={() => setEditingTask(null)}
          onUpdated={loadTasks}
        />
      )}
    </div>
  );
}

function CreateTaskDialog({
  companyId,
  userId,
  users,
  teams,
  onClose,
  onCreated,
}: {
  companyId: string;
  userId: string | null;
  users: { id: string; full_name: string }[];
  teams: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('medium');
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [assignedTeamId, setAssignedTeamId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { data } = await supabase.from('tasks').insert({
      company_id: companyId,
      title: title.trim(),
      description: description || null,
      status,
      priority,
      assigned_user_id: assignedUserId,
      assigned_team_id: assignedTeamId,
      due_date: dueDate || null,
      due_time: dueTime || null,
      recurrence_rule: recurrence || null,
      created_by: userId,
    }).select().single();

    if (data) {
      await logActivity({ companyId, actorId: userId, entityType: 'task', entityId: data.id, eventType: 'task_created' });
    }
    onCreated();
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned User</Label>
              <Select value={assignedUserId ?? 'unassigned'} onValueChange={(v) => setAssignedUserId(v === 'unassigned' ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team</Label>
              <Select value={assignedTeamId ?? 'none'} onValueChange={(v) => setAssignedTeamId(v === 'none' ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due Time</Label>
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Recurrence (e.g. daily, weekly, monthly)</Label>
            <Input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="e.g. weekly" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={create} disabled={saving || !title.trim()}>Create Task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailSheet({
  task,
  companyId,
  userId,
  users,
  teams,
  onClose,
  onUpdated,
}: {
  task: Task;
  companyId: string;
  userId: string | null;
  users: { id: string; full_name: string }[];
  teams: { id: string; name: string }[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [editedTask, setEditedTask] = useState<Task>(task);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentAuthors, setCommentAuthors] = useState<Record<string, string>>({});

  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', task.id)
      .order('created_at', { ascending: false });
    setComments((data ?? []) as TaskComment[]);

    const authorIds = Array.from(new Set((data ?? []).map((c: TaskComment) => c.author_id).filter(Boolean))) as string[];
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', authorIds);
      const names: Record<string, string> = {};
      (profiles ?? []).forEach((p: { id: string; full_name: string }) => { names[p.id] = p.full_name; });
      setCommentAuthors(names);
    }
  }, [task.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const updateField = async (field: string, value: unknown) => {
    const updates = { [field]: value };
    await supabase.from('tasks').update(updates).eq('id', task.id);
    setEditedTask({ ...editedTask, [field]: value });
    onUpdated();
  };

  const addComment = async () => {
    if (!newComment.trim() || !userId) return;
    const { data } = await supabase.from('task_comments').insert({
      task_id: task.id,
      author_id: userId,
      body: newComment.trim(),
    }).select().single();
    if (data) {
      setComments([data as TaskComment, ...comments]);
      setCommentAuthors({ ...commentAuthors, [userId]: users.find((u) => u.id === userId)?.full_name ?? 'You' });
    }
    setNewComment('');
  };

  const deleteComment = async (id: string) => {
    await supabase.from('task_comments').delete().eq('id', id);
    setComments(comments.filter((c) => c.id !== id));
  };

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editedTask.title}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={editedTask.status} onValueChange={(v) => updateField('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select value={editedTask.priority} onValueChange={(v) => updateField('priority', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              defaultValue={editedTask.title}
              onBlur={(e) => updateField('title', e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              defaultValue={editedTask.description ?? ''}
              onBlur={(e) => updateField('description', e.target.value || null)}
              className="min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned User</Label>
              <Select
                value={editedTask.assigned_user_id ?? 'unassigned'}
                onValueChange={(v) => {
                  const userId = v === 'unassigned' ? null : v;
                  updateField('assigned_user_id', userId);
                  if (userId) logActivity({ companyId, actorId: userId, entityType: 'task', entityId: task.id, eventType: 'assignment_changed' });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team</Label>
              <Select
                value={editedTask.assigned_team_id ?? 'none'}
                onValueChange={(v) => updateField('assigned_team_id', v === 'none' ? null : v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Due Date</Label>
              <Input
                type="date"
                defaultValue={editedTask.due_date ?? ''}
                onBlur={(e) => updateField('due_date', e.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Due Time</Label>
              <Input
                type="time"
                defaultValue={editedTask.due_time ?? ''}
                onBlur={(e) => updateField('due_time', e.target.value || null)}
              />
            </div>
          </div>

          {editedTask.completed_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Completed {formatRelativeTime(editedTask.completed_at)}
            </div>
          )}

          {/* Comments */}
          <div className="space-y-3 pt-4 border-t">
            <h4 className="text-sm font-semibold">Comments</h4>
            <div className="flex gap-2">
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="min-h-[50px] resize-none"
              />
              <Button size="icon" className="shrink-0" onClick={addComment} disabled={!newComment.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">{commentAuthors[c.author_id ?? ''] ?? 'Someone'}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted-foreground">{formatRelativeTime(c.created_at)}</p>
                    {c.author_id === userId && (
                      <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => deleteComment(c.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
