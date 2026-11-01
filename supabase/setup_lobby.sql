-- Roulo Poker lobby RPCs
-- Run this file in Supabase SQL Editor after the initial table setup.

alter table public.poker_tables
  add column if not exists invite_code text unique;

create or replace function public.create_poker_table(
  p_name text,
  p_small_blind bigint default 10,
  p_big_blind bigint default 20,
  p_max_players integer default 6,
  p_is_private boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_table public.poker_tables%rowtype;
  v_code text;
  v_name text;
begin
  if v_user is null then
    raise exception 'You must sign in first';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null or length(v_name) > 40 then
    raise exception 'Table name must be between 1 and 40 characters';
  end if;
  if p_small_blind < 1 or p_big_blind < p_small_blind then
    raise exception 'Invalid blind amounts';
  end if;
  if p_max_players < 2 or p_max_players > 9 then
    raise exception 'Tables must have 2 to 9 seats';
  end if;

  insert into public.player_profiles(id, discord_name, chips)
  values (v_user, 'Poker Player', 1000)
  on conflict (id) do nothing;

  if p_is_private then
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  insert into public.poker_tables(
    name, owner_id, small_blind, big_blind, max_players, is_private, invite_code
  )
  values (
    v_name, v_user, p_small_blind, p_big_blind, p_max_players, p_is_private, v_code
  )
  returning * into v_table;

  insert into public.poker_seats(table_id, player_id, seat_number, chips)
  values (v_table.id, v_user, 1, 1000);

  return jsonb_build_object(
    'table_id', v_table.id,
    'invite_code', v_code
  );
end;
$$;

create or replace function public.join_poker_table(
  p_table_id uuid,
  p_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_table public.poker_tables%rowtype;
  v_seat integer;
  v_chips bigint;
begin
  if v_user is null then
    raise exception 'You must sign in first';
  end if;

  select * into v_table
  from public.poker_tables
  where id = p_table_id
  for update;

  if not found or v_table.status <> 'waiting' then
    raise exception 'This table is not available';
  end if;

  if v_table.is_private and
     (p_invite_code is null or upper(p_invite_code) <> v_table.invite_code) then
    raise exception 'A valid invite code is required';
  end if;

  if exists (
    select 1 from public.poker_seats
    where table_id = p_table_id and player_id = v_user
  ) then
    return jsonb_build_object('joined', true);
  end if;

  select coalesce(sum(chips), 1000) into v_chips
  from public.player_profiles where id = v_user;

  if v_chips <= 0 then
    raise exception 'You have no virtual chips available';
  end if;

  select min(n) into v_seat
  from generate_series(1, v_table.max_players) n
  where not exists (
    select 1 from public.poker_seats s
    where s.table_id = p_table_id and s.seat_number = n
  );

  if v_seat is null then
    raise exception 'This table is full';
  end if;

  insert into public.player_profiles(id, discord_name, chips)
  values (v_user, 'Poker Player', 1000)
  on conflict (id) do nothing;

  insert into public.poker_seats(table_id, player_id, seat_number, chips)
  values (p_table_id, v_user, v_seat, v_chips);

  return jsonb_build_object('joined', true, 'seat_number', v_seat);
end;
$$;

revoke all on function public.create_poker_table(text,bigint,bigint,integer,boolean) from public;
revoke all on function public.join_poker_table(uuid,text) from public;
grant execute on function public.create_poker_table(text,bigint,bigint,integer,boolean) to authenticated;
grant execute on function public.join_poker_table(uuid,text) to authenticated;
