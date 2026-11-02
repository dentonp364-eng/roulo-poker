-- Roulo Poker: admin-only tournament deletion.
-- Run this in Supabase SQL Editor. Deleting an event also removes its
-- tournament tables, seats and hand state. Active hands are protected.

create or replace function public.admin_delete_poker_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_ids uuid[];
  v_name text;
begin
  if auth.uid() is null or not public.is_poker_admin() then
    raise exception 'Only a Roulo Poker administrator can delete tournaments';
  end if;

  select t.name into v_name
  from public.poker_tournaments t
  where t.id=p_tournament_id
  for update;

  if v_name is null then
    raise exception 'Tournament not found';
  end if;

  select coalesce(array_agg(tt.table_id), array[]::uuid[])
  into v_table_ids
  from public.poker_tournament_tables tt
  where tt.tournament_id=p_tournament_id;

  if exists (
    select 1 from public.poker_hand_state hs
    where hs.table_id = any(v_table_ids)
      and hs.phase not in ('waiting','showdown')
  ) then
    raise exception 'This tournament cannot be deleted while a hand is in progress. Wait until all tables are idle and try again.';
  end if;

  delete from public.poker_tournaments where id=p_tournament_id;
  delete from public.poker_tables where id=any(v_table_ids);

  return jsonb_build_object('deleted',true,'tournament_name',v_name);
end;
$$;

revoke all on function public.admin_delete_poker_tournament(uuid) from public, anon;
grant execute on function public.admin_delete_poker_tournament(uuid) to authenticated;
