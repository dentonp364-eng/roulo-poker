"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function PokerTablePage() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.id;
  const [table, setTable] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error: tableError } = await supabase
      .from("poker_tables")
      .select("id,name,owner_id,small_blind,big_blind,max_players,is_private,status,poker_seats(id,player_id,seat_number,chips)")
      .eq("id", tableId).single();
    if (tableError) { setError(tableError.message); setLoading(false); return; }
    setTable(data);
    const ids = (data.poker_seats || []).map(s => s.player_id);
    if (ids.length) {
      const { data: profiles, error: profileError } = await supabase
        .from("player_profiles").select("id,discord_name,avatar_url").in("id", ids);
      if (!profileError) setPlayers((data.poker_seats || []).map(s => ({
        ...s, profile: (profiles || []).find(p => p.id === s.player_id)
      })));
    } else setPlayers([]);
    setLoading(false);
  }, [tableId]);

  useEffect(() => {
    load();
    const channel = supabase.channel("poker-table-" + tableId)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_seats",filter:"table_id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_tables",filter:"id=eq." + tableId}, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, tableId]);

  if (loading) return <main className="poker-shell"><p className="table-loading">Loading your table…</p></main>;
  if (error || !table) return <main className="poker-shell"><button className="table-back" onClick={()=>router.push("/")}>← Lobby</button><p>{error || "Table not found."}</p></main>;

  const seated = (seat) => players.find(p => p.seat_number === seat);
  return <main className="poker-shell">
    <header className="poker-topbar">
      <a href="/" className="poker-brand"><span>ROULO</span><small>POKER</small></a>
      <div className="table-heading"><span className="table-kicker">TEXAS HOLD’EM</span><h1>{table.name}</h1><p>{table.small_blind}/{table.big_blind} blinds <i/> {players.length}/{table.max_players} players</p></div>
      <button className="table-back" onClick={()=>router.push("/")}>← <span>Lobby</span></button>
    </header>
    <section className="felt-wrap">
      <div className="felt-table">
        <div className="felt-brand">ROULO <span>POKER</span></div>
        <div className="felt-status"><span className="status-pip"/> TABLE OPEN</div>
        <div className="community-cards">{["A♠","K♥","Q♦","J♣","10♠"].map((v,i)=><div className={`playing-card ${v.includes("♥")||v.includes("♦")?"red-card":""}`} key={i}><b>{v.slice(0,-1)}</b><span>{v.slice(-1)}</span></div>)}</div>
        <div className="pot-display"><small>POT</small><strong>0</strong><span>VIRTUAL CHIPS</span></div>
        <div className="table-note">Waiting for the hand to begin</div>
        {Array.from({length:table.max_players},(_,i)=>{
          const player=seated(i+1);
          return <div className={`player-seat seat-${i+1} ${player?"occupied":""}`} key={i}>
            <div className="seat-avatar">{player?.profile?.avatar_url?<img src={player.profile.avatar_url} alt="" />:<span>{player?"♠":"+"}</span>}</div>
            <strong>{player?.profile?.discord_name || "Open seat"}</strong>
            <small>{player?Number(player.chips).toLocaleString()+" chips":"SEAT "+(i+1)}</small>
          </div>;
        })}
      </div>
    </section>
    <section className="table-bottom">
      <div className="hole-card-panel"><div><span className="table-kicker">YOUR HAND</span><strong>Waiting for players</strong></div><div className="card-back">ROULO</div><div className="card-back">POKER</div></div>
      <div className="action-panel"><button disabled>FOLD</button><button disabled>CHECK / CALL</button><button disabled>BET / RAISE</button></div>
    </section>
    <p className="prototype-note">Seat presence updates live · Poker betting engine is still in development · Virtual chips only</p>
  </main>;
}
