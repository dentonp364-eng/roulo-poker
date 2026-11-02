"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function TournamentsPage() {
  const [user,setUser]=useState(null);
  const [items,setItems]=useState([]);
  const [results,setResults]=useState([]);
  const itemsRef=useRef([]);
  const [name,setName]=useState("Friday Night Tournament");
  const [tableCount,setTableCount]=useState(2);
  const [seats,setSeats]=useState(9);
  const [chips,setChips]=useState(10000);
  const [small,setSmall]=useState(25);
  const [big,setBig]=useState(50);
  const [interval,setInterval]=useState(15);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    const {data,error}=await supabase.rpc("list_poker_tournaments");
    if(error) setMessage(error.message);
    else { const next=Array.isArray(data)?data:[]; itemsRef.current=next; setItems(next); }
  },[]);

  const loadResults=useCallback(async()=>{
    const {data,error}=await supabase.rpc("list_poker_tournament_results");
    if(error) setMessage(error.message);
    else setResults(Array.isArray(data)?data:[]);
  },[]);

  useEffect(()=>{
    let alive=true;
    supabase.auth.getUser().then(({data})=>{if(alive)setUser(data.user||null);});
    load();
    loadResults();
    return ()=>{alive=false;};
  },[load,loadResults]);

  useEffect(()=>{
    if(!user)return;
    const syncRunning=async()=>{
      const running=itemsRef.current.filter(t=>t.status==="running" && t.my_table_id);
      if(!running.length)return;
      await Promise.all(running.map(t=>supabase.rpc("advance_poker_tournament_blinds",{p_tournament_id:t.id})));
      await load();
    };
    syncRunning();
    const timer=window.setInterval(syncRunning,30000);
    return ()=>window.clearInterval(timer);
  },[user,load]);

  async function createTournament(e){
    e.preventDefault();
    if(!user||busy)return;
    setBusy(true);setMessage("");
    const {data,error}=await supabase.rpc("create_poker_tournament",{
      p_name:name,p_table_count:Number(tableCount),p_players_per_table:Number(seats),
      p_starting_chips:Number(chips),p_small_blind:Number(small),p_big_blind:Number(big),
      p_blind_interval_minutes:Number(interval)
    });
    setBusy(false);
    if(error){setMessage(error.message);return;}
    setMessage(`Tournament created with ${data.table_count} tables and capacity for ${data.capacity} players. Register below to take your seat.`);
    await load();
  }

  async function startTournament(tournament){
    if(!user||busy)return;
    setBusy(true);setMessage("");
    const {error}=await supabase.rpc("start_poker_tournament",{p_tournament_id:tournament.id});
    setBusy(false);
    if(error){setMessage(error.message);return;}
    setMessage("Tournament started. Registration is now closed and the blind clock is running.");
    await load();
  }

  async function register(tournament){
    if(!user){setMessage("Sign in with Discord before registering.");return;}
    if(busy)return;
    setBusy(true);setMessage("");
    const {data,error}=await supabase.rpc("register_poker_tournament",{p_tournament_id:tournament.id});
    setBusy(false);
    if(error){setMessage(error.message);return;}
    setMessage("Registration confirmed. Opening your assigned table…");
    window.location.href="/table/"+data.table_id;
  }

  return <main className="lobby-page tournament-page">
    <header className="topbar">
      <a className="brand" href="/"><img className="roulo-wordmark" src="/roulo-logo.png" alt="Roulo"/><span className="brand-name"><b>POKER</b></span></a>
      <nav className="main-nav"><a href="/">Poker lobby</a><a className="nav-active" href="/tournaments">Tournaments</a><a href="/history">Hand history</a></nav>
      <a className="button button-quiet" href="/">← Back to lobby</a>
    </header>

    <section className="hero-strip">
      <div><div className="eyebrow"><span className="live-dot"/> MULTI-TABLE EVENTS</div><h1>Roulo <span>tournaments.</span></h1><p>One event. Multiple tables. Your shot at the final table.</p></div>
      <div className="hero-stat"><span className="stat-number">{items.length}</span><span className="stat-label">OPEN TOURNAMENTS</span></div>
    </section>
    {message&&<p role="status" className="status-message">{message}</p>}

    <section className="tournament-layout">
      <div className="panel tournament-create">
        <div className="section-heading"><div><span className="eyebrow">HOST AN EVENT</span><h2>Create a tournament</h2></div><span className="heading-icon">♠</span></div>
        {!user&&<div className="signin-note">Sign in with Discord to create or enter a tournament.<button className="button button-discord" onClick={async()=>{const {error}=await supabase.auth.signInWithOAuth({provider:"discord",options:{redirectTo:window.location.href}});if(error)setMessage(error.message);}}>Connect Discord</button></div>}
        <form className="table-form tournament-form" onSubmit={createTournament}>
          <label className="form-field field-wide">Tournament name<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)} disabled={!user}/></label>
          <label className="form-field">Number of tables<select value={tableCount} onChange={e=>setTableCount(e.target.value)} disabled={!user}>{Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n} {n===1?"table":"tables"}</option>)}</select></label>
          <label className="form-field">Players per table<select value={seats} onChange={e=>setSeats(e.target.value)} disabled={!user}>{[2,3,4,5,6,7,8,9].map(n=><option key={n} value={n}>{n} players</option>)}</select></label>
          <label className="form-field">Starting chips<input type="number" min="100" step="100" value={chips} onChange={e=>setChips(e.target.value)} disabled={!user}/></label>
          <label className="form-field">Blind level duration<select value={interval} onChange={e=>setInterval(e.target.value)} disabled={!user}>{[5,10,15,20,30,45,60].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label>
          <label className="form-field">Small blind<input type="number" min="1" value={small} onChange={e=>setSmall(e.target.value)} disabled={!user}/></label>
          <label className="form-field">Big blind<input type="number" min="2" value={big} onChange={e=>setBig(e.target.value)} disabled={!user}/></label>
          <div className="tournament-capacity"><strong>{Number(tableCount)*Number(seats)}</strong><span>PLAYER CAPACITY</span></div>
          <button className="button button-primary submit-button" type="submit" disabled={!user||busy}>{busy?"Creating…":"Create tournament"} <span>→</span></button>
        </form>
        <p className="panel-footnote">Virtual chips only · No cash stakes · Up to 10 tables / 90 players</p>
      </div>

      <div className="panel tournament-list">
        <div className="section-heading"><div><span className="eyebrow">JOIN THE FIELD</span><h2>Open tournaments</h2></div><button className="button button-quiet" onClick={load}>↻ Refresh</button></div>
        {items.length===0?<div className="empty-state"><div className="empty-symbol">♠</div><strong>No tournaments open yet</strong><p>Create the first event and invite your players.</p></div>:
          <div className="tournament-cards">{items.map(t=><article className="tournament-card" key={t.id}>
            <div className="tournament-card-head"><div><span className="eyebrow">{t.status==="registration"?"REGISTRATION OPEN":"IN PROGRESS"}</span><h3>{t.name}</h3></div><span className="tournament-status">{t.status==="registration"?"OPEN":"LIVE"}</span></div>
            <div className="tournament-stats"><div><strong>{t.players}/{t.capacity}</strong><span>PLAYERS</span></div><div><strong>{t.table_count}</strong><span>TABLES</span></div><div><strong>{Number(t.starting_chips).toLocaleString()}</strong><span>STARTING CHIPS</span></div><div><strong>{t.status==="running"?Number(t.small_blind*Math.pow(2,Math.max(0,(t.blind_level||1)-1))).toLocaleString()+"/"+Number(t.big_blind*Math.pow(2,Math.max(0,(t.blind_level||1)-1))).toLocaleString():t.small_blind+"/"+t.big_blind}</strong><span>{t.status==="running"?"LEVEL "+(t.blind_level||1):"STARTING BLINDS"}</span></div></div>
            <div className="tournament-table-list">{(t.tables||[]).map(tb=><span key={tb.table_id}>{tb.is_final_table?"FINAL TABLE":`TABLE ${tb.table_number}`} · {tb.seated}/{tb.max_players}</span>)}</div>
            <section className="tournament-leaderboard">
              <div className="eyebrow">TOURNAMENT LEADERBOARD</div>
              {(t.leaderboard||[]).length===0?<p className="panel-footnote">No players registered yet.</p>:
                <ol>{(t.leaderboard||[]).map((p,i)=><li key={p.player_id} className={p.finish_position===1?"leaderboard-winner":""}>
                  <span className="leaderboard-rank">{p.finish_position? `#${p.finish_position}` : `#${i+1}`}</span>
                  <span className="leaderboard-name">{p.display_name}{p.eliminated_at?" · OUT":""}</span>
                  <strong>{p.eliminated_at?`Finished ${p.finish_position||"—"}`:`${Number(p.chips||0).toLocaleString()} chips`}</strong>
                </li>)}</ol>}
            </section>
            {t.status==="registration"&&user?.id===t.owner_id&&<button className="button button-quiet tournament-join" disabled={busy||t.players<2} onClick={()=>startTournament(t)}>{busy?"Starting…":"START TOURNAMENT"} →</button>}
            <button className="button button-primary tournament-join" disabled={busy||(!t.my_table_id&&(t.status!=="registration"||t.players>=t.capacity))} onClick={()=>register(t)}>{t.my_table_id?"OPEN MY TABLE":t.players>=t.capacity?"Tournament full":t.status!=="registration"?"Registration closed":"REGISTER FOR TOURNAMENT"} →</button>
          </article>)}</div>}
      </div>
    </section>
        <section className="panel tournament-results">
      <div className="section-heading"><div><span className="eyebrow">PAST EVENTS</span><h2>Tournament results</h2></div><button className="button button-quiet" onClick={loadResults}>↻ Refresh</button></div>
      {results.length===0?<div className="empty-state"><div className="empty-symbol">♠</div><strong>No completed tournaments yet</strong><p>Finished events will be saved here with their final finishing positions.</p></div>:
        <div className="tournament-result-list">{results.map(t=><article className="tournament-result-card" key={t.id}>
          <div className="tournament-result-head"><div><h3>{t.name}</h3><span>{t.completed_at?new Date(t.completed_at).toLocaleString():"Completed"}</span></div><strong>{t.players} PLAYERS</strong></div>
          <ol>{(t.leaderboard||[]).map(p=><li key={p.player_id}><span>{p.finish_position===1?"🏆":"#"+(p.finish_position||"—")}</span><strong>{p.display_name}</strong>{p.finish_position===1&&<em>WINNER</em>}</li>)}</ol>
        </article>)}</div>}
    </section>
<footer className="site-footer"><span>ROULO POKER</span><span>Multi-table tournaments · Virtual play chips only</span></footer>
  </main>;
}
