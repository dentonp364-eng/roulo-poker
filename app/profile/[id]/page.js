"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Result({ hand }) {
  return <article className="history-card">
    <div className="history-card-head">
      <div><strong>{hand.table_name}</strong><span>Hand #{hand.hand_number} · {formatDate(hand.completed_at)}</span></div>
      <b className={hand.is_winner ? "result-positive" : "result-neutral"}>{hand.is_winner ? "WON" : hand.folded ? "FOLDED" : "PLAYED"}</b>
    </div>
    <div className="history-board">{(hand.board || []).map((card, i) => <span key={i} className={/[dh]$/.test(card) ? "red" : ""}>{card}</span>)}</div>
    <div className="history-card-foot"><span>Pot <b>{Number(hand.pot || 0).toLocaleString()}</b></span><span>Chips won <b>{Number(hand.chips_won || 0).toLocaleString()}</b></span><span>Net <b className={Number(hand.net_result) >= 0 ? "result-positive" : "result-negative"}>{Number(hand.net_result || 0) > 0 ? "+" : ""}{Number(hand.net_result || 0).toLocaleString()}</b></span></div>
  </article>;
}

export default function PlayerProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [hands, setHands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");

  const load = useCallback(async () => {
    const [{ data: auth }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("get_player_public_profile", { p_player_id: id })
    ]);
    setUser(auth.user || null);
    if (error) setMessage(error.message);
    else {
      setProfile(data.profile);
      setStats(data.stats || {});
      setHands(data.recent_hands || []);
      setName(data.profile?.discord_name || "");
      setBio(data.profile?.bio || "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function saveProfile(event) {
    event.preventDefault();
    if (!user || user.id !== id || saving) return;
    setSaving(true); setMessage("");
    const { error } = await supabase.from("player_profiles")
      .update({ discord_name: name.trim() || "Poker Player", bio: bio.trim(), updated_at: new Date().toISOString() })
      .eq("id", user.id);
    setSaving(false);
    if (error) setMessage(error.message);
    else { setMessage("Profile saved."); await load(); }
  }

  if (loading) return <main className="profile-shell"><p>Loading player profile…</p></main>;
  if (!profile) return <main className="profile-shell"><button className="profile-back" onClick={() => router.push("/")}>← Lobby</button><p>{message || "Player profile not found."}</p></main>;

  const ownProfile = user?.id === id;
  const winRate = Number(stats?.win_rate || 0);

  return <main className="profile-shell">
    <header className="profile-topbar"><a className="profile-brand" href="/">ROULO <b>POKER</b></a><div><a href="/history">Hand history</a><button className="profile-back" onClick={() => router.push("/")}>← Lobby</button></div></header>
    {message && <p className="profile-message" role="status">{message}</p>}
    <section className="profile-hero">
      <div className="profile-avatar">{profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>♠</span>}</div>
      <div><span className="profile-kicker">PLAYER PROFILE</span><h1>{profile.discord_name || "Poker Player"}</h1><p>{profile.bio || "A Roulo Poker player."}</p></div>
      {ownProfile && <span className="profile-owner-tag">YOUR PROFILE</span>}
    </section>
    {ownProfile && <form className="profile-edit-panel" onSubmit={saveProfile}>
      <div><span className="profile-kicker">PERSONALISE YOUR PROFILE</span><h2>Edit player details</h2></div>
      <label>Display name<input maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="Your poker name" /></label>
      <label>Bio<textarea maxLength={240} rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="A short introduction…" /></label>
      <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
    </form>}
    <section className="profile-stats-grid">
      <article><span>HANDS PLAYED</span><strong>{Number(stats?.hands_played || 0).toLocaleString()}</strong></article>
      <article><span>HANDS WON</span><strong>{Number(stats?.hands_won || 0).toLocaleString()}</strong></article>
      <article><span>WIN RATE</span><strong>{winRate.toFixed(1)}%</strong></article>
      <article><span>BIGGEST POT WON</span><strong>{Number(stats?.biggest_pot || 0).toLocaleString()}</strong></article>
      <article><span>TOTAL CHIPS WON</span><strong>{Number(stats?.total_chips_won || 0).toLocaleString()}</strong></article>
      <article><span>NET CHIP RESULT</span><strong className={Number(stats?.net_chips || 0) >= 0 ? "result-positive" : "result-negative"}>{Number(stats?.net_chips || 0) > 0 ? "+" : ""}{Number(stats?.net_chips || 0).toLocaleString()}</strong></article>
    </section>
    <section className="profile-history-section"><div className="profile-section-heading"><div><span className="profile-kicker">RECENT RESULTS</span><h2>Hand history</h2></div>{ownProfile && <a href="/history">View all hands →</a>}</div>
      {hands.length ? <div className="history-list">{hands.map(hand => <Result key={hand.id} hand={hand} />)}</div> : <div className="profile-empty">No completed hands recorded yet. Your results will appear here after your next finished hand.</div>}
    </section>
  </main>;
}
