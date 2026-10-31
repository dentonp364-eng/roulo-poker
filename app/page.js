
"use client";

import { useState } from "react";

export default function Home() {
  const [chips, setChips] = useState(1000);
  const [bet, setBet] = useState(50);
  const [message, setMessage] = useState("Welcome to Trashguy Poker!");
  const [folded, setFolded] = useState(false);

  function placeBet() {
    if (bet > chips) {
      setMessage("Not enough chips!");
      return;
    }
    setChips(chips - bet);
    setMessage(`You called ${bet} chips!`);
  }

  function newHand() {
    setFolded(false);
    setMessage("New hand started. Good luck!");
    setBet(50);
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#080d0b",
      color: "white",
      fontFamily: "Arial, sans-serif",
      padding: "30px 16px"
    }}>
      <header style={{textAlign:"center", marginBottom:35}}>
        <h1 style={{fontSize:38, fontWeight:900, color:"#7dff69"}}>
          TRASHGUY POKER
        </h1>
        <p style={{color:"#9ca99f"}}>THE HOME OF THE TABLE</p>
      </header>

      <section style={{
        maxWidth:850,
        margin:"auto",
        background:"#101c15",
        border:"2px solid #355c3b",
        borderRadius:30,
        padding:25,
        textAlign:"center"
      }}>
        <p style={{color:"#7dff69", fontWeight:"bold"}}>
          TEXAS HOLD'EM · PLAY CHIPS
        </p>

        <div style={{
          background:"#12512f",
          border:"12px solid #392a20",
          borderRadius:"50%",
          minHeight:300,
          display:"flex",
          flexDirection:"column",
          alignItems:"center",
          justifyContent:"center",
          margin:"25px 0",
          boxShadow:"inset 0 0 35px #061b0d"
        }}>
          <h2 style={{fontSize:24}}>TRASHGUY TABLE</h2>
          <p style={{color:"#c8e8cc"}}>COMMUNITY CARDS</p>
          <div style={{display:"flex", gap:10, margin:15}}>
            {["A♠","K♥","7♦","?","?"].map((card,i)=>(
              <div key={i} style={{
                background:"white",
                color:i===1?"#d22":"#111",
                borderRadius:8,
                padding:"12px 10px",
                fontSize:22,
                fontWeight:"bold",
                minWidth:30
              }}>{card}</div>
            ))}
          </div>
          <p>Pot: 150 chips</p>
        </div>

        <div style={{
          display:"flex",
          justifyContent:"space-around",
          flexWrap:"wrap",
          gap:15
        }}>
          <div>
            <p style={{color:"#aab7ad"}}>YOUR SEAT</p>
            <h3>TRASHGUY</h3>
            <p style={{color:"#7dff69"}}>{chips.toLocaleString()} chips</p>
          </div>
          <div>
            <p style={{color:"#aab7ad"}}>OPPONENT</p>
            <h3>PLAYER 2</h3>
            <p>1,000 chips</p>
          </div>
        </div>

        <div style={{marginTop:25}}>
          <p>{message}</p>
          <label>Raise amount: {bet} chips</label>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={bet}
            onChange={(e)=>setBet(Number(e.target.value))}
            style={{display:"block", width:"100%", margin:"15px auto"}}
          />
          <div style={{
            display:"flex",
            justifyContent:"center",
            flexWrap:"wrap",
            gap:10
          }}>
            <button onClick={()=>setFolded(true) || setMessage("You folded this hand.")} style={btn("#444")}>FOLD</button>
            <button onClick={placeBet} style={btn("#247d43")}>CALL / BET</button>
            <button onClick={newHand} style={btn("#78c85c")}>NEW HAND</button>
          </div>
          {folded && <p style={{color:"#ffb36b"}}>Hand folded</p>}
        </div>
      </section>
      <footer style={{textAlign:"center", color:"#65756a", marginTop:30}}>
        TRASHGUY POKER · PLAY FOR FUN WITH VIRTUAL CHIPS
      </footer>
    </main>
  );
}

function btn(color) {
  return {
    background:color,
    color:"white",
    border:0,
    borderRadius:10,
    padding:"13px 22px",
    fontWeight:"bold",
    cursor:"pointer"
  };
}
