-- Roulo Poker: server-authoritative hand foundation (virtual chips only)
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
  updated_at timestamptz not null default now(),
  last_raise_size bigint not null default 0,
  total_contributions jsonb not null default '{}'::jsonb
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

alter table public.poker_hand_state add column if not exists last_raise_size bigint not null default 0;
alter table public.poker_hand_state add column if not exists total_contributions jsonb not null default '{}'::jsonb;

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
  if v_table.status <> 'waiting' then raise exception 'This table is closed'; end if;
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
  if exists (select 1 from public.poker_hand_state where table_id=p_table_id and phase not in ('waiting','showdown')) then
    raise exception 'A hand is already in progress';
  end if;
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

  -- Heads-up: the dealer posts the small blind. With 3+ players, the
  -- small blind is the first funded seat clockwise after the dealer.
  if (select count(*) from public.poker_seats where table_id=p_table_id and chips>0) = 2 then
    v_sb := v_dealer;
  else
    v_sb := coalesce((select seat_number from public.poker_seats where table_id=p_table_id and chips>0
      and seat_number > v_dealer order by seat_number limit 1),
      (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0));
  end if;
  v_bb := coalesce((select seat_number from public.poker_seats where table_id=p_table_id and chips>0
    and seat_number > v_sb order by seat_number limit 1),
    (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0 and seat_number<>v_sb));

  select least(chips,v_table.small_blind) into v_sb_paid from public.poker_seats where table_id=p_table_id and seat_number=v_sb;
  update public.poker_seats set chips=chips-v_sb_paid where table_id=p_table_id and seat_number=v_sb;
  select least(chips,v_table.big_blind) into v_bb_paid from public.poker_seats where table_id=p_table_id and seat_number=v_bb;
  update public.poker_seats set chips=chips-v_bb_paid where table_id=p_table_id and seat_number=v_bb;
  v_pot := v_sb_paid + v_bb_paid;

  -- Preflop action starts left of the big blind in multiway pots.
  -- Heads-up, the dealer/small blind acts first unless already all-in.
  if (select count(*) from public.poker_seats where table_id=p_table_id and chips>0) = 2 then
    v_actor := coalesce(
      (select seat_number from public.poker_seats where table_id=p_table_id and seat_number=v_dealer and chips>0),
      (select seat_number from public.poker_seats where table_id=p_table_id and seat_number=v_bb and chips>0)
    );
  else
    v_actor := coalesce((select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0 and seat_number>v_bb),
                        (select min(seat_number) from public.poker_seats where table_id=p_table_id and chips>0));
  end if;

  insert into public.poker_private_decks(table_id,hand_number,cards) values(p_table_id,v_hand,v_deck);
  insert into public.poker_hand_state(table_id,hand_number,phase,board,pot,current_bet,acting_seat,dealer_seat,contributions,folded_seats,acted_seats,updated_at,last_raise_size)
  values(p_table_id,v_hand,'preflop',v_board,v_pot,v_bb_paid,v_actor,v_dealer,
    jsonb_build_object(v_sb::text,v_sb_paid,v_bb::text,v_bb_paid),'[]'::jsonb,'[]'::jsonb,now(),v_table.big_blind)
  on conflict(table_id) do update set hand_number=excluded.hand_number,phase=excluded.phase,board=excluded.board,
    pot=excluded.pot,current_bet=excluded.current_bet,acting_seat=excluded.acting_seat,dealer_seat=excluded.dealer_seat,
    contributions=excluded.contributions,folded_seats=excluded.folded_seats,acted_seats=excluded.acted_seats,updated_at=now(),last_raise_size=excluded.last_raise_size,total_contributions=excluded.contributions;

  return jsonb_build_object('hand_number',v_hand,'phase','preflop','pot',v_pot,'acting_seat',v_actor);
end;
$$;

revoke all on function public.start_poker_hand(uuid) from public;
grant execute on function public.start_poker_hand(uuid) to authenticated;


