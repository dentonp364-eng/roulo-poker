"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const SUITS = { c: "♣", d: "♦", h: "♥", s: "♠" };
const RED_SUITS = new Set(["d", "h"]);

function PlayingCard({ card, faceDown = false }) {
  if (faceDown || !card) return <div className="playing-card-back"><b>R</b></div>;
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return <div className={`playing-card-face ${RED_SUITS.has(suit) ? "red-card" : ""}`}>
    <strong>{rank}</strong><span>{SUITS[suit] || suit}</span>
    <small>{SUITS[suit] || suit}</small>
  </div>;
}

export default function PokerTablePage() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.id;
  const [table, setTable] = useState(null);
  const [players, setPlayers] = useState([]);
  const [user, setUser] = useState(null);
  const [hand, setHand] = useState(null);
  const [holeCards, setHoleCards] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const [{ data: auth }, { data, error: tableError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("poker_tables")
        .select("id,name,owner_id,small_blind,big_blind,max_players,is_private,status,poker_seats(id,player_id,seat_number,chips)")
        .eq("id", tableId).single()
    ]);
    if (tableError) { setError(tableError.message); setLoading(false); return; }
    setUser(auth.user || null);
    setTable(data);
    const ids = (data.poker_seats || []).map(s => s.player_id);
    if (ids.length) {
      const { data: profiles } = await supabase
        .from("player_profiles").select("id,discord_name,avatar_url").in("id", ids);
      setPlayers((data.poker_seats || []).map(s => ({
        ...s, profile: (profiles || []).find(p => p.id === s.player_id)
      })));
    } else setPlayers([]);

    if (auth.user) {
      const [{ data: handData }, { data: privateCards }] = await Promise.all([
        supabase.from("poker_hand_state").select("*").eq("table_id", tableId).maybeSingle(),
        supabase.from("poker_hole_cards").select("cards,hand_number").eq("table_id", tableId).eq("player_id", auth.user.id).order("hand_number", { ascending: false }).limit(1).maybeSingle()
      ]);
      setHand(handData || null);
      setHoleCards(privateCards?.cards || []);
    }
    setLoading(false);
  }, [tableId]);

  useEffect(() => {
    load();
    const channel = supabase.channel("poker-table-" + tableId)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_seats",filter:"table_id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_tables",filter:"id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_hand_state",filter:"table_id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_hole_cards",filter:"table_id=eq." + tableId}, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load, tableId]);

  async function startHand() {
    if (starting) return;
    setStarting(true);
    setError("");
    const { error: startError } = await supabase.rpc("start_poker_hand", { p_table_id: tableId });
    setStarting(false);
    if (startError) setError(startError.message);
    else await load();
  }

  if (loading) return <main className="poker-shell"><p className="table-loading">Loading table…</p></main>;
  if (error && !table) return <main className="poker-shell"><button className="table-back" onClick={()=>router.push("/")}>← Lobby</button><p>{error}</p></main>;
  if (!table) return <main className="poker-shell"><button className="table-back" onClick={()=>router.push("/")}>← Lobby</button><p>Table not found.</p></main>;

  const seatPlayer = (seat) => players.find(p => p.seat_number === seat);
  const seats = Array.from({length:table.max_players},(_,i)=>seatPlayer(i+1));
  const isSeated = players.some(p => p.player_id === user?.id);
  const phase = hand?.phase || "waiting";
  const board = Array.isArray(hand?.board) ? hand.board : [];
  const canStart = isSeated && players.filter(p => Number(p.chips) > 0).length >= 2 && (!hand || phase === "waiting" || phase === "showdown");

  return <main className="poker-shell">
    <header className="poker-topbar">
      <a href="/" className="poker-brand"><span>ROULO</span><small>POKER</small></a>
      <div className="table-heading"><span className="table-kicker">TEXAS HOLD’EM</span><h1>{table.name}</h1><p>{table.small_blind}/{table.big_blind} blinds <i/> {players.length}/{table.max_players} seated</p></div>
      <button className="table-back" onClick={()=>router.push("/")}>← BACK TO LOBBY</button>
    </header>
    {error && <p className="table-error" role="alert">{error}</p>}
    <section className="table-stage">
      <div className="felt-table">
        <div className="felt-watermark">ROULO <b>POKER</b></div>
        <div className="table-center">
          <div className="table-kicker">{phase === "waiting" ? "TABLE READY" : `HAND ${hand?.hand_number || ""} · ${phase.toUpperCase()}`}</div>
          <div className="community-cards">{Array.from({length:5},(_,n)=><PlayingCard key={n} card={board[n]} faceDown={!board[n]} />)}</div>
          <div className="pot-display"><small>POT</small><strong>{Number(hand?.pot || 0).toLocaleString()}</strong><span>VIRTUAL CHIPS</span></div>
          <div className="hand-waiting">{phase === "waiting" ? "Waiting to start a hand" : "Hand in progress · betting actions coming next"}</div>
          {canStart && <button className="start-hand-button" onClick={startHand} disabled={starting}>{starting ? "DEALING…" : "DEAL NEXT HAND"}</button>}
        </div>
        {seats.map((player,i)=><div className={`player-seat seat-${i+1} ${player?"occupied":""}`} key={i}>
          <div className="seat-avatar">{player?.profile?.avatar_url?<img src={player.profile.avatar_url} alt="" />:<span>{player?"♠":"+"}</span>}</div>
          <div className="seat-copy"><small>SEAT {i+1}</small><strong>{player?.profile?.discord_name || "EMPTY SEAT"}</strong><span>{player?Number(player.chips).toLocaleString()+" chips":"Waiting for player"}</span></div>
        </div>)}
      </div>
    </section>
    <section className="table-controls">
      <div className="your-cards"><span className="table-kicker">YOUR HAND</span>
        <PlayingCard card={holeCards[0]} faceDown={!holeCards[0]} />
        <PlayingCard card={holeCards[1]} faceDown={!holeCards[1]} />
      </div>
      <div className="action-panel"><button disabled>FOLD</button><button className="action-primary" disabled>CHECK / CALL</button><button disabled>BET / RAISE</button></div>
    </section>
    <p className="prototype-note">{isSeated ? "Your seat is connected · " : "Join this table from the lobby to play · "}Cards are dealt privately to each player · Virtual chips only</p>
  </main>;
}
