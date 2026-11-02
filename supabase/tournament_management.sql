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
  if v_t.owner_id <> v_user and not public.is_poker_admin() and not exists (
    select 1 from public.poker_tournament_entries e where e.tournament_id=p_tournament_id and e.player_id=v_user
  ) then
    raise exception 'Only a tournament participant, host or administrator can advance tournament levels';
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
    'my_table_id',(select e.table_id from public.poker_tournament_entries e where e.tournament_id=t.id and e.player_id=auth.uid()),
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


-- Keep tournament table mappings complete before registering a player.
create or replace function public.register_poker_tournament(p_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_t public.poker_tournaments%rowtype;
  v_table_id uuid;
  v_seat integer;
  v_existing public.poker_tournament_entries%rowtype;
  v_table public.poker_tables%rowtype;
  i integer;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_t from public.poker_tournaments where id=p_tournament_id for update;
  if not found then raise exception 'Tournament not found'; end if;

  select * into v_existing from public.poker_tournament_entries
  where tournament_id=p_tournament_id and player_id=v_user;
  if found then
    return jsonb_build_object('registered',true,'table_id',v_existing.table_id,'seat_number',v_existing.seat_number);
  end if;

  if v_t.status <> 'registration' then raise exception 'Tournament registration is closed'; end if;
  if (select count(*) from public.poker_tournament_entries where tournament_id=p_tournament_id) >= v_t.table_count*v_t.players_per_table then
    raise exception 'This tournament is full';
  end if;

  insert into public.player_profiles(id,discord_name,chips)
  values(v_user,'Poker Player',v_t.starting_chips)
  on conflict(id) do nothing;

  -- Older/partially-created tournaments may have no mapping rows. Rebuild only
  -- missing table numbers; existing tables and player seats are left untouched.
  for i in 1..v_t.table_count loop
    if not exists (
      select 1 from public.poker_tournament_tables pt
      where pt.tournament_id=p_tournament_id and pt.table_number=i
    ) then
      insert into public.poker_tables(name,owner_id,small_blind,big_blind,max_players,is_private,status,invite_code)
      values(v_t.name || ' · Table ' || i,v_t.owner_id,v_t.small_blind,v_t.big_blind,v_t.players_per_table,false,'waiting',null)
      returning * into v_table;
      insert into public.poker_tournament_tables(tournament_id,table_id,table_number)
      values(p_tournament_id,v_table.id,i);
    end if;
  end loop;

  select pt.table_id into v_table_id
  from public.poker_tournament_tables pt
  where pt.tournament_id=p_tournament_id
  order by (select count(*) from public.poker_seats s where s.table_id=pt.table_id),pt.table_number
  limit 1
  for update;

  if v_table_id is null then
    raise exception 'Tournament tables could not be prepared. Please contact the administrator.';
  end if;

  select min(n) into v_seat
  from generate_series(1,v_t.players_per_table) n
  where not exists(select 1 from public.poker_seats s where s.table_id=v_table_id and s.seat_number=n);
  if v_seat is null then raise exception 'No available tournament seat was found'; end if;

  insert into public.poker_seats(table_id,player_id,seat_number,chips)
  values(v_table_id,v_user,v_seat,v_t.starting_chips);
  insert into public.poker_tournament_entries(tournament_id,player_id,table_id,seat_number)
  values(p_tournament_id,v_user,v_table_id,v_seat);

  return jsonb_build_object('registered',true,'table_id',v_table_id,'seat_number',v_seat);
end;
$$;
revoke all on function public.register_poker_tournament(uuid) from public;
grant execute on function public.register_poker_tournament(uuid) to authenticated;

-- Admin-only bridge for the temporary test-player flow. A test player joins
-- the poker table using its own anonymous session; the admin session then
-- records that seated player in the matching tournament.
create or replace function public.admin_register_tournament_test_player(p_table_id uuid,p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
  v_seat integer;
  v_chips bigint;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;

  if not exists (
    select 1 from auth.users u
    where u.id=p_player_id
      and coalesce(u.is_anonymous,false)=true
      and coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','')='Roulo Test Player'
  ) then
    raise exception 'Player is not a recognized temporary test player';
  end if;

  select pt.tournament_id into v_tournament_id
  from public.poker_tournament_tables pt
  where pt.table_id=p_table_id
  limit 1;

  if v_tournament_id is null then
    return jsonb_build_object('registered',false,'tournament_table',false);
  end if;

  select s.seat_number,s.chips into v_seat,v_chips
  from public.poker_seats s
  where s.table_id=p_table_id and s.player_id=p_player_id;

  if v_seat is null then raise exception 'Temporary test player is not seated at this tournament table'; end if;

  insert into public.poker_tournament_entries(tournament_id,player_id,table_id,seat_number)
  values(v_tournament_id,p_player_id,p_table_id,v_seat)
  on conflict(tournament_id,player_id) do update
    set table_id=excluded.table_id,seat_number=excluded.seat_number;

  return jsonb_build_object('registered',true,'tournament_id',v_tournament_id,
    'table_id',p_table_id,'seat_number',v_seat,'chips',v_chips);
end;
$$;

revoke all on function public.admin_register_tournament_test_player(uuid,uuid) from public;
grant execute on function public.admin_register_tournament_test_player(uuid,uuid) to authenticated;

-- Tournament elimination tracking. A player is eliminated only after a hand
-- has fully settled and their remaining chip stack is zero.
alter table public.poker_tournament_entries
  add column if not exists eliminated_at timestamptz,
  add column if not exists finish_position integer;

alter table public.poker_tournaments
  add column if not exists completed_at timestamptz;

create or replace function public.record_poker_tournament_eliminations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
  v_remaining integer;
  v_finish_position integer;
  v_winner uuid;
begin
  if new.phase <> 'showdown' or old.phase = 'showdown' then
    return new;
  end if;

  select pt.tournament_id into v_tournament_id
  from public.poker_tournament_tables pt
  join public.poker_tournaments t on t.id=pt.tournament_id
  where pt.table_id=new.table_id and t.status='running'
  limit 1;

  if v_tournament_id is null then
    return new;
  end if;

  -- The hand engine has already awarded the pot before it changes the phase
  -- to showdown, so zero stacks here are genuine tournament eliminations.
  select count(*) into v_remaining
  from public.poker_tournament_entries e
  join public.poker_seats s on s.table_id=e.table_id and s.player_id=e.player_id
  where e.tournament_id=v_tournament_id
    and e.eliminated_at is null
    and s.chips > 0;

  v_finish_position := v_remaining + 1;

  update public.poker_tournament_entries e
  set eliminated_at=now(),finish_position=v_finish_position
  from public.poker_seats s
  where e.tournament_id=v_tournament_id
    and e.table_id=new.table_id
    and e.player_id=s.player_id
    and s.table_id=new.table_id
    and s.chips <= 0
    and e.eliminated_at is null;

  -- If one player remains, close the event and mark the champion first.
  select e.player_id into v_winner
  from public.poker_tournament_entries e
  join public.poker_seats s on s.table_id=e.table_id and s.player_id=e.player_id
  where e.tournament_id=v_tournament_id
    and e.eliminated_at is null
    and s.chips > 0
  limit 1;

  select count(*) into v_remaining
  from public.poker_tournament_entries e
  where e.tournament_id=v_tournament_id and e.eliminated_at is null;

  if v_remaining = 1 and v_winner is not null then
    update public.poker_tournament_entries
    set finish_position=1
    where tournament_id=v_tournament_id and player_id=v_winner;
    update public.poker_tournaments
    set status='completed',completed_at=now()
    where id=v_tournament_id and status='running';
  end if;

  return new;
end;
$$;

drop trigger if exists poker_tournament_elimination_after_hand on public.poker_hand_state;
create trigger poker_tournament_elimination_after_hand
after update of phase on public.poker_hand_state
for each row
when (new.phase='showdown' and old.phase is distinct from new.phase)
execute function public.record_poker_tournament_eliminations();

revoke all on function public.record_poker_tournament_eliminations() from public;
