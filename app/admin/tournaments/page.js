"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function AdminTournamentDashboard() {
  const router=useRouter();
  const [user,setUser]=useState(null);
  const [authorized,setAuthorized]=useState(false);
  const [checking,setChecking]=useState(true);
  const [events,setEvents]=useState([]);
  const [completed,setCompleted]=useState([]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState("");

  const load=useCallback(async()=>{
    const [active,history]=await Promise.all([
      supabase.rpc("list_poker_tournaments"),
      supabase.rpc("list_poker_tournament_results")
    ]);
    if(active.error||history.error)setMessage(active.error?.message||history.error?.message||"Could not load tournament information.");
    setEvents(Array.isArray(active.data)?active.data:[]);
    setCompleted(Array.isArray(history.data)?history.data:[]);
  },[]);

  useEffect(()=>{
    let alive=true;
    async function check(){
      const {data:auth}=await supabase.auth.getUser();
      if(!alive)return;
      setUser(auth.user||null);
      if(!auth.user){setChecking(false);return;}
      const {data,error}=await supabase.rpc("is_poker_admin");
      if(!alive)return;
      if(error)setMessage(error.message);
      setAuthorized(data===true);
      if(data===true)await load();
      setChecking(false);
    }
    check();
    return()=>{alive=false;};
  },[load]);

  useEffect(()=>{
    if(!authorized)return;
    const timer=window.setInterval(load,30000);
    return()=>window.clearInterval(timer);
  },[authorized,load]);

  async function action(id,kind){
    if(busy)return;
    const label=kind==="start"?"start this tournament":"synchronise its blind level";
    if(!window.confirm("Are you sure you want to "+label+"?"))return;
    setBusy(id+kind);setMessage("");
    const rpc=kind==="start"?"start_poker_tournament":"advance_poker_tournament_blinds";
    const {data,error}=await supabase.rpc(rpc,{p_tournament_id:id});
    setBusy("");
    if(error)setMessage(error.message);
    else {setMessage(kind==="start"?"Tournament started successfully.":"Blind level synchronised.");await load();}
  }

  const metrics=useMemo(()=>{
    const tables=events.flatMap(e=>(e.tables||[]));
    return {
      running:events.filter(e=>e.status==="running").length,
      registration:events.filter(e=>e.status==="registration").length,
      players:events.reduce((n,e)=>n+Number(e.players||0),0),
      tables:tables.length,
      finalTables:tables.filter(t=>t.is_final_table).length,
      completed:completed.length
    };
  },[events,completed]);

  if(checking)return <main className="admin-shell"><p>Checking admin access…</p></main>;
  if(!user)return <main className="admin-shell"><section className="admin-gate"><span className="admin-kicker">ROULO POKER</span><h1>Admin sign in required</h1><p>Sign in with your approved Discord account to manage tournaments.</p><button onClick={async()=>{const {error}=await supabase.auth.signInWithOAuth({provider:"discord",options:{redirectTo:window.location.origin+"/admin/tournaments"}});if(error)setMessage(error.message);}}>Sign in with Discord</button><button className="admin-secondary" onClick={()=>router.push("/")}>Back to lobby</button></section></main>;
  if(!authorized)return <main className="admin-shell"><section className="admin-gate"><span className="admin-kicker">RESTRICTED AREA</span><h1>Admin access only</h1><p>This account does not have permission to access tournament controls.</p><button onClick={()=>router.push("/admin")}>Admin panel</button></section></main>;

  return <main className="admin-shell tournament-admin-shell">
    <header className="admin-topbar"><a className="admin-brand" href="/"><img src="/roulo-logo.png" alt="Roulo"/><small>POKER</small></a><div><span className="admin-kicker">CONTROL ROOM</span><h1>Tournament management</h1></div><button className="admin-secondary" onClick={()=>router.push("/admin")}>← Admin panel</button></header>
    {message&&<div className="admin-message" role="status">{message}</div>}
    <section className="admin-metrics tournament-admin-metrics">
      <article><span>LIVE TOURNAMENTS</span><strong>{metrics.running}</strong></article>
      <article><span>REGISTRATION OPEN</span><strong>{metrics.registration}</strong></article>
      <article><span>PLAYERS IN ACTIVE EVENTS</span><strong>{metrics.players.toLocaleString()}</strong></article>
      <article><span>ACTIVE TABLES</span><strong>{metrics.tables}</strong></article>
      <article><span>FINAL TABLES</span><strong>{metrics.finalTables}</strong></article>
      <article><span>COMPLETED EVENTS</span><strong>{metrics.completed}</strong></article>
    </section>
    <section className="admin-panel tournament-admin-panel">
      <div className="admin-section-head"><div><span className="admin-kicker">LIVE OVERVIEW</span><h2>Active tournaments</h2><p>Automatically refreshes every 30 seconds. Use refresh for an immediate update.</p></div><div className="admin-action-group"><button className="admin-secondary" disabled={!!busy} onClick={load}>↻ Refresh</button><a className="admin-secondary" href="/tournaments">View public page</a></div></div>
      {events.length===0?<div className="profile-empty">There are no active tournaments at the moment.</div>:
        <div className="tournament-admin-events">{events.map(event=><article className="tournament-admin-event" key={event.id}>
          <div className="tournament-admin-event-head"><div><span className="admin-kicker">{event.status==="running"?"LIVE EVENT":"REGISTRATION OPEN"}</span><h3>{event.name}</h3><p>{event.players} / {event.capacity} players · {event.table_count} tables · {Number(event.starting_chips||0).toLocaleString()} starting chips</p></div><span className={event.status==="running"?"admin-status-open":"admin-status-closed"}>{event.status==="running"?"RUNNING":"REGISTRATION"}</span></div>
          {event.status==="running"&&<div className="tournament-admin-blinds"><span>LEVEL <b>{event.blind_level||1}</b></span><span>BLINDS <b>{(Number(event.small_blind)*Math.pow(2,Math.max(0,(event.blind_level||1)-1))).toLocaleString()} / {(Number(event.big_blind)*Math.pow(2,Math.max(0,(event.blind_level||1)-1))).toLocaleString()}</b></span><span>INTERVAL <b>{event.blind_interval_minutes} min</b></span></div>}
          <div className="tournament-admin-tables">{(event.tables||[]).map(table=><div className="tournament-admin-table" key={table.table_id}>
            <div><strong>{table.is_final_table?"FINAL TABLE":"TABLE "+table.table_number}</strong><span>{table.seated} / {table.max_players} seated</span></div>
            <a href={"/table/"+table.table_id}>Open table ↗</a>
          </div>)}</div>
          <div className="tournament-admin-actions">
            {event.status==="registration"&&<button className="admin-secondary" disabled={!!busy||Number(event.players)<2} onClick={()=>action(event.id,"start")}>{busy===event.id+"start"?"Starting…":"Start tournament"}</button>}
            {event.status==="running"&&<button className="admin-secondary" disabled={!!busy} onClick={()=>action(event.id,"sync")}>{busy===event.id+"sync"?"Updating…":"Sync blind level"}</button>}
            <span>Created {event.created_at?new Date(event.created_at).toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):"—"}</span>
          </div>
          {event.leaderboard?.length>0&&<div className="tournament-admin-players"><div className="admin-kicker">CURRENT PLAYER STANDINGS</div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>PLAYER</th><th>TABLE</th><th>CHIPS / RESULT</th><th>STATUS</th></tr></thead><tbody>{event.leaderboard.map((player,index)=><tr key={player.player_id}><td><a className="admin-player-link" href={"/profile/"+player.player_id}>{player.display_name||"Poker player"}</a></td><td>{player.table_number||"—"}</td><td>{player.eliminated_at?"Finished #"+(player.finish_position||"—"):Number(player.chips||0).toLocaleString()}</td><td>{player.eliminated_at?"Eliminated":"Active"}</td></tr>)}</tbody></table></div></div>}
        </article>)}</div>}
    </section>
    <section className="admin-panel tournament-admin-panel">
      <div className="admin-section-head"><div><span className="admin-kicker">EVENT ARCHIVE</span><h2>Recently completed tournaments</h2><p>Final results recorded by the tournament system.</p></div><a className="admin-secondary" href="/tournament-history">Open history page</a></div>
      {completed.length===0?<div className="profile-empty">No completed tournament records yet.</div>:
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>TOURNAMENT</th><th>COMPLETED</th><th>PLAYERS</th><th>WINNER</th><th>RESULTS</th></tr></thead><tbody>{completed.slice(0,15).map(event=><tr key={event.id}><td><strong>{event.name}</strong></td><td>{event.completed_at?new Date(event.completed_at).toLocaleString(): "—"}</td><td>{event.players}</td><td>{event.leaderboard?.find(p=>p.finish_position===1)?.display_name||"—"}</td><td><a className="admin-player-link" href="/tournament-history">View history</a></td></tr>)}</tbody></table></div>}
    </section>
    <p className="admin-footnote">Tournament controls do not manage prizes or payouts. Those remain entirely with the casino.</p>
  </main>;
}
