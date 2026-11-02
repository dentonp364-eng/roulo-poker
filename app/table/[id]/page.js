"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const SUITS = { c: "♣", d: "♦", h: "♥", s: "♠" };
const RED_SUITS = new Set(["d", "h"]);

function PlayingCard({ card, faceDown = false }) {
  if (faceDown || !card) return <div className="playing-card-back" aria-label="Face-down card"><img src="/roulo-logo.png" alt="" /></div>;
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
  const [testPlayerMode, setTestPlayerMode] = useState(false);
  const [testModeChecked, setTestModeChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [testSetupBusy, setTestSetupBusy] = useState(false);
  const [testPlayerReady, setTestPlayerReady] = useState(false);

  const testClient = useMemo(() => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { storageKey: `roulo-test-player-${tableId}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
  ), [tableId]);
  const db = testPlayerMode ? testClient : supabase;

  useEffect(() => {
    setTestPlayerMode(new URLSearchParams(window.location.search).get("testPlayer") === "1");
    setTestModeChecked(true);
  }, []);

  useEffect(() => {
    if (testPlayerMode || !testModeChecked) return;
    supabase.rpc("is_poker_admin").then(({ data }) => setIsAdmin(data === true)).catch(() => setIsAdmin(false));
  }, [testPlayerMode, testModeChecked]);

  useEffect(() => {
    if (!testModeChecked || !testPlayerMode) return;
    let cancelled = false;
    async function prepareTestPlayer() {
      setTestSetupBusy(true);
      setError("");
      const [{ data: adminAuth }, { data: adminAccess }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("is_poker_admin")
      ]);
      if (cancelled) return;
      if (!adminAuth?.user || adminAccess !== true) {
        setError("Only a signed-in Roulo Poker administrator can launch a test player.");
        setTestSetupBusy(false);
        setLoading(false);
        return;
      }
      let { data: sessionData } = await testClient.auth.getSession();
      if (!sessionData?.session) {
        const { data, error: signInError } = await testClient.auth.signInAnonymously({ options: { data: { full_name: "Roulo Test Player", name: "Roulo Test Player" } } });
        if (signInError) {
          setError(signInError.message.includes("Anonymous") ? "Anonymous sign-ins are disabled in Supabase. Enable Authentication → Sign In / Providers → Anonymous Sign-Ins, then reopen this test player." : signInError.message);
          setTestSetupBusy(false);
          setLoading(false);
          return;
        }
        sessionData = { session: data.session };
      }
      const { error: joinError } = await testClient.rpc("join_poker_table", { p_table_id: tableId, p_invite_code: null });
      if (cancelled) return;
      if (joinError) {
        setError(joinError.message);
        setTestSetupBusy(false);
        setLoading(false);
        return;
      }
      setTestSetupBusy(false);
      setTestPlayerReady(true);
      await load();
    }
    prepareTestPlayer();
    return () => { cancelled = true; };
  }, [testModeChecked, testPlayerMode, tableId, testClient]);

  const load = useCallback(async () => {
    const [{ data: auth }, { data, error: tableError }] = await Promise.all([
      db.auth.getUser(),
      db.from("poker_tables")
        .select("id,name,owner_id,small_blind,big_blind,max_players,is_private,status,poker_seats(id,player_id,seat_number,chips)")
        .eq("id", tableId).single()
    ]);
    if (tableError) { setError(tableError.message); setLoading(false); return; }
    setUser(auth.user || null);
    setTable(data);
    const ids = (data.poker_seats || []).map(s => s.player_id);
    if (ids.length) {
      const { data: profiles } = await db
        .from("player_profiles").select("id,discord_name,avatar_url").in("id", ids);
      setPlayers((data.poker_seats || []).map(s => ({
        ...s, profile: (profiles || []).find(p => p.id === s.player_id)
      })));
    } else setPlayers([]);

    if (auth.user) {
      const [{ data: handData }, { data: privateCards }] = await Promise.all([
        db.from("poker_hand_state").select("*").eq("table_id", tableId).maybeSingle(),
        db.from("poker_hole_cards").select("cards,hand_number").eq("table_id", tableId).eq("player_id", auth.user.id).order("hand_number", { ascending: false }).limit(1).maybeSingle()
      ]);
      setHand(handData || null);
      setHoleCards(privateCards?.cards || []);
    }
    setLastSynced(new Date());
    setLoading(false);
  }, [tableId, db]);

  useEffect(() => {
    if (!testModeChecked || (testPlayerMode && (!testPlayerReady || testSetupBusy))) return;
    let alive = true;
    load();
    const channel = db.channel("poker-table-" + tableId)
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
      db.removeChannel(channel);
    };
  }, [load, tableId, db, testModeChecked, testPlayerMode, testPlayerReady, testSetupBusy]);

  async function takeAction(action, amount = 0) {
    if (acting) return;
    setActing(true);
    setError("");
    const { error: actionError } = await db.rpc("poker_player_action", {
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
    const { error: startError } = await db.rpc("start_poker_hand", { p_table_id: tableId });
    setStarting(false);
    if (startError) setError(startError.message);
    else await load();
  }

  if (loading || !testModeChecked || testSetupBusy) return <main className="poker-shell"><p className="table-loading">{testPlayerMode ? "Preparing temporary test player…" : "Loading table…"}</p></main>;
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
    {testPlayerMode && <div className="table-error">TEMPORARY TEST PLAYER · Separate anonymous session <button onClick={async()=>{const {data:{user:testUser}}=await testClient.auth.getUser();if(testUser){if(hand && !["waiting","showdown"].includes(hand.phase)){setError("Finish the current hand before removing the test player.");return;}const {error:removeError}=await supabase.rpc("admin_remove_poker_player",{p_table_id:tableId,p_player_id:testUser.id});if(removeError){setError(removeError.message);return;}}await testClient.auth.signOut();window.location.href="/table/"+tableId;}}>REMOVE TEST PLAYER</button></div>}
    {!testPlayerMode && isAdmin && <div className="table-connection-bar"><span>ADMIN TESTING</span><button onClick={()=>window.open("/table/"+tableId+"?testPlayer=1","_blank","noopener,noreferrer")}>＋ ADD TEMPORARY TEST PLAYER</button></div>}
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
