-- Roulo Poker tournament runtime: start events and advance blind levels.
-- Run once in Supabase SQL Editor after tournaments.sql.

alter table public.poker_tournaments
  add column if not exists started_at timestamptz,
  add column if not exists blind_level integer not null default 1;

create or replace function public.start_poker_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_t public.poker_tournaments%rowtype;
  v_players integer;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_t from public.poker_tournaments where id=p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if v_t.owner_id <> v_user and not public.is_poker_admin() then
    raise exception 'Only the tournament host or an administrator can start this event';
  end if;
  if v_t.status <> 'registration' then raise exception 'This tournament is not awaiting a start'; end if;

  select count(*) into v_players from public.poker_tournament_entries where tournament_id=p_tournament_id;
  if v_players < 2 then raise exception 'At least two registered players are required to start a tournament'; end if;

  update public.poker_tournaments
  set status='running',started_at=now(),blind_level=1
  where id=p_tournament_id;

  update public.poker_tables pt
  set small_blind=v_t.small_blind,big_blind=v_t.big_blind,status='waiting'
  where pt.id in (select table_id from public.poker_tournament_tables where tournament_id=p_tournament_id);

  return jsonb_build_object('started',true,'started_at',now(),'blind_level',1,
    'small_blind',v_t.small_blind,'big_blind',v_t.big_blind,'players',v_players);
end;
$$;

create or replace function public.advance_poker_tournament_blinds(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_t public.poker_tournaments%rowtype;
  v_level integer;
  v_small bigint;
  v_big bigint;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_t from public.poker_tournaments where id=p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;
  if v_t.owner_id <> v_user and not public.is_poker_admin() then
    raise exception 'Only the tournament host or an administrator can advance tournament levels';
  end if;
  if v_t.status <> 'running' or v_t.started_at is null then
    return jsonb_build_object('running',false,'status',v_t.status);
  end if;

  v_level := 1 + floor(extract(epoch from (now()-v_t.started_at))/(v_t.blind_interval_minutes*60))::integer;
  v_level := least(v_level,30);
  v_small := (v_t.small_blind::numeric * power(2::numeric,v_level-1))::bigint;
  v_big := (v_t.big_blind::numeric * power(2::numeric,v_level-1))::bigint;

  if v_level > v_t.blind_level then
    update public.poker_tournaments set blind_level=v_level where id=p_tournament_id;
    update public.poker_tables pt set small_blind=v_small,big_blind=v_big
    where pt.id in (select table_id from public.poker_tournament_tables where tournament_id=p_tournament_id);
  else
    v_small := (v_t.small_blind::numeric * power(2::numeric,v_t.blind_level-1))::bigint;
    v_big := (v_t.big_blind::numeric * power(2::numeric,v_t.blind_level-1))::bigint;
  end if;

  return jsonb_build_object('running',true,'blind_level',greatest(v_level,v_t.blind_level),
    'small_blind',v_small,'big_blind',v_big,'next_level_at',
    v_t.started_at + (greatest(v_level,v_t.blind_level)*v_t.blind_interval_minutes)*interval '1 minute');
end;
$$;

create or replace function public.list_poker_tournaments()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'name',t.name,'owner_id',t.owner_id,'table_count',t.table_count,
    'players_per_table',t.players_per_table,'starting_chips',t.starting_chips,
    'small_blind',t.small_blind,'big_blind',t.big_blind,
    'blind_interval_minutes',t.blind_interval_minutes,'status',t.status,
    'started_at',t.started_at,'blind_level',t.blind_level,'created_at',t.created_at,
    'players',(select count(*) from public.poker_tournament_entries e where e.tournament_id=t.id),
    'capacity',t.table_count*t.players_per_table,
    'tables',(select coalesce(jsonb_agg(jsonb_build_object(
      'table_id',pt.table_id,'table_number',pt.table_number,
      'seated',(select count(*) from public.poker_seats s where s.table_id=pt.table_id),
      'max_players',t.players_per_table
    ) order by pt.table_number),'[]'::jsonb) from public.poker_tournament_tables pt where pt.tournament_id=t.id)
  ) order by t.created_at desc),'[]'::jsonb)
  from public.poker_tournaments t
  where t.status in ('registration','running');
$$;

revoke all on function public.start_poker_tournament(uuid) from public;
revoke all on function public.advance_poker_tournament_blinds(uuid) from public;
revoke all on function public.list_poker_tournaments() from public;
grant execute on function public.start_poker_tournament(uuid) to authenticated;
grant execute on function public.advance_poker_tournament_blinds(uuid) to authenticated;
grant execute on function public.list_poker_tournaments() to authenticated;
