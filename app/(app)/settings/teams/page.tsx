'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { PermissionGate } from '@/components/permission-gate';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase/client';
import { Loader2, Plus, Network, Trash2, Pencil, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Team } from '@/lib/types';

interface TeamWithMembers extends Team {
  member_count: number;
  members: { user_id: string; full_name: string; role: string }[];
}

export default function TeamsSettingsPage() {
  return (
    <PermissionGate permission="manage_teams">
      <TeamsSettings />
    </PermissionGate>
  );
}

function TeamsSettings() {
  const { profile } = useAuth();
  const [teams, setTeams] = useState<TeamWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<Team | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const loadTeams = useCallback(async () => {
    if (!profile) return;
    setLoading(true);

    const { data: teamsData, error: teamsError } = await supabase
      .from('teams')
      .select('*')
      .eq('company_id', profile.company_id)
      .order('created_at');

    if (teamsError) {
      setError(teamsError.message);
      setLoading(false);
      return;
    }

    const teamsWithMembers = await Promise.all(
      (teamsData ?? []).map(async (team) => {
        const { data: members } = await supabase
          .from('team_members')
          .select('user_id, role, profiles!inner(full_name)')
          .eq('team_id', team.id);

        return {
          ...team,
          member_count: members?.length ?? 0,
          members: (members ?? []).map((m: any) => ({
            user_id: m.user_id,
            full_name: m.profiles?.full_name ?? 'Unknown',
            role: m.role,
          })),
        };
      }),
    );

    setTeams(teamsWithMembers);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError(null);

    try {
      if (editTeam) {
        const { error: updateError } = await supabase
          .from('teams')
          .update({ name: teamName, description: teamDescription || null })
          .eq('id', editTeam.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('teams')
          .insert({
            company_id: profile.company_id,
            name: teamName,
            description: teamDescription || null,
          });
        if (insertError) throw insertError;
      }

      setDialogOpen(false);
      setEditTeam(null);
      setTeamName('');
      setTeamDescription('');
      await loadTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (teamId: string) => {
    if (!confirm('Delete this team? This will remove all team member assignments.')) return;
    const { error: deleteError } = await supabase.from('teams').delete().eq('id', teamId);
    if (deleteError) {
      setError(deleteError.message);
    } else {
      await loadTeams();
    }
  };

  const openEdit = (team: Team) => {
    setEditTeam(team);
    setTeamName(team.name);
    setTeamDescription(team.description ?? '');
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditTeam(null);
    setTeamName('');
    setTeamDescription('');
    setDialogOpen(true);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Teams</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage teams within your company.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New Team
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editTeam ? 'Edit team' : 'Create a new team'}</DialogTitle>
              <DialogDescription>
                {editTeam ? 'Update team details.' : 'Add a new team to organize your users.'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="teamName">Team Name</Label>
                <Input id="teamName" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teamDescription">Description (optional)</Label>
                <Input id="teamDescription" value={teamDescription} onChange={(e) => setTeamDescription(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {editTeam ? 'Save changes' : 'Create team'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Network className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No teams yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <Card key={team.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium">{team.name}</h3>
                    {team.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{team.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(team)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(team.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {team.member_count} member{team.member_count !== 1 ? 's' : ''}
                  </Badge>
                </div>
                {team.members.length > 0 && (
                  <div className="space-y-1">
                    {team.members.map((m) => (
                      <div key={m.user_id} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{m.full_name}</span>
                        {m.role === 'lead' && <Badge variant="outline" className="text-xs">Lead</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
