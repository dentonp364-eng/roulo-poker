"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function TournamentHistoryPage() {
  const [results,setResults]=useState([]);
  const [rankings,setRankings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setMessage("");
    const [history,standing]=await Promise.all([
      supabase.rpc("list_poker_tournament_results"),
      supabase.rpc("list_poker_tournament_rankings")
    ]);
    if(history.error||standing.error)setMessage(history.error?.message||standing.error?.message||"Unable to load tournament records.");
    setResults(Array.isArray(history.data)?history.data:[]);
    setRankings(Array.isArray(standing.data)?standing.data:[]);
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const wins=rankings.reduce((sum,p)=>sum+Number(p.wins||0),0);
  const podiums=rankings.reduce((sum,p)=>sum+Number(p.top_three||0),0);
  const players=rankings.length;

  return <main className="profile-shell tournament-history-shell">
    <header className="profile-topbar">
      <a className="profile-brand" href="/"><img src="/roulo-logo.png" alt="Roulo" style={{width:126,height:44,objectFit:"contain"}}/><b>POKER</b></a>
      <div><a href="/tournaments">Tournaments</a><a href="/tournament-leaderboard">Rankings</a><a href="/history">Hand history</a><a href="/">Lobby</a></div>
    </header>
    <section className="profile-page-heading">
      <span className="profile-kicker">THE ROULO COMPETITIVE RECORD</span>
      <h1>Tournament history</h1>
      <p>Completed events, final positions and player records. Tournament performance is kept separate from cash-game statistics.</p>
    </section>
    {message&&<p className="profile-message" role="status">{message}</p>}
    <section className="tournament-record-summary">
      <article><span>COMPLETED EVENTS</span><strong>{results.length}</strong></article>
      <article><span>PLAYERS RECORDED</span><strong>{players}</strong></article>
      <article><span>TOURNAMENT WINS</span><strong>{wins}</strong></article>
      <article><span>TOP-THREE FINISHES</span><strong>{podiums}</strong></article>
    </section>
    <section className="profile-history-section tournament-record-section">
      <div className="profile-section-heading"><div><span className="profile-kicker">EVENT ARCHIVE</span><h2>Completed tournaments</h2></div><button className="profile-back" onClick={load}>↻ Refresh</button></div>
      {loading?<div className="profile-empty">Loading tournament records…</div>:results.length===0?
        <div className="profile-empty">No completed tournaments yet. Finished events will appear here with their final standings.</div>:
        <div className="tournament-record-list">{results.map(event=><article className="tournament-record-card" key={event.id}>
          <div className="tournament-record-heading"><div><span className="profile-kicker">COMPLETED EVENT</span><h3>{event.name}</h3><p>{event.completed_at?new Date(event.completed_at).toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):"Completion date unavailable"}</p></div><strong>{event.players} <small>PLAYERS</small></strong></div>
          <div className="tournament-record-standings"><div className="eyebrow">FINAL STANDINGS</div>
            {(event.leaderboard||[]).length===0?<p className="profile-empty">No finishing positions recorded.</p>:
              <ol>{(event.leaderboard||[]).map((player,index)=><li key={player.player_id}>
                <span className="record-position">{player.finish_position===1?"🏆":"#"+(player.finish_position||index+1)}</span>
                <a href={"/profile/"+player.player_id}>{player.display_name||"Poker Player"}</a>
                {player.finish_position===1&&<em>CHAMPION</em>}
              </li>)}</ol>}
          </div>
        </article>)}</div>}
    </section>
    <section className="profile-history-section tournament-record-section">
      <div className="profile-section-heading"><div><span className="profile-kicker">PLAYER RECORDS</span><h2>All-time tournament leaders</h2></div><a className="profile-back" href="/tournament-leaderboard">Full rankings →</a></div>
      {loading?<div className="profile-empty">Loading player records…</div>:rankings.length===0?<div className="profile-empty">Player records will appear after tournament results are recorded.</div>:
        <div className="tournament-record-player-list">{rankings.slice(0,10).map(player=><a href={"/profile/"+player.player_id} className="tournament-record-player" key={player.player_id}>
          <span className="record-player-rank">#{player.rank}</span><strong>{player.display_name}</strong><span>{player.tournaments_entered} events</span><span>{player.wins} wins</span><b>{player.points} pts</b>
        </a>)}</div>}
      <p className="profile-empty tournament-points-note">Tournament points: 1st 100 · 2nd 75 · 3rd 60 · 4th 45 · 5th 35 · 6th 25 · 7th 15 · 8th or lower 10. No payout or prize processing is handled by Roulo Poker.</p>
    </section>
  </main>;
}
