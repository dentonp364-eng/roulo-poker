-- Roulo Poker: player profiles, hand history and lifetime statistics.
-- Run once in Supabase SQL Editor after the existing lobby, poker engine and admin SQL.

alter table public.player_profiles
  add column if not exists bio text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.player_profiles
  drop constraint if exists player_profiles_bio_length;
alter table public.player_profiles
  add constraint player_profiles_bio_length check (char_length(bio) <= 240);

alter table public.player_profiles enable row level security;
drop policy if exists "Players can update their own profile" on public.player_profiles;
create policy "Players can update their own profile"
on public.player_profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Record the stack before blinds are posted. Hole cards are inserted before blind deductions.
alter table public.poker_hole_cards
  add column if not exists starting_chips bigint not null default 0;

create or replace function public.capture_poker_starting_stack()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.poker_hole_cards h
  set starting_chips = coalesce((
    select s.chips from public.poker_seats s
    where s.table_id = new.table_id and s.player_id = new.player_id
  ), 0)
  where h.table_id = new.table_id
    and h.hand_number = new.hand_number
    and h.player_id = new.player_id;
  return new;
end;
$$;

drop trigger if exists poker_capture_starting_stack on public.poker_hole_cards;
create trigger poker_capture_starting_stack
after insert on public.poker_hole_cards
for each row execute function public.capture_poker_starting_stack();

create table if not exists public.poker_hand_history (
  id bigint generated always as identity primary key,
  table_id uuid references public.poker_tables(id) on delete set null,
  table_name text not null,
  hand_number integer not null,
  board jsonb not null default '[]'::jsonb,
  pot bigint not null default 0,
  winner_ids uuid[] not null default '{}',
  completed_at timestamptz not null default now(),
  unique (table_id, hand_number)
);

