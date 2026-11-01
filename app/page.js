"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const panel = {
  background: "#101c15",
  border: "1px solid #31543a",
  borderRadius: 18,
  padding: 20
};

const button = (background, disabled = false) => ({
  background,
  color: "#fff",
  border: 0,
  borderRadius: 10,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1
});

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState([]);
  const [tableName, setTableName] = useState("");
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
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
    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setMessage(error.message);
      setUser(data.user);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
      .channel("trashguy-poker-lobby")
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
    else setMessage(`You've joined ${table.name}. Poker gameplay is the next build stage.`);
    await loadTables();
  }

  const displayName = user?.user_metadata?.full_name ||
    user?.user_metadata?.name || "Discord player";

  return (
    <main style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at top, #173b25 0%, #080d0b 55%)",
      color: "#f4f8f3",
      fontFamily: "Arial, sans-serif",
      padding: "28px 16px"
    }}>
      <header style={{maxWidth:1100, margin:"0 auto 28px", display:"flex",
        justifyContent:"space-between", alignItems:"center", gap:16, flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:34, margin:0, color:"#7dff69", letterSpacing:1}}>TRASHGUY POKER</h1>
          <p style={{color:"#a8b9aa", margin:"7px 0 0"}}>THE HOME OF THE TABLE</p>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
          {loading ? <span>Checking account…</span> : user ? <>
            <span>Playing as <strong>{displayName}</strong></span>
            <button onClick={signOut} style={button("#34443a")}>SIGN OUT</button>
          </> : <button onClick={signIn} style={button("#5865F2")}>SIGN IN WITH DISCORD</button>}
        </div>
      </header>

      <section style={{maxWidth:1100, margin:"0 auto", ...panel}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap"}}>
          <div>
            <h2 style={{margin:"0 0 6px", color:"#7dff69"}}>POKER LOBBY</h2>
            <p style={{margin:0, color:"#a8b9aa"}}>Find a table or create your own private game.</p>
          </div>
          <span style={{color:"#a8b9aa"}}>{tables.length} waiting table{tables.length === 1 ? "" : "s"}</span>
        </div>

        {message && <p role="status" style={{background:"#17291d", border:"1px solid #426b49", padding:12, borderRadius:10, overflowWrap:"anywhere"}}>{message}</p>}

        <div style={{marginTop:24}}>
          {!user && <div style={{background:"#17291d",border:"1px solid #426b49",padding:14,borderRadius:10,marginBottom:16}}>
            <strong>Sign in with Discord to create or join a table.</strong>
            <button onClick={signIn} style={{...button("#5865F2"),marginLeft:12}}>SIGN IN WITH DISCORD</button>
          </div>}
          <form onSubmit={createTable} style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))", gap:12, alignItems:"end", opacity:user?1:0.65}}>
            <label style={{display:"grid", gap:7, color:"#c9d8ca"}}>
              Table name
              <input required maxLength={40} disabled={!user} value={tableName} onChange={e=>setTableName(e.target.value)} placeholder="Friday Night Poker" style={field}/>
            </label>
            <label style={{display:"grid", gap:7, color:"#c9d8ca"}}>
              Small blind
              <input type="number" min="1" disabled={!user} value={smallBlind} onChange={e=>setSmallBlind(e.target.value)} style={field}/>
            </label>
            <label style={{display:"grid", gap:7, color:"#c9d8ca"}}>
              Big blind
              <input type="number" min="1" disabled={!user} value={bigBlind} onChange={e=>setBigBlind(e.target.value)} style={field}/>
            </label>
            <label style={{display:"grid", gap:7, color:"#c9d8ca"}}>
              Seats
              <select disabled={!user} value={maxPlayers} onChange={e=>setMaxPlayers(e.target.value)} style={field}>
                {[2,3,4,5,6,7,8,9].map(n=><option key={n} value={n}>{n} players</option>)}
              </select>
            </label>
            <label style={{display:"flex", alignItems:"center", gap:8, color:"#c9d8ca", padding:"12px 0"}}>
              <input type="checkbox" disabled={!user} checked={isPrivate} onChange={e=>setIsPrivate(e.target.checked)}/> Private table
            </label>
            <button type="submit" disabled={!user || busy} style={button("#247d43", !user || busy)}>CREATE TABLE</button>
          </form>
        </div>

          <div style={{marginTop:28}}>
            <h3 style={{color:"#7dff69"}}>AVAILABLE TABLES</h3>
            {tables.filter(t=>!t.is_private || t.owner_id === user.id).length === 0
              ? <p style={{color:"#a8b9aa"}}>No public waiting tables yet. Create one and invite your friends.</p>
              : <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(245px,1fr))", gap:14}}>
                {tables.filter(t=>!t.is_private || t.owner_id === user.id).map(table=><article key={table.id} style={{background:"#0b140e", border:"1px solid #31543a", borderRadius:14, padding:16}}>
                  <div style={{display:"flex", justifyContent:"space-between", gap:8}}>
                    <strong>{table.name}</strong>
                    <span style={{color:table.is_private ? "#f4c56a" : "#7dff69", fontSize:12}}>{table.is_private ? "PRIVATE" : "PUBLIC"}</span>
                  </div>
                  <p style={{color:"#a8b9aa", margin:"10px 0"}}>{table.small_blind}/{table.big_blind} blinds · {table.max_players} seats</p>
                  <p style={{color:"#a8b9aa"}}>{table.poker_seats?.length || 0} players seated</p>
                  {table.is_private && table.invite_code && <p style={{color:"#f4c56a"}}>Invite code: <strong>{table.invite_code}</strong></p>}
                  <button disabled={busy || (table.poker_seats?.length || 0) >= table.max_players} onClick={()=>joinTable(table)} style={button("#247d43", busy || (table.poker_seats?.length || 0) >= table.max_players)}>
                    {(table.poker_seats?.length || 0) >= table.max_players ? "TABLE FULL" : "JOIN TABLE"}
                  </button>
                </article>)}
              </div>}
          </div>
          <button onClick={loadTables} style={{...button("#34443a"), marginTop:18}}>REFRESH LOBBY</button>
        </>}
      </section>
      <footer style={{textAlign:"center", color:"#718477", marginTop:28}}>TRASHGUY POKER · VIRTUAL PLAY CHIPS ONLY</footer>
    </main>
  );
}

const field = {
  width: "100%",
  minWidth: 0,
  background: "#08110b",
  color: "#fff",
  border: "1px solid #426b49",
  borderRadius: 9,
  padding: "12px 10px"
};
