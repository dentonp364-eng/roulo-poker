"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const SUITS = { c: "♣", d: "♦", h: "♥", s: "♠" };
const RED_SUITS = new Set(["d", "h"]);

function PlayingCard({ card, faceDown = false }) {
  if (faceDown || !card) return <div className="playing-card-back"><img src="/roulo-mark.png" alt="" /></div>;
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
  const [acting, setActing] = useState(false);
  const [connection, setConnection] = useState("CONNECTING");
  const [lastSynced, setLastSynced] = useState(null);

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
    setLastSynced(new Date());
    setLoading(false);
  }, [tableId]);

  useEffect(() => {
    let alive = true;
    load();
    const channel = supabase.channel("poker-table-" + tableId)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_seats",filter:"table_id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_tables",filter:"id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_hand_state",filter:"table_id=eq." + tableId}, load)
      .on("postgres_changes", {event:"*",schema:"public",table:"poker_hole_cards",filter:"table_id=eq." + tableId}, load)
      .subscribe((status) => {
        if (!alive) return;
        setConnection(status === "SUBSCRIBED" ? "LIVE" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "RECONNECTING" : "CONNECTING");
        if (status === "SUBSCRIBED") load();
      });

    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") load();
    };
    const refreshTimer = window.setInterval(refreshWhenActive, 10000);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      alive = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      supabase.removeChannel(channel);
    };
  }, [load, tableId]);

  async function takeAction(action, amount = 0) {
    if (acting) return;
    setActing(true);
    setError("");
    const { error: actionError } = await supabase.rpc("poker_player_action", {
      p_table_id: tableId, p_action: action, p_amount: amount
    });
    setActing(false);
    if (actionError) setError(actionError.message);
    else await load();
  }

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
  const mySeat = players.find(p => p.player_id === user?.id);
  const myTurn = !!mySeat && hand?.acting_seat === mySeat.seat_number && ["preflop","flop","turn","river"].includes(phase);
  const myContribution = Number(hand?.contributions?.[String(mySeat?.seat_number)] || 0);
  const dealerSeat = Number(hand?.dealer_seat || 0);
  const actingSeat = Number(hand?.acting_seat || 0);
  const toCall = Math.max(0, Number(hand?.current_bet || 0) - myContribution);
  const minimumRaiseTo = Number(hand?.current_bet || 0) + Math.max(Number(hand?.last_raise_size || 0), Number(table.big_blind));
  const maximumRaiseTo = myContribution + Number(mySeat?.chips || 0);
  const raiseTo = Math.min(minimumRaiseTo, maximumRaiseTo);
  const isShortAllIn = raiseTo > Number(hand?.current_bet || 0) && raiseTo < minimumRaiseTo;
  const canStart = isSeated && players.filter(p => Number(p.chips) > 0).length >= 2 && (!hand || phase === "waiting" || phase === "showdown");

  return <main className="poker-shell">
    <header className="poker-topbar">
      <a href="/" className="poker-brand"><img src="/roulo-logo.png" alt="Roulo" /><small>POKER</small></a>
      <div className="table-heading"><span className="table-kicker">TEXAS HOLD’EM</span><h1>{table.name}</h1><p>{table.small_blind}/{table.big_blind} blinds <i/> {players.length}/{table.max_players} seated</p></div>
      <button className="table-back" onClick={()=>router.push("/")}>← BACK TO LOBBY</button>
    </header>
    {error && <p className="table-error" role="alert">{error}</p>}
    <div className="table-connection-bar"><span className={connection === "LIVE" ? "connection-dot live" : "connection-dot"} />{connection === "LIVE" ? "LIVE SYNC" : connection === "RECONNECTING" ? "RECONNECTING…" : "CONNECTING…"}<button onClick={load} disabled={loading || acting || starting}>REFRESH TABLE</button>{lastSynced && <small>Synced {lastSynced.toLocaleTimeString()}</small>}</div>
    <section className="table-stage">
      <div className="felt-table">
        <div className="felt-watermark">ROULO <b>POKER</b></div>
        <div className="table-center">
          <div className="table-kicker">{phase === "waiting" ? "TABLE READY" : `HAND ${hand?.hand_number || ""} · ${phase.toUpperCase()}`}</div>
          <div className="community-cards">{Array.from({length:5},(_,n)=><PlayingCard key={n} card={board[n]} faceDown={!board[n]} />)}</div>
          <div className="pot-display"><small>POT</small><strong>{Number(hand?.pot || 0).toLocaleString()}</strong><span>VIRTUAL CHIPS</span>{hand?.current_bet > 0 && <small className="table-current-bet">CURRENT BET {Number(hand.current_bet).toLocaleString()}</small>}</div>
          <div className="hand-waiting">{phase === "waiting" ? "Waiting to start a hand" : phase === "showdown" ? "Hand complete · ready for the next deal" : myTurn ? "YOUR TURN TO ACT" : `Waiting for seat ${hand?.acting_seat ?? "—"}`}</div>
          {canStart && <button className="start-hand-button" onClick={startHand} disabled={starting}>{starting ? "DEALING…" : "DEAL NEXT HAND"}</button>}
        </div>
        {seats.map((player,i)=><div className={`player-seat seat-${i+1} ${player?"occupied":""} ${actingSeat===i+1?"is-acting":""}`} key={i}>
          <div className="seat-avatar">{player?.profile?.avatar_url?<img src={player.profile.avatar_url} alt="" />:<span>{player?"♠":"+"}</span>}</div>
          <div className="seat-copy"><small>SEAT {i+1} {dealerSeat===i+1 ? " · DEALER" : ""}</small>{player ? <a className="seat-profile-link" href={"/profile/" + player.player_id}>{player.profile?.discord_name || "Poker player"}</a> : <strong>EMPTY SEAT</strong>}<span>{player?Number(player.chips).toLocaleString()+" chips":"Waiting for player"}</span>{actingSeat===i+1 && <em className="turn-pill">TO ACT</em>}</div>
        </div>)}
      </div>
    </section>
    <section className="table-controls">
      <div className="your-cards"><span className="table-kicker">YOUR HAND</span>
        <PlayingCard card={holeCards[0]} faceDown={!holeCards[0]} />
        <PlayingCard card={holeCards[1]} faceDown={!holeCards[1]} />
      </div>
      <div className="action-panel">
        <button disabled={!myTurn || acting} onClick={() => takeAction("fold")}>FOLD</button>
        <button className="action-primary" disabled={!myTurn || acting} onClick={() => takeAction(toCall > 0 ? "call" : "check")}>{toCall > 0 ? `CALL ${toCall.toLocaleString()}` : "CHECK"}</button>
        <button disabled={!myTurn || acting || raiseTo <= Number(hand?.current_bet || 0)} onClick={() => takeAction(hand?.current_bet > 0 ? "raise" : "bet", raiseTo)}>{isShortAllIn ? "ALL-IN" : hand?.current_bet > 0 ? "RAISE TO" : "BET"} {raiseTo.toLocaleString()}</button>
      </div>
    </section>
    <p className="prototype-note">{isSeated ? `Your seat: ${mySeat?.seat_number} · ` : "Join this table from the lobby to play · "}{myTurn ? "It's your turn · " : ""}Cards are dealt privately to each player · Virtual chips only</p>
  </main>;
}