-- Evaluate a five-card poker hand. Higher numeric scores always win.
create or replace function public.poker_score_five(p_cards jsonb)
returns bigint
language plpgsql immutable
set search_path = ''
as $$
declare
  v_ranks integer[] := array_fill(0, array[15]);
  v_values integer[] := array[]::integer[];
  v_suits text[] := array[]::text[];
  v_card text;
  v_rank integer;
  v_suit text;
  v_flush boolean;
  v_straight integer := 0;
  v_category integer := 0;
  v_kickers integer[] := array[0,0,0,0,0];
  v_i integer;
  v_j integer;
  v_n integer := 0;
  v_score bigint;
begin
  if jsonb_array_length(p_cards) <> 5 then raise exception 'Five cards required'; end if;
  for v_card in select jsonb_array_elements_text(p_cards) loop
    v_suit := right(v_card,1);
    v_rank := case left(v_card,length(v_card)-1)
      when 'A' then 14 when 'K' then 13 when 'Q' then 12 when 'J' then 11
      else left(v_card,length(v_card)-1)::integer end;
    v_ranks[v_rank] := v_ranks[v_rank] + 1;
    v_values := array_append(v_values,v_rank);
    v_suits := array_append(v_suits,v_suit);
  end loop;
  v_flush := v_suits[1]=v_suits[2] and v_suits[2]=v_suits[3] and v_suits[3]=v_suits[4] and v_suits[4]=v_suits[5];
  for v_i in reverse 14..5 loop
    if v_ranks[v_i]>0 and v_ranks[v_i-1]>0 and v_ranks[v_i-2]>0 and v_ranks[v_i-3]>0 and v_ranks[v_i-4]>0 then
      v_straight := v_i; exit;
    end if;
  end loop;
  if v_straight=0 and v_ranks[14]>0 and v_ranks[2]>0 and v_ranks[3]>0 and v_ranks[4]>0 and v_ranks[5]>0 then v_straight:=5; end if;

  if v_flush and v_straight>0 then
    v_category:=8; v_kickers[1]:=v_straight;
  end if;

  if v_category=0 then
    for v_i in reverse 14..2 loop
      if v_ranks[v_i]=4 then
        v_category:=7; v_kickers[1]:=v_i;
        for v_j in reverse 14..2 loop if v_ranks[v_j]=1 then v_kickers[2]:=v_j;exit;end if;end loop;
        exit;
      end if;
    end loop;
  end if;
  if v_category=0 then
    for v_i in reverse 14..2 loop
      if v_ranks[v_i]=3 then
        for v_j in reverse 14..2 loop if v_j<>v_i and v_ranks[v_j]>=2 then v_category:=6;v_kickers[1]:=v_i;v_kickers[2]:=v_j;exit;end if;end loop;
      end if;
      exit when v_category=6;
    end loop;
  end if;
  if v_category=0 and v_flush then
    v_category:=5;
    select array_agg(x order by x desc) into v_kickers from unnest(v_values) x;
  end if;
  if v_category=0 and v_straight>0 then v_category:=4;v_kickers[1]:=v_straight; end if;
  if v_category=0 then
    for v_i in reverse 14..2 loop
      if v_ranks[v_i]=3 then
        v_category:=3; v_kickers[1]:=v_i;
        for v_j in reverse 14..2 loop
          if v_ranks[v_j]>0 and v_j<>v_i then
            if v_kickers[2]=0 then v_kickers[2]:=v_j;
            elsif v_kickers[3]=0 then v_kickers[3]:=v_j; exit; end if;
          end if;
        end loop;
        exit;
      end if;
    end loop;
  end if;
  if v_category=0 then
    for v_i in reverse 14..2 loop
      if v_ranks[v_i]=2 then
        if v_kickers[1]=0 then v_kickers[1]:=v_i;
        elsif v_kickers[2]=0 then v_kickers[2]:=v_i; end if;
      end if;
    end loop;
    if v_kickers[2]>0 then
      v_category:=2;
      for v_i in reverse 14..2 loop if v_ranks[v_i]=1 then v_kickers[3]:=v_i;exit;end if;end loop;
    elsif v_kickers[1]>0 then
      v_category:=1;
      for v_i in reverse 14..2 loop if v_ranks[v_i]=1 then v_kickers[2]:=v_i;exit;end if;end loop;
      for v_i in reverse 14..2 loop if v_ranks[v_i]=1 and v_i<>v_kickers[2] then v_kickers[3]:=v_i;exit;end if;end loop;
      for v_i in reverse 14..2 loop if v_ranks[v_i]=1 and v_i<>v_kickers[2] and v_i<>v_kickers[3] then v_kickers[4]:=v_i;exit;end if;end loop;
    end if;
  end if;
  if v_category=0 then
    v_category:=0;
    select array_agg(x order by x desc) into v_kickers from unnest(v_values) x;
  end if;
  v_score:=v_category;
  for v_i in 1..5 loop v_score:=v_score*15+coalesce(v_kickers[v_i],0); end loop;
  return v_score;
