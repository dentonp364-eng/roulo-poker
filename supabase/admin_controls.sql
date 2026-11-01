-- Roulo Poker admin controls
-- Run this in Supabase SQL Editor. Then add your own auth user UUID to poker_admins.
create table if not exists public.poker_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.poker_admins enable row level security;
revoke all on public.poker_admins from anon, authenticated;

create or replace function public.is_poker_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.poker_admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_poker_admin() from public;
grant execute on function public.is_poker_admin() to authenticated;

create or replace function public.admin_list_poker_tables()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'name',t.name,'status',t.status,'is_private',t.is_private,
    'small_blind',t.small_blind,'big_blind',t.big_blind,'max_players',t.max_players,
    'created_at',t.created_at,'owner_id',t.owner_id,
    'players',(select count(*) from public.poker_seats s where s.table_id=t.id)
  ) order by t.created_at desc),'[]'::jsonb)
  into v_result from public.poker_tables t;
  return v_result;
end;
$$;

create or replace function public.admin_delete_poker_table(p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  delete from public.poker_hole_cards where table_id=p_table_id;
  delete from public.poker_private_decks where table_id=p_table_id;
  delete from public.poker_hand_state where table_id=p_table_id;
  delete from public.poker_seats where table_id=p_table_id;
  delete from public.poker_tables where id=p_table_id;
  if not found then raise exception 'Table not found'; end if;
  return jsonb_build_object('deleted',true,'table_id',p_table_id);
end;
$$;

create or replace function public.admin_remove_poker_player(p_table_id uuid,p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  delete from public.poker_seats where table_id=p_table_id and player_id=p_player_id;
  if not found then raise exception 'Player is not seated at this table'; end if;
  return jsonb_build_object('removed',true,'table_id',p_table_id,'player_id',p_player_id);
end;
$$;

create or replace function public.admin_set_poker_table_status(p_table_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  if p_status not in ('waiting','closed') then raise exception 'Invalid table status'; end if;
  update public.poker_tables set status=p_status where id=p_table_id;
  if not found then raise exception 'Table not found'; end if;
  return jsonb_build_object('updated',true,'table_id',p_table_id,'status',p_status);
end;
$$;

revoke all on function public.admin_list_poker_tables() from public;
revoke all on function public.admin_delete_poker_table(uuid) from public;
revoke all on function public.admin_remove_poker_player(uuid,uuid) from public;
revoke all on function public.admin_set_poker_table_status(uuid,text) from public;
grant execute on function public.admin_list_poker_tables() to authenticated;
grant execute on function public.admin_delete_poker_table(uuid) to authenticated;
grant execute on function public.admin_remove_poker_player(uuid,uuid) to authenticated;
grant execute on function public.admin_set_poker_table_status(uuid,text) to authenticated;

-- After signing in once, copy your UUID from Supabase Authentication > Users,
-- then run this separately, replacing the placeholder:
-- insert into public.poker_admins(user_id) values ('YOUR-AUTH-USER-UUID');


-- Admin role assignment/revocation by registered Roulo Poker email.
create or replace function public.admin_list_users()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,
    'display_name',coalesce(nullif(p.discord_name,''),u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','Poker player'),
    'is_admin',exists(select 1 from public.poker_admins a where a.user_id=u.id)
  ) order by lower(coalesce(u.email,''))),'[]'::jsonb)
  into v_result from auth.users u
  left join public.player_profiles p on p.id=u.id
  where u.deleted_at is null;
  return v_result;
end;
$$;

create or replace function public.admin_assign_role_by_email(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_target uuid;
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  if nullif(trim(p_email),'') is null then raise exception 'Enter a registered account email'; end if;
  select id into v_target from auth.users where lower(email)=lower(trim(p_email)) and deleted_at is null limit 1;
  if v_target is null then raise exception 'No registered Roulo Poker account found with that email'; end if;
  insert into public.poker_admins(user_id) values(v_target) on conflict(user_id) do nothing;
  return jsonb_build_object('assigned',true,'user_id',v_target);
end;
$$;

create or replace function public.admin_revoke_role(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_poker_admin() then raise exception 'Admin access required'; end if;
  if p_user_id=auth.uid() then raise exception 'You cannot revoke your own admin role'; end if;
  delete from public.poker_admins where user_id=p_user_id;
  if not found then raise exception 'That user is not an administrator'; end if;
  return jsonb_build_object('revoked',true,'user_id',p_user_id);
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_assign_role_by_email(text) from public;
revoke all on function public.admin_revoke_role(uuid) from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_assign_role_by_email(text) to authenticated;
grant execute on function public.admin_revoke_role(uuid) to authenticated;
