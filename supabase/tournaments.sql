-- Roulo Poker multi-table tournament foundation
-- Run once in Supabase SQL Editor after setup_lobby.sql and poker_engine.sql.

create table if not exists public.poker_tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references auth.users(id) on delete cascade,
  table_count integer not null check (table_count between 1 and 10),
  players_per_table integer not null check (players_per_table between 2 and 9),
  starting_chips bigint not null check (starting_chips > 0),
  small_blind bigint not null check (small_blind > 0),
  big_blind bigint not null check (big_blind > small_blind),
  blind_interval_minutes integer not null check (blind_interval_minutes between 5 and 60),
  status text not null default 'registration' check (status in ('registration','running','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.poker_tournament_tables (
  tournament_id uuid not null references public.poker_tournaments(id) on delete cascade,
  table_id uuid not null unique references public.poker_tables(id) on delete cascade,
  table_number integer not null,
  primary key (tournament_id, table_number)
);

create table if not exists public.poker_tournament_entries (
  tournament_id uuid not null references public.poker_tournaments(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  seat_number integer not null,
  registered_at timestamptz not null default now(),
  primary key (tournament_id, player_id),
  unique (table_id, seat_number)
);

alter table public.poker_tournaments enable row level security;
alter table public.poker_tournament_tables enable row level security;
alter table public.poker_tournament_entries enable row level security;
revoke all on public.poker_tournaments, public.poker_tournament_tables, public.poker_tournament_entries from anon, authenticated;

create or replace function public.create_poker_tournament(
  p_name text,
  p_table_count integer default 1,
  p_players_per_table integer default 9,
  p_starting_chips bigint default 10000,
  p_small_blind bigint default 25,
  p_big_blind bigint default 50,
  p_blind_interval_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(trim(p_name),'');
  v_tournament public.poker_tournaments%rowtype;
  v_table public.poker_tables%rowtype;
  i integer;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  if v_name is null or char_length(v_name)>60 then raise exception 'Tournament name must be 1 to 60 characters'; end if;
  if p_table_count not between 1 and 10 then raise exception 'Choose between 1 and 10 tables'; end if;
  if p_players_per_table not between 2 and 9 then raise exception 'Each table must have 2 to 9 seats'; end if;
  if p_starting_chips <= 0 or p_small_blind <= 0 or p_big_blind <= p_small_blind then raise exception 'Check the starting chips and blind amounts'; end if;
  if p_blind_interval_minutes not between 5 and 60 then raise exception 'Blind interval must be between 5 and 60 minutes'; end if;

  insert into public.poker_tournaments(name,owner_id,table_count,players_per_table,starting_chips,small_blind,big_blind,blind_interval_minutes)
  values(v_name,v_user,p_table_count,p_players_per_table,p_starting_chips,p_small_blind,p_big_blind,p_blind_interval_minutes)
  returning * into v_tournament;

  for i in 1..p_table_count loop
    insert into public.poker_tables(name,owner_id,small_blind,big_blind,max_players,is_private,status,invite_code)
    values(v_name || ' · Table ' || i,v_user,p_small_blind,p_big_blind,p_players_per_table,true,'waiting',
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)))
    returning * into v_table;
    insert into public.poker_tournament_tables(tournament_id,table_id,table_number)
    values(v_tournament.id,v_table.id,i);
  end loop;

  return jsonb_build_object('tournament_id',v_tournament.id,'table_count',p_table_count,
    'players_per_table',p_players_per_table,'capacity',p_table_count*p_players_per_table);
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
    'blind_interval_minutes',t.blind_interval_minutes,'status',t.status,'created_at',t.created_at,
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
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_t from public.poker_tournaments where id=p_tournament_id for update;
  if not found or v_t.status <> 'registration' then raise exception 'Tournament registration is closed'; end if;

  select * into v_existing from public.poker_tournament_entries
  where tournament_id=p_tournament_id and player_id=v_user;
  if found then
    return jsonb_build_object('registered',true,'table_id',v_existing.table_id,'seat_number',v_existing.seat_number);
  end if;

  if (select count(*) from public.poker_tournament_entries where tournament_id=p_tournament_id) >= v_t.table_count*v_t.players_per_table then
    raise exception 'This tournament is full';
  end if;

  insert into public.player_profiles(id,discord_name,chips)
  values(v_user,'Poker Player',v_t.starting_chips)
  on conflict(id) do nothing;

  select pt.table_id into v_table_id
  from public.poker_tournament_tables pt
  where pt.tournament_id=p_tournament_id
  order by (select count(*) from public.poker_seats s where s.table_id=pt.table_id),pt.table_number
  limit 1
  for update;

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

revoke all on function public.create_poker_tournament(text,integer,integer,bigint,bigint,bigint,integer) from public;
revoke all on function public.list_poker_tournaments() from public;
revoke all on function public.register_poker_tournament(uuid) from public;
grant execute on function public.create_poker_tournament(text,integer,integer,bigint,bigint,bigint,integer) to authenticated;
grant execute on function public.list_poker_tournaments() to authenticated;
grant execute on function public.register_poker_tournament(uuid) to authenticated;
