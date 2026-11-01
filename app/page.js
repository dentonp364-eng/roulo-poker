"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState([]);
  const [tableName, setTableName] = useState("");
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTables = useCallback(async () => {
    const { data, error } = await supabase
      .from("poker_tables")
      .select("id,name,owner_id,small_blind,big_blind,max_players,is_private,status,created_at,invite_code,poker_seats(id,player_id,seat_number)")
      .eq("status", "waiting")
      .order("created_at", { ascending: false });
    if (error) {
      setMessage(error.message);
      return;
    }
    setTables(data || []);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error) setMessage(error.message);
      setUser(data.user);
      if (data.user) {
        const { data: adminAccess } = await supabase.rpc("is_poker_admin");
        if (!mounted) return;
        setIsAdmin(adminAccess === true);
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      if (!nextUser) setIsAdmin(false);
      else supabase.rpc("is_poker_admin").then(({ data }) => setIsAdmin(data === true));
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setTables([]);
      return;
    }
    loadTables();
    const channel = supabase
      .channel("roulo-poker-lobby")
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_tables" }, loadTables)
      .on("postgres_changes", { event: "*", schema: "public", table: "poker_seats" }, loadTables)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadTables]);

  async function signIn() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin }
    });
    if (error) setMessage(error.message);
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(error.message);
    else setMessage("Signed out.");
  }

  async function createTable(event) {
    event.preventDefault();
    if (!user || busy) return;
    if (Number(bigBlind) <= Number(smallBlind)) {
      setMessage("The big blind must be greater than the small blind.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("create_poker_table", {
      p_name: tableName,
      p_small_blind: Number(smallBlind),
      p_big_blind: Number(bigBlind),
      p_max_players: Number(maxPlayers),
      p_is_private: isPrivate
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setTableName("");
    setMessage(isPrivate
      ? `Private table created. Invite code: ${data.invite_code}`
      : "Table created. You're seated!");
    await loadTables();
    if (data && data.table_id) window.location.href = "/table/" + data.table_id;
  }

  async function joinTable(table) {
    if (!user || busy) return;
    let code = null;
    if (table.is_private) {
      code = window.prompt("Enter the private table invite code:");
      if (!code) return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("join_poker_table", {
      p_table_id: table.id,
      p_invite_code: code
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage(`You've joined ${table.name}. Opening table…`);
      window.location.href = "/table/" + table.id;
    }
    await loadTables();
  }

  const displayName = user?.user_metadata?.full_name ||
    user?.user_metadata?.name || "Discord player";
  const visibleTables = tables.filter(t => !t.is_private || t.owner_id === user?.id);
  const seatedPlayers = visibleTables.reduce((total, table) => total + (table.poker_seats?.length || 0), 0);

  return (
    <main className="lobby-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Roulo Poker home">
          <span className="brand-wordmark">ROULO</span>
          <span className="brand-name"><b>POKER</b></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-active" href="/">Poker lobby</a>
          <a href="/history">Hand history</a>
          {user && <a href={"/profile/" + user.id}>My profile</a>}
          {user && isAdmin && <a href="/admin">Admin</a>}
          <span>Texas Hold’em</span>
        </nav>
        <div className="account-area">
          {loading ? <span className="muted">Checking account…</span> : user ? <>
            <span className="signed-in">Playing as <strong>{displayName}</strong></span>
            <button className="button button-quiet" onClick={signOut}>Sign out</button>
          </> : <button className="button button-discord" onClick={signIn}>Sign in with Discord</button>}
        </div>
      </header>

      <section className="hero-strip">
        <div>
          <div className="eyebrow"><span className="live-dot" /> PRIVATE GAMES. YOUR TABLE.</div>
          <h1>Find your <span>seat.</span></h1>
          <p>A clean place to play Texas Hold’em with your people.</p>
        </div>
        <div className="hero-stat">
          <span className="stat-number">{visibleTables.length}</span>
          <span className="stat-label">TABLES WAITING</span>
        </div>
      </section>

      {message && <p role="status" className="status-message">{message}</p>}

      <section className="lobby-grid">
        <div className="panel create-panel">
          <div className="section-heading">
            <div><span className="eyebrow">SET UP A GAME</span><h2>Create a table</h2></div>
            <span className="heading-icon">＋</span>
          </div>
          {!user && <div className="signin-note">
            <span>Sign in with Discord to create or join a table.</span>
            <button className="button button-discord" onClick={signIn}>Connect Discord</button>
          </div>}
          <form onSubmit={createTable} className="table-form">
            <label className="form-field field-wide">Table name
              <input required maxLength={40} disabled={!user} value={tableName} onChange={e => setTableName(e.target.value)} placeholder="Friday Night Poker" />
            </label>
            <label className="form-field">Small blind
              <input type="number" min="1" disabled={!user} value={smallBlind} onChange={e => setSmallBlind(e.target.value)} />
            </label>
            <label className="form-field">Big blind
              <input type="number" min="2" disabled={!user} value={bigBlind} onChange={e => setBigBlind(e.target.value)} />
            </label>
            <label className="form-field">Seats
              <select disabled={!user} value={maxPlayers} onChange={e => setMaxPlayers(e.target.value)}>
                {[2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n} players</option>)}
              </select>
            </label>
            <label className="check-field">
              <input type="checkbox" disabled={!user} checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
              <span>Private table</span>
            </label>
            <button type="submit" disabled={!user || busy} className="button button-primary submit-button">{busy ? "Please wait…" : "Create table"} <span>→</span></button>
          </form>
          <p className="panel-footnote">Virtual play chips only · No cash stakes</p>
        </div>

        <div className="panel tables-panel">
          <div className="section-heading">
            <div><span className="eyebrow">JUMP INTO A GAME</span><h2>Available tables</h2></div>
            <button className="button button-quiet refresh-button" onClick={loadTables}>↻ Refresh</button>
          </div>
          {visibleTables.length === 0 ? (
            <div className="empty-state">
              <div className="empty-symbol">♠</div>
              <strong>No tables waiting just yet</strong>
              <p>Be the first to open a table, then invite your friends to join.</p>
            </div>
          ) : (
            <div className="table-list">
              {visibleTables.map(table => {
                const seated = table.poker_seats?.length || 0;
                const full = seated >= table.max_players;
                return <article className="table-row" key={table.id}>
                  <div className="table-type-icon">♠</div>
                  <div className="table-info">
                    <strong>{table.name}</strong>
                    <span>{table.is_private ? "Private game" : "Public game"} · {table.small_blind}/{table.big_blind} blinds</span>
                  </div>
                  <div className="table-seats"><strong>{seated}/{table.max_players}</strong><span>PLAYERS</span></div>
                  <button disabled={busy || full} onClick={() => joinTable(table)} className={`button ${full ? "button-quiet" : "button-outline"}`}>{full ? "Full" : "Join"}</button>
                </article>;
              })}
            </div>
          )}
        </div>
        <aside className="lobby-aside">
          <div className="roulo-feature">
            <div className="feature-cards"><span>A♠</span><span>A♥</span></div>
            <div className="feature-chip">R</div>
            <strong>ROULO <b>POKER</b></strong>
            <small>YOUR TABLE. YOUR GAME.</small>
          </div>
          <div className="panel lobby-stats">
            <div className="section-heading"><h2>Lobby stats</h2><span className="live-label"><i/> LIVE</span></div>
            <div className="stats-grid">
              <div><strong>{seatedPlayers}</strong><span>Players seated</span></div>
              <div><strong>{visibleTables.length}</strong><span>Active tables</span></div>
              <div><strong>0</strong><span>Tournaments</span></div>
            </div>
          </div>
          <div className="panel quick-info"><span className="eyebrow">THE GAME</span><h3>Texas Hold’em</h3><p>Join a table, take a seat and play with virtual chips.</p></div>
        </aside>
      </section>
      <footer className="site-footer"><span>ROULO POKER</span><span>Texas Hold’em · Virtual play chips only</span></footer>
    </main>
  );
}