end;
$$;

-- Best five-card score from seven cards.
create or replace function public.poker_score_seven(p_cards jsonb)
returns bigint
language plpgsql immutable
set search_path = ''
as $$
declare
  v_best bigint := -1;
  v_score bigint;
  a integer; b integer; c integer; d integer; e integer;
  v_five jsonb;
begin
  if jsonb_array_length(p_cards)<>7 then raise exception 'Seven cards required'; end if;
  for a in 0..2 loop for b in a+1..3 loop for c in b+1..4 loop
    for d in c+1..5 loop for e in d+1..6 loop
      v_five:=jsonb_build_array(p_cards->a,p_cards->b,p_cards->c,p_cards->d,p_cards->e);
      v_score:=public.poker_score_five(v_five);
      if v_score>v_best then v_best:=v_score; end if;
    end loop; end loop;
  end loop; end loop; end loop;
  return v_best;
end;
$$;

-- Settle main and side pots using each player's total contribution for this hand.
create or replace function public.poker_settle_side_pots(
  p_table_id uuid,
  p_hand_number integer,
  p_board jsonb,
  p_folded jsonb,
  p_total_contributions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $
declare
  v_level bigint;
  v_previous bigint := 0;
  v_layer bigint;
  v_contributors integer;
  v_best bigint;
  v_score bigint;
  v_winners uuid[];
  v_player record;
  v_cards jsonb;
  v_share bigint;
  v_remainder bigint;
  v_index integer;
  v_total_awarded bigint := 0;
  v_layers jsonb := '[]'::jsonb;
begin
  for v_level in
    select distinct value::bigint
    from jsonb_each_text(p_total_contributions)
    where value::bigint > 0
    order by value::bigint
  loop
    select count(*) into v_contributors
    from jsonb_each_text(p_total_contributions) c
    where c.value::bigint >= v_level;
    v_layer := (v_level-v_previous) * v_contributors;
    v_previous := v_level;

    v_best := -1;
    v_winners := array[]::uuid[];
    for v_player in
      select s.player_id, s.seat_number
      from public.poker_seats s
      where s.table_id=p_table_id
        and coalesce((p_total_contributions->>s.seat_number::text)::bigint,0) >= v_level
        and not (p_folded @> jsonb_build_array(s.seat_number))
      order by s.seat_number
    loop
      select h.cards || p_board into v_cards
      from public.poker_hole_cards h
      where h.table_id=p_table_id and h.hand_number=p_hand_number
        and h.player_id=v_player.player_id;
      if v_cards is null or jsonb_array_length(v_cards) <> 7 then
        raise exception 'Missing cards for side-pot eligible player';
      end if;
      v_score := public.poker_score_seven(v_cards);
      if v_score > v_best then
        v_best := v_score;
        v_winners := array[v_player.player_id];
      elsif v_score = v_best then
        v_winners := array_append(v_winners,v_player.player_id);
      end if;
    end loop;

    if coalesce(array_length(v_winners,1),0)=0 then
      raise exception 'No eligible player for a side pot';
    end if;
    v_share := v_layer / array_length(v_winners,1);
    v_remainder := v_layer % array_length(v_winners,1);
    v_index := 0;
    for v_player in
      select s.player_id
      from public.poker_seats s
      where s.table_id=p_table_id and s.player_id=any(v_winners)
      order by s.seat_number
    loop
      v_index := v_index + 1;
      update public.poker_seats
      set chips=chips+v_share+case when v_index<=v_remainder then 1 else 0 end
      where table_id=p_table_id and player_id=v_player.player_id;
    end loop;
    v_total_awarded := v_total_awarded + v_layer;
    v_layers := v_layers || jsonb_build_array(jsonb_build_object(
      'cap',v_level,'amount',v_layer,'winners',to_jsonb(v_winners)
    ));
  end loop;

  return jsonb_build_object('pot_awarded',v_total_awarded,'side_pots',v_layers);
end;
$;

revoke all on function public.poker_settle_side_pots(uuid,integer,jsonb,jsonb,jsonb) from public;

-- Apply a turn action, advance streets automatically, and settle the pot at showdown.
create or replace function public.poker_player_action(
  p_table_id uuid,
  p_action text,
  p_amount bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid:=auth.uid();
  v_state public.poker_hand_state%rowtype;
  v_table public.poker_tables%rowtype;
  v_seat public.poker_seats%rowtype;
  v_target bigint;
  v_to_call bigint;
  v_paid bigint;
  v_next integer;
  v_active integer;
  v_pending integer;
  v_can_act integer;
  v_board jsonb;
  v_deck jsonb;
  v_winners jsonb:='[]'::jsonb;
  v_best bigint:=-1;
  v_score bigint;
  v_player record;
  v_cards jsonb;
  v_share bigint;
  v_remainder bigint;
  v_new_phase text;
  v_street_bet bigint;
  v_n integer:=0;
  v_contrib jsonb;
  v_folded jsonb;
  v_acted jsonb;
  v_raise_increment bigint;
  v_all_in boolean := false;
  v_total_contrib jsonb;
  v_settlement jsonb;
begin
  if v_user is null then raise exception 'Sign in first'; end if;
  select * into v_table from public.poker_tables where id=p_table_id for update;
  if not found or v_table.status<>'waiting' then raise exception 'Table unavailable'; end if;
  select * into v_state from public.poker_hand_state where table_id=p_table_id for update;
  if not found or v_state.phase not in ('preflop','flop','turn','river') then raise exception 'No active hand'; end if;
  select * into v_seat from public.poker_seats where table_id=p_table_id and player_id=v_user for update;
  if not found then raise exception 'You are not seated at this table'; end if;
  if v_state.acting_seat is distinct from v_seat.seat_number then raise exception 'It is not your turn'; end if;
  if v_seat.chips<0 then raise exception 'Invalid chip balance'; end if;

  v_contrib:=v_state.contributions;
  v_total_contrib:=v_state.total_contributions;
  v_folded:=v_state.folded_seats;
  v_acted:=v_state.acted_seats;
  v_to_call:=greatest(0,v_state.current_bet-coalesce((v_contrib->>v_seat.seat_number::text)::bigint,0));

  if p_action='fold' then
    v_folded:=v_folded||jsonb_build_array(v_seat.seat_number);
    v_acted:=v_acted||jsonb_build_array(v_seat.seat_number);
  elsif p_action='check' then
    if v_to_call>0 then raise exception 'You must call or fold'; end if;
    v_acted:=v_acted||jsonb_build_array(v_seat.seat_number);
  elsif p_action='call' then
    if v_to_call=0 then raise exception 'Nothing to call'; end if;
    v_paid:=least(v_seat.chips,v_to_call);
    update public.poker_seats set chips=chips-v_paid where id=v_seat.id;
    v_contrib:=jsonb_set(v_contrib,array[v_seat.seat_number::text],to_jsonb(coalesce((v_contrib->>v_seat.seat_number::text)::bigint,0)+v_paid),true);
    update public.poker_hand_state set pot=pot+v_paid where table_id=p_table_id;
    v_total_contrib:=jsonb_set(v_total_contrib,array[v_seat.seat_number::text],to_jsonb(coalesce((v_total_contrib->>v_seat.seat_number::text)::bigint,0)+v_paid),true);
    v_acted:=v_acted||jsonb_build_array(v_seat.seat_number);
  elsif p_action in ('bet','raise') then
    if p_amount<=v_state.current_bet then raise exception 'Bet/raise must exceed the current bet'; end if;
    if p_amount>v_seat.chips+coalesce((v_contrib->>v_seat.seat_number::text)::bigint,0) then raise exception 'Bet exceeds your available chips'; end if;
    v_all_in := p_amount = v_seat.chips + coalesce((v_contrib->>v_seat.seat_number::text)::bigint,0);
    v_raise_increment := p_amount-v_state.current_bet;
    if v_state.current_bet=0 then
      if not v_all_in and p_amount < v_table.big_blind then raise exception 'Minimum bet is the big blind'; end if;
    elsif v_raise_increment < greatest(v_state.last_raise_size,v_table.big_blind) and not v_all_in then
      raise exception 'Minimum raise is %', greatest(v_state.last_raise_size,v_table.big_blind);
    end if;
    if v_state.current_bet>0 and p_action='bet' then raise exception 'Use raise while a bet is outstanding'; end if;
    if v_state.current_bet=0 and p_action='raise' then raise exception 'Use bet when no bet is outstanding'; end if;
    v_target:=p_amount-coalesce((v_contrib->>v_seat.seat_number::text)::bigint,0);
    if v_target>v_seat.chips then raise exception 'Insufficient chips'; end if;
    update public.poker_seats set chips=chips-v_target where id=v_seat.id;
    v_contrib:=jsonb_set(v_contrib,array[v_seat.seat_number::text],to_jsonb(p_amount),true);
    update public.poker_hand_state set pot=pot+v_target,current_bet=p_amount where table_id=p_table_id;
    v_total_contrib:=jsonb_set(v_total_contrib,array[v_seat.seat_number::text],to_jsonb(coalesce((v_total_contrib->>v_seat.seat_number::text)::bigint,0)+v_target),true);
    if v_all_in and v_raise_increment < greatest(v_state.last_raise_size,v_table.big_blind) then
      -- A short all-in increases the price but does not reopen action for players who already acted.
      v_acted:=v_acted||jsonb_build_array(v_seat.seat_number);
    else
      v_acted:=jsonb_build_array(v_seat.seat_number);
    end if;
    update public.poker_hand_state set last_raise_size=case
      when v_state.current_bet=0 then p_amount
      when v_raise_increment >= greatest(v_state.last_raise_size,v_table.big_blind) then v_raise_increment
      else last_raise_size end
    where table_id=p_table_id;
  else
    raise exception 'Unknown action';
  end if;

  select count(*) into v_active from public.poker_seats s
  where s.table_id=p_table_id and not (v_folded @> jsonb_build_array(s.seat_number));
  if v_active=1 then
    select jsonb_agg(s.player_id) into v_winners from public.poker_seats s
    where s.table_id=p_table_id and not (v_folded @> jsonb_build_array(s.seat_number));
    select (select pot from public.poker_hand_state where table_id=p_table_id) into v_share;
    update public.poker_seats set chips=chips+v_share where table_id=p_table_id and player_id=(v_winners->>0)::uuid;
    update public.poker_hand_state set phase='showdown',acting_seat=null,updated_at=now() where table_id=p_table_id;
    return jsonb_build_object('phase','showdown','winners',v_winners,'pot_awarded',v_share);
  end if;

  select count(*) into v_can_act
  from public.poker_seats s
  where s.table_id=p_table_id and s.chips>0
    and not (v_folded @> jsonb_build_array(s.seat_number));

  if v_can_act=0 then
    select cards into v_deck from public.poker_private_decks
    where table_id=p_table_id and hand_number=v_state.hand_number;
    v_board:=v_state.board;
    while jsonb_array_length(v_board)<5 loop
      v_n:=jsonb_array_length(v_board)+1;
      v_board:=v_board||jsonb_build_array(v_deck->(jsonb_array_length(v_deck)-v_n));
    end loop;
    v_settlement:=public.poker_settle_side_pots(
      p_table_id,v_state.hand_number,v_board,v_folded,v_total_contrib
    );
    update public.poker_hand_state set phase='showdown',board=v_board,acting_seat=null,updated_at=now()
    where table_id=p_table_id;
    return jsonb_build_object('phase','showdown','board',v_board,'all_in_runout',true)||v_settlement;
  end if;

  select count(*) into v_pending from public.poker_seats s
  where s.table_id=p_table_id and s.chips>0
    and not (v_folded @> jsonb_build_array(s.seat_number))
    and (
      not (v_acted @> jsonb_build_array(s.seat_number))
      or coalesce((v_contrib->>s.seat_number::text)::bigint,0) < v_state.current_bet
    );
  if v_pending=0 then
    -- If only one player still has chips, first let them respond to any outstanding
    -- wager. Once action is complete, run the remaining board without further betting.
    if v_can_act=1 and v_active>1 then
      select cards into v_deck from public.poker_private_decks
      where table_id=p_table_id and hand_number=v_state.hand_number;
      v_board:=v_state.board;
      while jsonb_array_length(v_board)<5 loop
        v_n:=jsonb_array_length(v_board)+1;
        v_board:=v_board||jsonb_build_array(v_deck->(jsonb_array_length(v_deck)-v_n));
      end loop;
      v_settlement:=public.poker_settle_side_pots(
        p_table_id,v_state.hand_number,v_board,v_folded,v_total_contrib
      );
      update public.poker_hand_state set phase='showdown',board=v_board,acting_seat=null,updated_at=now()
      where table_id=p_table_id;
      return jsonb_build_object('phase','showdown','board',v_board,'all_in_runout',true)||v_settlement;
    end if;

    -- All live players have acted and matched the current wager: deal next street.
    select cards into v_deck from public.poker_private_decks where table_id=p_table_id and hand_number=v_state.hand_number;
    v_board:=v_state.board;
    if v_state.phase='preflop' then
      v_board:=jsonb_build_array(v_deck->(jsonb_array_length(v_deck)-1),v_deck->(jsonb_array_length(v_deck)-2),v_deck->(jsonb_array_length(v_deck)-3));
      v_new_phase:='flop';
    elsif v_state.phase='flop' then
      v_board:=v_board||jsonb_build_array(v_deck->(jsonb_array_length(v_deck)-4));
      v_new_phase:='turn';
    elsif v_state.phase='turn' then
      v_board:=v_board||jsonb_build_array(v_deck->(jsonb_array_length(v_deck)-5));
      v_new_phase:='river';
    else
      v_new_phase:='showdown';
    end if;

    if v_new_phase='showdown' then
      v_settlement := public.poker_settle_side_pots(
        p_table_id,v_state.hand_number,v_board,v_folded,v_total_contrib
      );
      update public.poker_hand_state set phase='showdown',board=v_board,acting_seat=null,updated_at=now() where table_id=p_table_id;
      return jsonb_build_object('phase','showdown','board',v_board) || v_settlement;
    end if;

    v_street_bet:=0;
    v_acted:='[]'::jsonb;
    v_contrib:='{}'::jsonb;
    update public.poker_hand_state set phase=v_new_phase,board=v_board,current_bet=0,
      contributions='{}'::jsonb,acted_seats='[]'::jsonb,updated_at=now() where table_id=p_table_id;
  end if;

  -- On a newly dealt street, action restarts left of the dealer. During
  -- the same street, action advances clockwise from the player who just acted.
  select min(s.seat_number) into v_next from public.poker_seats s
  where s.table_id=p_table_id and s.chips>0
    and not (v_folded @> jsonb_build_array(s.seat_number))
    and s.seat_number > case when v_pending=0 then v_state.dealer_seat else v_seat.seat_number end;
  if v_next is null then
    select min(s.seat_number) into v_next from public.poker_seats s
    where s.table_id=p_table_id and s.chips>0
      and not (v_folded @> jsonb_build_array(s.seat_number));
  end if;
  update public.poker_hand_state set acting_seat=v_next,contributions=v_contrib,total_contributions=v_total_contrib,
    folded_seats=v_folded,acted_seats=v_acted,updated_at=now() where table_id=p_table_id;
  return jsonb_build_object('ok',true,'next_seat',v_next,'phase',coalesce(v_new_phase,v_state.phase));
end;
$$;

revoke all on function public.poker_player_action(uuid,text,bigint) from public;
grant execute on function public.poker_player_action(uuid,text,bigint) to authenticated;
revoke all on function public.poker_score_five(jsonb) from public;
revoke all on function public.poker_score_seven(jsonb) from public;
