
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chips, setChips] = useState(1000);
  const [bet, setBet] = useState(50);
  const [message, setMessage] = useState("Welcome to Trashguy Poker!");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) setMessage(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMessage("You have signed out.");
  }

  function placeBet() {
    if (!user) {
      setMessage("Sign in with Discord before playing.");
      return;
    }
    if (bet > chips) {
      setMessage("Not enough chips!");
      return;
    }
    setChips(chips - bet);
    setMessage(`You bet ${bet} virtual chips!`);
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#080d0b",
      color: "white",
      fontFamily: "Arial, sans-serif",
      padding: "30px 16px"
    }}>
      <header style={{textAlign:"center", marginBottom:30}}>
        <h1 style={{fontSize:38,fontWeight:900,color:"#7dff69"}}>
          TRASHGUY POKER
        </h1>
        <p style={{color:"#9ca99f"}}>THE HOME OF THE TABLE</p>
      </header>

      <section style={{
        maxWidth:850, margin:"auto", textAlign:"center",
        background:"#101c15", border:"2px solid #355c3b",
        borderRadius:25, padding:25
      }}>
        <h2 style={{color:"#7dff69"}}>PLAYER ACCOUNT</h2>

        {loading ? <p>Checking login...</p> : user ? (
          <>
            <p>Signed in as <strong>
              {user.user_metadata?.full_name ||
               user.user_metadata?.name || user.email || "Discord player"}
            </strong></p>
            <button onClick={signOut} style={button("#444")}>
              SIGN OUT
            </button>
          </>
        ) : (
          <>
            <p>Sign in to join the poker table.</p>
            <button onClick={signIn} style={button("#5865F2")}>
              SIGN IN WITH DISCORD
            </button>
          </>
        )}

        <hr style={{borderColor:"#355c3b",margin:"25px 0"}}/>

        <p style={{color:"#7dff69",fontWeight:"bold"}}>
          TEXAS HOLD'EM · VIRTUAL CHIPS
        </p>

        <div style={{
          background:"#12512f", border:"12px solid #392a20",
          borderRadius:"50%", minHeight:300, display:"flex",
          flexDirection:"column",alignItems:"center",
          justifyContent:"center",margin:"25px 0"
        }}>
          <h2>TRASHGUY TABLE</h2>
          <p>COMMUNITY CARDS</p>
          <div style={{display:"flex",gap:10}}>
            {["A♠","K♥","7♦","?","?"].map((card,i)=>(
              <div key={i} style={{
                background:"white",color:i===1?"#d22":"#111",
                borderRadius:8,padding:"12px 10px",
                fontSize:22,fontWeight:"bold"
              }}>{card}</div>
            ))}
          </div>
          <p>Pot: 150 chips</p>
        </div>

        <h3>{user ? "YOUR SEAT" : "GUEST SEAT"}</h3>
        <p style={{color:"#7dff69"}}>{chips.toLocaleString()} virtual chips</p>

        <p>{message}</p>
        <label>Bet amount: {bet} chips</label>
        <input type="range" min="10" max="500" step="10"
          value={bet}
          onChange={(e)=>setBet(Number(e.target.value))}
          style={{display:"block",width:"100%",margin:"15px auto"}}
        />

        <button onClick={placeBet} style={button("#247d43")}>
          CALL / BET
        </button>
      </section>

      <footer style={{textAlign:"center",color:"#65756a",marginTop:30}}>
        TRASHGUY POKER · PLAY FOR FUN WITH VIRTUAL CHIPS
      </footer>
    </main>
  );
}

function button(color) {
  return {
    background:color,color:"white",border:0,
    borderRadius:10,padding:"13px 22px",
    fontWeight:"bold",cursor:"pointer",margin:8
  };
}
