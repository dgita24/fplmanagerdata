/**
 * CRUD helpers for private-lab named manager sets.
 *
 * All operations use the service-role client (bypasses RLS).
 * NEVER import this from public/browser code.
 */

import { getServiceClient } from './supabase-service.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ManagerGroup {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  season: string | null;
  manager_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  active_group_id: string | null;
  updated_at: string;
}

// ── Group management ──────────────────────────────────────────────────────────

/**
 * Create or replace a named manager group for the given user.
 * If a group with the same (user_id, name) already exists, it is updated.
 */
export async function upsertManagerGroup(
  userId: string,
  name: string,
  managerIds: number[],
  opts: { description?: string; season?: string } = {},
): Promise<ManagerGroup> {
  const supabase = getServiceClient();

  // Check for existing group
  const { data: existing } = await supabase
    .from('analysis_manager_groups')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('analysis_manager_groups')
      .update({
        manager_ids: managerIds,
        description: opts.description ?? null,
        season: opts.season ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update manager group "${name}": ${error.message}`);
    return data as ManagerGroup;
  } else {
    const { data, error } = await supabase
      .from('analysis_manager_groups')
      .insert({
        user_id: userId,
        name,
        manager_ids: managerIds,
        description: opts.description ?? null,
        season: opts.season ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create manager group "${name}": ${error.message}`);
    return data as ManagerGroup;
  }
}

/**
 * List all manager groups for the given user.
 */
export async function listManagerGroups(userId: string): Promise<ManagerGroup[]> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('analysis_manager_groups')
    .select('*')
    .eq('user_id', userId)
    .order('name');

  if (error) throw new Error(`Failed to list manager groups: ${error.message}`);
  return (data ?? []) as ManagerGroup[];
}

/**
 * Get a single manager group by user + name.
 * Returns null if not found.
 */
export async function getManagerGroup(
  userId: string,
  name: string,
): Promise<ManagerGroup | null> {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('analysis_manager_groups')
    .select('*')
    .eq('user_id', userId)
    .eq('name', name)
    .maybeSingle();

  if (error) throw new Error(`Failed to get manager group "${name}": ${error.message}`);
  return (data as ManagerGroup | null) ?? null;
}

/**
 * Delete a manager group by user + name.
 */
export async function deleteManagerGroup(userId: string, name: string): Promise<void> {
  const supabase = getServiceClient();

  const { error } = await supabase
    .from('analysis_manager_groups')
    .delete()
    .eq('user_id', userId)
    .eq('name', name);

  if (error) throw new Error(`Failed to delete manager group "${name}": ${error.message}`);
}

// ── Active set management ─────────────────────────────────────────────────────

/**
 * Mark a named group as the active set for the given user.
 * Any subsequent script call without an explicit --set slug will use this group.
 */
export async function setActiveGroup(userId: string, name: string): Promise<void> {
  const group = await getManagerGroup(userId, name);
  if (!group) throw new Error(`Manager group "${name}" not found for user ${userId}`);

  const supabase = getServiceClient();

  const { error } = await supabase
    .from('analysis_user_settings')
    .upsert(
      {
        user_id: userId,
        active_group_id: group.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) throw new Error(`Failed to set active group: ${error.message}`);
}

/**
 * Resolve the active group for a user.
 * If setSlug is provided, look up that specific group; otherwise fall back to
 * the group marked active in analysis_user_settings.
 */
export async function resolveActiveGroup(
  userId: string,
  setSlug?: string,
): Promise<ManagerGroup> {
  if (setSlug) {
    const group = await getManagerGroup(userId, setSlug);
    if (!group) throw new Error(`Manager group "${setSlug}" not found for user ${userId}`);
    return group;
  }

  const supabase = getServiceClient();

  const { data: settings, error: settingsError } = await supabase
    .from('analysis_user_settings')
    .select('active_group_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (settingsError) throw new Error(`Failed to read user settings: ${settingsError.message}`);

  if (!settings?.active_group_id) {
    throw new Error(
      `No active group set for user ${userId}. ` +
        'Run set-active-set.ts to mark a group as active, or pass --set=<name>.',
    );
  }

  const { data: group, error: groupError } = await supabase
    .from('analysis_manager_groups')
    .select('*')
    .eq('id', settings.active_group_id)
    .single();

  if (groupError) throw new Error(`Failed to load active group: ${groupError.message}`);
  return group as ManagerGroup;
}
