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
      .eq("id", tableId)
      .single();
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

  const card = (label) => <div style={{width:58,height:82,borderRadius:9,background:"#f8f4ff",color:"#21152c",display:"grid",placeItems:"center",fontSize:23,fontWeight:900,boxShadow:"0 5px 15px #08040c"}}>{label}</div>;

  if (loading) return <main style={page}><p>Loading your table…</p></main>;
  if (error || !table) return <main style={page}><button style={secondary} onClick={()=>router.push("/")}>← BACK TO LOBBY</button><p>{error || "Table not found."}</p></main>;

  return <main style={page}>
    <header style={{maxWidth:1100,margin:"0 auto 22px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div><div style={{color:"#b7ed54",fontWeight:900,letterSpacing:2,fontSize:12}}>ROULO POKER</div><h1 style={{margin:"5px 0",fontSize:30}}>{table.name}</h1><span style={{color:"#aeb8ab"}}>{table.small_blind}/{table.big_blind} blinds · {players.length}/{table.max_players} seated</span></div>
      <button style={secondary} onClick={()=>router.push("/")}>← BACK TO LOBBY</button>
    </header>
    <section style={{maxWidth:1100,margin:"auto",background:"linear-gradient(145deg,#263226,#151b16 65%,#090b0a)",border:"8px solid #526b39",borderRadius:220,padding:"48px 24px",minHeight:490,boxShadow:"0 0 45px #8fbe3844,inset 0 0 35px #08040c",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:22}}>
      <div style={{color:"#d7edb9",fontWeight:900,letterSpacing:3}}>ROULO • TEXAS HOLD’EM</div>
      <div style={{display:"flex",gap:9}}>{["A♠","K♥","Q♦","J♣","10♠"].map((v,i)=><div key={i}>{card(v)}</div>)}</div>
      <div style={{textAlign:"center",background:"#0c100dcc",border:"1px solid #526b39",borderRadius:14,padding:"12px 28px"}}>
        <div style={{fontSize:11,color:"#aeb8ab",letterSpacing:2}}>POT</div><strong style={{fontSize:28,color:"#c8f17b"}}>0</strong><div style={{fontSize:11,color:"#aeb8ab"}}>VIRTUAL CHIPS</div>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>{card("🂠")}{card("🂠")}</div>
      <div style={{color:"#d5dfd0",fontSize:13}}>Table is ready · Game engine setup is the next step</div>
    </section>
    <section style={{maxWidth:1100,margin:"22px auto",background:"#121613",border:"1px solid #29332b",borderRadius:16,padding:20}}>
      <h2 style={{marginTop:0,color:"#b7ed54"}}>PLAYERS AT THIS TABLE</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
        {Array.from({length:table.max_players},(_,i)=>players.find(p=>p.seat_number===i+1)).map((p,i)=><div key={i} style={{background:"#100b19",border:"1px solid #29332b",borderRadius:12,padding:14,minHeight:76}}>
          <div style={{color:"#b7ed54",fontSize:11,fontWeight:800}}>SEAT {i+1}</div><strong>{p?.profile?.discord_name || (p ? "Player" : "EMPTY SEAT")}</strong>{p && <div style={{color:"#aeb8ab",fontSize:13,marginTop:5}}>{Number(p.chips).toLocaleString()} chips</div>}
        </div>)}
      </div>
      <p style={{color:"#aeb8ab",marginBottom:0}}>Players joining this table will appear here automatically.</p>
    </section>
    <section style={{maxWidth:1100,margin:"0 auto 30px",display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
      {["FOLD","CHECK / CALL","BET / RAISE"].map(x=><button key={x} disabled style={{...secondary,opacity:.45,cursor:"not-allowed"}}>{x}</button>)}
    </section>
  </main>;
}

const page = {minHeight:"100vh",padding:"28px 16px",background:"radial-gradient(ellipse at top,#263226 0%,#090b0a 65%)",color:"#f4f6f1",fontFamily:"Arial,sans-serif"};
const secondary = {background:"#1b251a",color:"#fff",border:"1px solid #8054a3",borderRadius:10,padding:"12px 18px",fontWeight:800,cursor:"pointer"};
