"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tables, setTables] = useState([]);
  const [players, setPlayers] = useState([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const loadAdmins = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) setMessage(error.message); else setPlayers(Array.isArray(data) ? data : []);
  }, []);

  const loadTables = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_poker_tables");
    if (error) setMessage(error.message);
    else setTables(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    let alive = true;
    async function checkAccess() {
      const { data: auth } = await supabase.auth.getUser();
      if (!alive) return;
      setUser(auth.user || null);
      if (!auth.user) { setChecking(false); return; }
      const { data, error } = await supabase.rpc("is_poker_admin");
      if (!alive) return;
      if (error) setMessage(error.message);
      const allowed = data === true;
      setAuthorized(allowed);
      if (allowed) { await loadTables(); await loadAdmins(); }
      setChecking(false);
    }
    checkAccess();
    return () => { alive = false; };
  }, [loadTables, loadAdmins]);

  async function runAction(key, rpc, args, success) {
    if (busy) return;
    setBusy(key); setMessage("");
    const { error } = await supabase.rpc(rpc, args);
    setBusy("");
    if (error) setMessage(error.message);
    else { setMessage(success); await loadTables(); await loadAdmins(); }
  }

  async function assignAdmin(event) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy("assign"); setMessage("");
    const { error } = await supabase.rpc("admin_assign_role_by_email", { p_email: email.trim() });
    setBusy("");
    if (error) setMessage(error.message);
    else { setMessage("Admin role assigned."); setEmail(""); await loadAdmins(); }
  }

  const totalPlayers = tables.reduce((sum, t) => sum + Number(t.players || 0), 0);
  const activeTables = tables.filter(t => t.status === "waiting").length;

  if (checking) return <main className="admin-shell"><p>Checking admin access…</p></main>;
  if (!user) return <main className="admin-shell"><section className="admin-gate"><span className="admin-kicker">ROULO POKER</span><h1>Admin sign in required</h1><p>Sign in with your approved account, then return here.</p><button onClick={() => router.push("/")}>Go to lobby</button></section></main>;
  if (!authorized) return <main className="admin-shell"><section className="admin-gate"><span className="admin-kicker">RESTRICTED AREA</span><h1>Admin access only</h1><p>This account has not been added to the Roulo Poker admin list.</p><button onClick={() => router.push("/")}>Back to lobby</button></section></main>;

  return <main className="admin-shell">
    <header className="admin-topbar"><a className="admin-brand" href="/">ROULO <b>POKER</b></a><div><span className="admin-kicker">CONTROL ROOM</span><h1>Admin panel</h1></div><button className="admin-secondary" onClick={() => router.push("/")}>← Lobby</button></header>
    {message && <div className="admin-message" role="status">{message}</div>}
    <section className="admin-metrics">
      <article><span>ALL TABLES</span><strong>{tables.length}</strong></article>
      <article><span>OPEN TABLES</span><strong>{activeTables}</strong></article>
      <article><span>PLAYERS SEATED</span><strong>{totalPlayers}</strong></article>
    </section>
    <section className="admin-panel admin-users-panel">
      <div className="admin-section-head"><div><span className="admin-kicker">PERMISSIONS</span><h2>Admin role management</h2><p>Promote registered users by email or revoke their access.</p></div></div>
      <form className="admin-promote-form" onSubmit={assignAdmin}>
        <label htmlFor="admin-email">Registered player email</label>
        <div><input id="admin-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="player@example.com" /><button type="submit" disabled={!!busy}>{busy === "assign" ? "Assigning…" : "＋ Assign admin"}</button></div>
      </form>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>USER</th><th>EMAIL</th><th>ROLE</th><th>ACTION</th></tr></thead><tbody>
        {players.map(p => <tr key={p.id}><td><strong>{p.display_name || "Poker player"}</strong><small>{p.id.slice(0,8)}…</small></td><td>{p.email || "No email"}</td><td><span className={p.is_admin ? "admin-status-open" : "admin-status-closed"}>{p.is_admin ? "Admin" : "Player"}</span></td><td>{p.is_admin ? <button className="admin-revoke" disabled={!!busy || p.id === user.id} onClick={() => { if (window.confirm("Revoke admin access for "+(p.email || p.display_name)+"?")) runAction("revoke-"+p.id,"admin_revoke_role",{p_user_id:p.id},"Admin role revoked."); }}>Revoke</button> : "—"}</td></tr>)}
        {players.length === 0 && <tr><td colSpan="4">No registered player accounts found.</td></tr>}
      </tbody></table></div>
      <p className="admin-footnote">The first administrator must be added once in Supabase SQL Editor. You cannot revoke your own role from this screen.</p>
    </section>
    <section className="admin-panel">
      <div className="admin-section-head"><div><span className="admin-kicker">ROOM MANAGEMENT</span><h2>Table management</h2><p>Close games, remove players or permanently delete unwanted tables.</p></div><button className="admin-secondary" disabled={!!busy} onClick={loadTables}>↻ Refresh</button></div>
      {tables.length === 0 ? <div className="admin-empty">No poker tables have been created yet.</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>TABLE</th><th>BLINDS</th><th>PLAYERS</th><th>TYPE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
        {tables.map(t => <tr key={t.id}><td><strong>{t.name}</strong><small>{String(t.id).slice(0,8)}…</small></td><td>{t.small_blind}/{t.big_blind}</td><td>{t.players}/{t.max_players}</td><td>{t.is_private ? "Private" : "Public"}</td><td><span className={t.status === "waiting" ? "admin-status-open" : "admin-status-closed"}>{t.status}</span></td><td className="admin-actions">
          {t.status === "waiting" ? <button disabled={!!busy} onClick={() => runAction("close-"+t.id,"admin_set_poker_table_status",{p_table_id:t.id,p_status:"closed"},"Table closed.")}>Close</button> : <button disabled={!!busy} onClick={() => runAction("open-"+t.id,"admin_set_poker_table_status",{p_table_id:t.id,p_status:"waiting"},"Table reopened.")}>Reopen</button>}
          <button className="admin-delete" disabled={!!busy} onClick={() => { if (window.confirm("Permanently delete “"+t.name+"” and its seats/hand data? This cannot be undone.")) runAction("delete-"+t.id,"admin_delete_poker_table",{p_table_id:t.id},"Table deleted."); }}>Delete</button>
        </td></tr>)}
      </tbody></table></div>}
    </section>
    <p className="admin-footnote">Admin actions are checked by Supabase on the server. Only user IDs explicitly added to poker_admins can manage tables.</p>
  </main>;
}
