"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function TournamentLeaderboardPage() {
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{
    const {data,error}=await supabase.rpc("list_poker_tournament_rankings");
    if(error)setMessage(error.message);
    else setPlayers(Array.isArray(data)?data:[]);
    setLoading(false);
  },[]);
  useEffect(()=>{load();},[load]);
  return <main className="profile-shell tournament-ranking-shell">
    <header className="profile-topbar"><a className="profile-brand" href="/"><img src="/roulo-logo.png" alt="Roulo" style={{width:126,height:44,objectFit:"contain"}}/><b>POKER</b></a><div><a href="/tournaments">Tournaments</a><a href="/tournament-history">Tournament history</a><a href="/history">Hand history</a><a href="/">Lobby</a></div></header>
    <section className="profile-page-heading"><span className="profile-kicker">THE COMPETITIVE CIRCUIT</span><h1>Tournament rankings</h1><p>Lifetime tournament performance, kept separate from cash-game statistics.</p></section>
    <section className="profile-history-section">
      <div className="profile-section-heading"><div><span className="profile-kicker">GLOBAL STANDINGS</span><h2>Player leaderboard</h2></div><button className="profile-back" onClick={load}>↻ Refresh</button></div>
      {message&&<p className="profile-message" role="status">{message}</p>}
      {loading?<div className="profile-empty">Loading tournament rankings…</div>:players.length===0?<div className="profile-empty">No tournament results yet. Rankings will appear after players complete events.</div>:
        <div className="tournament-ranking-table-wrap"><table className="tournament-ranking-table"><thead><tr><th>RANK</th><th>PLAYER</th><th>POINTS</th><th>EVENTS</th><th>WINS</th><th>TOP 3</th><th>BEST</th></tr></thead><tbody>
          {players.map(p=><tr key={p.player_id} className={p.rank===1?"ranking-first":""}><td>#{p.rank}</td><td><a href={"/profile/"+p.player_id}>{p.display_name}</a></td><td><strong>{Number(p.points||0).toLocaleString()}</strong></td><td>{p.tournaments_entered}</td><td>{p.wins}</td><td>{p.top_three}</td><td>{p.best_finish?"#"+p.best_finish:"—"}</td></tr>)}
        </tbody></table></div>}
      <p className="profile-empty tournament-points-note">Points system: 1st 100 · 2nd 75 · 3rd 60 · 4th 45 · 5th 35 · 6th 25 · 7th 15 · 8th or lower 10. Unfinished events do not award points.</p>
    </section>
  </main>;
}
