"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function HandHistoryPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [hands, setHands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!alive) return;
      setUser(auth.user || null);
      if (!auth.user) { setLoading(false); return; }
      const { data, error: historyError } = await supabase.rpc("get_my_poker_hand_history", { p_limit: 100 });
      if (!alive) return;
      if (historyError) setError(historyError.message);
      else setHands(Array.isArray(data) ? data : []);
      setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, []);

  return <main className="profile-shell">
    <header className="profile-topbar"><a className="profile-brand" href="/">ROULO <b>POKER</b></a><div><button className="profile-back" onClick={() => router.push("/")}>← Lobby</button>{user && <a href={"/profile/" + user.id}>My profile</a>}</div></header>
    <section className="profile-page-heading"><span className="profile-kicker">YOUR RESULTS</span><h1>Hand history</h1><p>Completed hands, pots and your chip results.</p></section>
    {loading ? <div className="profile-empty">Loading your hands…</div> : !user ? <div className="profile-empty">Sign in with Discord to view your hand history.</div> : error ? <div className="profile-empty">{error}</div> : hands.length ? <div className="history-list">{hands.map(hand => <article className="history-card" key={hand.id}>
      <div className="history-card-head"><div><strong>{hand.table_name}</strong><span>Hand #{hand.hand_number} · {formatDate(hand.completed_at)}</span></div><b className={hand.is_winner ? "result-positive" : "result-neutral"}>{hand.is_winner ? "WON" : hand.folded ? "FOLDED" : "PLAYED"}</b></div>
      <div className="history-board">{(hand.board || []).map((card, i) => <span key={i} className={/[dh]$/.test(card) ? "red" : ""}>{card}</span>)}</div>
      <div className="history-card-foot"><span>Pot <b>{Number(hand.pot || 0).toLocaleString()}</b></span><span>Contribution <b>{Number(hand.contribution || 0).toLocaleString()}</b></span><span>Chips won <b>{Number(hand.chips_won || 0).toLocaleString()}</b></span><span>Net <b className={Number(hand.net_result) >= 0 ? "result-positive" : "result-negative"}>{Number(hand.net_result || 0) > 0 ? "+" : ""}{Number(hand.net_result || 0).toLocaleString()}</b></span></div>
    </article>)}</div> : <div className="profile-empty">No completed hands yet. Play a game and your results will be saved here.</div>}
  </main>;
}