create table if not exists public.poker_hand_history_players (
  id bigint generated always as identity primary key,
  hand_history_id bigint not null references public.poker_hand_history(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat_number integer not null,
  starting_chips bigint not null default 0,
  ending_chips bigint not null default 0,
  contribution bigint not null default 0,
  chips_won bigint not null default 0,
  net_result bigint not null default 0,
  folded boolean not null default false,
  is_winner boolean not null default false,
  hole_cards jsonb,
  unique (hand_history_id, user_id)
);

create index if not exists poker_hand_history_completed_idx
  on public.poker_hand_history(completed_at desc);
create index if not exists poker_hand_history_players_user_idx
  on public.poker_hand_history_players(user_id, hand_history_id desc);

alter table public.poker_hand_history enable row level security;
alter table public.poker_hand_history_players enable row level security;
revoke all on public.poker_hand_history from anon, authenticated;
revoke all on public.poker_hand_history_players from anon, authenticated;
grant select on public.poker_hand_history to authenticated;
grant select on public.poker_hand_history_players to authenticated;

drop policy if exists "Players can read hands they participated in" on public.poker_hand_history;
create policy "Players can read hands they participated in"
on public.poker_hand_history for select to authenticated
using (
  exists (
    select 1 from public.poker_hand_history_players hp
    where hp.hand_history_id = poker_hand_history.id and hp.user_id = auth.uid()
  )
  or public.is_poker_admin()
);

drop policy if exists "Players can read their own hand results" on public.poker_hand_history_players;
create policy "Players can read their own hand results"
on public.poker_hand_history_players for select to authenticated
using (user_id = auth.uid() or public.is_poker_admin());

create or replace function public.archive_completed_poker_hand()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_history_id bigint;
  v_winners uuid[] := array[]::uuid[];
  v_best bigint := -1;
  v_score bigint;
  v_player record;
  v_cards jsonb;
  v_folded boolean;
  v_contribution bigint;
  v_starting bigint;
  v_ending bigint;
begin
  if new.phase <> 'showdown' or old.phase = 'showdown' then
    return new;
  end if;

  -- Identify the winner(s). On a fold-out, the sole non-folded player wins.
  if jsonb_array_length(coalesce(new.board, '[]'::jsonb)) = 5 then
    for v_player in
      select s.player_id, s.seat_number
      from public.poker_seats s
      where s.table_id = new.table_id
        and not (coalesce(new.folded_seats, '[]'::jsonb) @> jsonb_build_array(s.seat_number))
      order by s.seat_number
    loop
      select h.cards || new.board into v_cards
      from public.poker_hole_cards h
      where h.table_id = new.table_id
        and h.hand_number = new.hand_number
        and h.player_id = v_player.player_id;

      if v_cards is not null and jsonb_array_length(v_cards) = 7 then
        v_score := public.poker_score_seven(v_cards);
        if v_score > v_best then
          v_best := v_score;
          v_winners := array[v_player.player_id];
        elsif v_score = v_best then
          v_winners := array_append(v_winners, v_player.player_id);
        end if;
      end if;
    end loop;
  else
    select array_agg(s.player_id) into v_winners
    from public.poker_seats s
    where s.table_id = new.table_id
      and not (coalesce(new.folded_seats, '[]'::jsonb) @> jsonb_build_array(s.seat_number));
  end if;

  insert into public.poker_hand_history(table_id, table_name, hand_number, board, pot, winner_ids)
  select new.table_id, t.name, new.hand_number, new.board, new.pot, coalesce(v_winners, array[]::uuid[])
  from public.poker_tables t where t.id = new.table_id
  on conflict (table_id, hand_number) do nothing
  returning id into v_history_id;

  if v_history_id is null then
    select id into v_history_id from public.poker_hand_history
    where table_id = new.table_id and hand_number = new.hand_number;
  end if;

  for v_player in
    select s.player_id, s.seat_number, s.chips
    from public.poker_seats s
    join public.poker_hole_cards h
      on h.table_id = s.table_id and h.player_id = s.player_id and h.hand_number = new.hand_number
    where s.table_id = new.table_id
  loop
    select h.starting_chips, h.cards into v_starting, v_cards
    from public.poker_hole_cards h
    where h.table_id = new.table_id and h.hand_number = new.hand_number
      and h.player_id = v_player.player_id;

    v_contribution := coalesce((new.total_contributions ->> v_player.seat_number::text)::bigint, 0);
    v_folded := coalesce(new.folded_seats, '[]'::jsonb) @> jsonb_build_array(v_player.seat_number);
    v_ending := v_player.chips;

    insert into public.poker_hand_history_players(
      hand_history_id, user_id, seat_number, starting_chips, ending_chips,
      contribution, chips_won, net_result, folded, is_winner, hole_cards
    ) values (
      v_history_id, v_player.player_id, v_player.seat_number,
      coalesce(v_starting, 0), v_ending, v_contribution,
      greatest(0, v_ending - (coalesce(v_starting, 0) - v_contribution)),
      v_ending - coalesce(v_starting, 0),
      v_folded,
      v_player.player_id = any(coalesce(v_winners, array[]::uuid[])),
      case when not v_folded and jsonb_array_length(new.board) = 5 then v_cards else null end
    )
    on conflict (hand_history_id, user_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists poker_archive_completed_hand on public.poker_hand_state;
create trigger poker_archive_completed_hand
after update of phase on public.poker_hand_state
for each row
when (new.phase = 'showdown' and old.phase is distinct from new.phase)
execute function public.archive_completed_poker_hand();

-- Public profile payload: profile details and aggregate results, without exposing opponents' private cards.
create or replace function public.get_player_public_profile(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_stats jsonb;
  v_recent jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view player profiles'; end if;

  select jsonb_build_object(
    'id', p.id,
    'discord_name', p.discord_name,
    'avatar_url', p.avatar_url,
    'bio', coalesce(p.bio, '')
  ) into v_profile
  from public.player_profiles p where p.id = p_player_id;

  if v_profile is null then
    select jsonb_build_object(
      'id', u.id,
      'discord_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Poker Player'),
      'avatar_url', u.raw_user_meta_data->>'avatar_url',
      'bio', ''
    ) into v_profile from auth.users u where u.id = p_player_id and u.deleted_at is null;
  end if;

  if v_profile is null then raise exception 'Player profile not found'; end if;

  select jsonb_build_object(
    'hands_played', count(*),
    'hands_won', count(*) filter (where hp.is_winner),
    'win_rate', case when count(*) = 0 then 0
      else round(100.0 * count(*) filter (where hp.is_winner) / count(*), 1) end,
    'total_chips_won', coalesce(sum(hp.chips_won), 0),
    'net_chips', coalesce(sum(hp.net_result), 0),
    'biggest_pot', coalesce(max(h.pot) filter (where hp.is_winner), 0)
  ) into v_stats
  from public.poker_hand_history_players hp
  join public.poker_hand_history h on h.id = hp.hand_history_id
  where hp.user_id = p_player_id;

  select coalesce(jsonb_agg(x.item order by x.completed_at desc), '[]'::jsonb)
  into v_recent
  from (
    select jsonb_build_object(
      'id', h.id,
      'table_name', h.table_name,
      'hand_number', h.hand_number,
      'board', h.board,
      'pot', h.pot,
      'completed_at', h.completed_at,
      'is_winner', hp.is_winner,
      'chips_won', hp.chips_won,
      'net_result', hp.net_result,
      'folded', hp.folded
    ) as item, h.completed_at
    from public.poker_hand_history_players hp
    join public.poker_hand_history h on h.id = hp.hand_history_id
    where hp.user_id = p_player_id
    order by h.completed_at desc
    limit 20
  ) x;

  return jsonb_build_object(
    'profile', v_profile,
    'stats', coalesce(v_stats, '{}'::jsonb),
    'recent_hands', v_recent
  );
end;
$$;

revoke all on function public.get_player_public_profile(uuid) from public;
grant execute on function public.get_player_public_profile(uuid) to authenticated;

-- Current user's full hand list (also used by the History page).
create or replace function public.get_my_poker_hand_history(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.completed_at desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', h.id,
      'table_name', h.table_name,
      'hand_number', h.hand_number,
      'board', h.board,
      'pot', h.pot,
      'completed_at', h.completed_at,
      'is_winner', hp.is_winner,
      'chips_won', hp.chips_won,
      'net_result', hp.net_result,
      'contribution', hp.contribution,
      'folded', hp.folded
    ) as item, h.completed_at
    from public.poker_hand_history_players hp
    join public.poker_hand_history h on h.id = hp.hand_history_id
    where hp.user_id = auth.uid()
    order by h.completed_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) x;
$$;

revoke all on function public.get_my_poker_hand_history(integer) from public;
grant execute on function public.get_my_poker_hand_history(integer) to authenticated;


-- Admin-only aggregate player performance and recent game history.
create or replace function public.admin_list_player_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  select coalesce(jsonb_agg(x.item order by x.hands_played desc, x.display_name), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', u.id,
      'display_name', coalesce(nullif(p.discord_name,''),u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Poker player'),
      'avatar_url', p.avatar_url,
      'hands_played', count(hp.id),
      'hands_won', count(hp.id) filter (where hp.is_winner),
      'win_rate', case when count(hp.id)=0 then 0 else round(100.0*count(hp.id) filter (where hp.is_winner)/count(hp.id),1) end,
      'total_chips_won', coalesce(sum(hp.chips_won),0),
      'net_chips', coalesce(sum(hp.net_result),0),
      'biggest_pot', coalesce(max(h.pot) filter (where hp.is_winner),0)
    ) as item,
    count(hp.id) as hands_played,
    coalesce(nullif(p.discord_name,''),u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Poker player') as display_name
    from auth.users u
    left join public.player_profiles p on p.id=u.id
    left join public.poker_hand_history_players hp on hp.user_id=u.id
    left join public.poker_hand_history h on h.id=hp.hand_history_id
    where u.deleted_at is null
    group by u.id,p.discord_name,p.avatar_url,u.raw_user_meta_data
  ) x;
  return v_result;
end;
$$;

create or replace function public.admin_list_recent_hands(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  select coalesce(jsonb_agg(x.item order by x.completed_at desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', h.id,
      'table_name', h.table_name,
      'hand_number', h.hand_number,
      'board', h.board,
      'pot', h.pot,
      'winner_ids', h.winner_ids,
      'completed_at', h.completed_at,
      'players', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', hp.user_id,
          'name', coalesce(nullif(p.discord_name,''),'Poker player'),
          'is_winner', hp.is_winner,
          'chips_won', hp.chips_won,
          'net_result', hp.net_result,
          'folded', hp.folded
        ) order by hp.seat_number), '[]'::jsonb)
        from public.poker_hand_history_players hp
        left join public.player_profiles p on p.id=hp.user_id
        where hp.hand_history_id=h.id
      )
    ) as item, h.completed_at
    from public.poker_hand_history h
    order by h.completed_at desc
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) x;
  return v_result;
end;
$$;

revoke all on function public.admin_list_player_stats() from public;
revoke all on function public.admin_list_recent_hands(integer) from public;
grant execute on function public.admin_list_player_stats() to authenticated;
grant execute on function public.admin_list_recent_hands(integer) to authenticated;
