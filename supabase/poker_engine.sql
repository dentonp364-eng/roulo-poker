-- Trashguy Poker: server-authoritative hand foundation (virtual chips only)
-- Run in Supabase SQL Editor after setup_lobby.sql.

create table if not exists public.poker_hand_state (
  table_id uuid primary key references public.poker_tables(id) on delete cascade,
  hand_number integer not null default 0,
  phase text not null default 'waiting' check (phase in ('waiting','preflop','flop','turn','river','showdown')),
  board jsonb not null default '[]'::jsonb,
  pot bigint not null default 0,
  current_bet bigint not null default 0,
  acting_seat integer,
  dealer_seat integer,
  contributions jsonb not null default '{}'::jsonb,
  folded_seats jsonb not null default '[]'::jsonb,
  acted_seats jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.poker_private_decks (
  table_id uuid primary key references public.poker_tables(id) on delete cascade,
  hand_number integer not null,
  cards jsonb not null
);

create table if not exists public.poker_hole_cards (
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  hand_number integer not null,
  player_id uuid not null references auth.users(id) on delete cascade,
  cards jsonb not null,
  primary key (table_id, hand_number, player_id)
);

alter table public.poker_hand_state enable row level security;
alter table public.poker_hole_cards enable row level security;
alter table public.poker_private_decks enable row level security;
revoke all on public.poker_private_decks from anon, authenticated;

drop policy if exists "Players can read hand state at seated tables" on public.poker_hand_state;
create policy "Players can read hand state at seated tables"
on public.poker_hand_state for select to authenticated
using (exists (
  select 1 from public.poker_seats s
  where s.table_id = poker_hand_state.table_id and s.player_id = auth.uid()
));

drop policy if exists "Players can read only their own hole cards" on public.poker_hole_cards;
create policy "Players can read only their own hole cards"
on public.poker_hole_cards for select to authenticated
using (player_id = auth.uid());

revoke all on public.poker_hand_state from anon, authenticated;
grant select on public.poker_hand_state to authenticated;
revoke all on public.poker_hole_cards from anon, authenticated;
grant select on public.poker_hole_cards to authenticated;

create or replace function public.start_poker_hand(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_table public.poker_tables%rowtype;
  v_seats jsonb;
  v_deck jsonb := '[]'::jsonb;
  v_board jsonb := '[]'::jsonb;
  v_cards jsonb;
  v_card text;
  v_seat record;
  v_n integer := 0;
  v_hand integer;
  v_dealer integer;
  v_sb integer;
  v_bb integer;
  v_pot bigint := 0;
  v_sb_paid bigint := 0;
  v_bb_paid bigint := 0;
  v_actor integer;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_table from public.poker_tables where id = p_table_id for update;
  if not found then raise exception 'Table not found'; end if;
  if not exists (select 1 from public.poker_seats where table_id=p_table_id and player_id=v_user) then
    raise exception 'You must be seated at this table';
  end if;

  select jsonb_agg(jsonb_build_object('seat',seat_number,'player',player_id,'chips',chips) order by seat_number)
  into v_seats
  from public.poker_seats where table_id=p_table_id and chips > 0;
  if jsonb_array_length(coalesce(v_seats,'[]'::jsonb)) < 2 then
    raise exception 'At least two funded players are required';
  end if;

  insert into public.poker_hand_state(table_id) values(p_table_id)
  on conflict(table_id) do nothing;
  select hand_number + 1, coalesce(dealer_seat,0) into v_hand,v_dealer
  from public.poker_hand_state where table_id=p_table_id for update;
  v_dealer := coalesce((select min(seat_number) from public.poker_seats where table_id=p_table_id and seat_number>v_dealer and chips>0),
                       (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0));

  for v_n in 0..51 loop
    v_deck := v_deck || jsonb_build_array((array['2','3','4','5','6','7','8','9','10','J','Q','K','A'])[1 + (v_n % 13)] ||
      (array['c','d','h','s'])[1 + (v_n / 13)]);
  end loop;
  select jsonb_agg(value order by random()) into v_deck from jsonb_array_elements(v_deck);

  delete from public.poker_hole_cards where table_id=p_table_id;
  delete from public.poker_private_decks where table_id=p_table_id;
  v_n := 0;
  for v_seat in
    select s.* from public.poker_seats s
    where s.table_id=p_table_id and s.chips>0
    order by ((s.seat_number-v_dealer+v_table.max_players) % v_table.max_players)
  loop
    v_cards := jsonb_build_array(v_deck->v_n, v_deck->(v_n+1));
    v_n := v_n + 2;
    insert into public.poker_hole_cards(table_id,hand_number,player_id,cards)
    values(p_table_id,v_hand,v_seat.player_id,v_cards);
  end loop;

  v_sb := coalesce((select seat_number from public.poker_seats where table_id=p_table_id and chips>0
    and seat_number > v_dealer order by seat_number limit 1),
    (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0));
  v_bb := coalesce((select seat_number from public.poker_seats where table_id=p_table_id and chips>0
    and seat_number > v_sb order by seat_number limit 1),
    (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0 and seat_number<>v_sb));

  select least(chips,v_table.small_blind) into v_sb_paid from public.poker_seats where table_id=p_table_id and seat_number=v_sb;
  update public.poker_seats set chips=chips-v_sb_paid where table_id=p_table_id and seat_number=v_sb;
  select least(chips,v_table.big_blind) into v_bb_paid from public.poker_seats where table_id=p_table_id and seat_number=v_bb;
  update public.poker_seats set chips=chips-v_bb_paid where table_id=p_table_id and seat_number=v_bb;
  v_pot := v_sb_paid + v_bb_paid;

  v_actor := coalesce((select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0 and seat_number>v_bb),
                      (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0));

  insert into public.poker_private_decks(table_id,hand_number,cards) values(p_table_id,v_hand,v_deck);
  insert into public.poker_hand_state(table_id,hand_number,phase,board,pot,current_bet,acting_seat,dealer_seat,contributions,folded_seats,acted_seats,updated_at)
  values(p_table_id,v_hand,'preflop',v_board,v_pot,v_bb_paid,v_actor,v_dealer,
    jsonb_build_object(v_sb::text,v_sb_paid,v_bb::text,v_bb_paid),'[]'::jsonb,'[]'::jsonb,now())
  on conflict(table_id) do update set hand_number=excluded.hand_number,phase=excluded.phase,board=excluded.board,
    pot=excluded.pot,current_bet=excluded.current_bet,acting_seat=excluded.acting_seat,dealer_seat=excluded.dealer_seat,
    contributions=excluded.contributions,folded_seats=excluded.folded_seats,acted_seats=excluded.acted_seats,updated_at=now();

  return jsonb_build_object('hand_number',v_hand,'phase','preflop','pot',v_pot,'acting_seat',v_actor);
end;
$$;

revoke all on function public.start_poker_hand(uuid) from public;
grant execute on function public.start_poker_hand(uuid) to authenticated;
