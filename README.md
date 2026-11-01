# Roulo Poker

A private Texas Hold’em table lobby built with Next.js, Supabase and Discord sign-in.

## Features
- Discord authentication
- Create public or invite-only poker tables
- Join waiting tables
- Live lobby, seat and hand-state updates through Supabase Realtime
- Private hole cards (each player can read only their own cards)
- Server-side turn validation for fold, check, call, bet and raise actions
- Automatic flop, turn and river dealing
- Seven-card hand evaluation and basic showdown pot splitting
- Admin player and table management
- Virtual play chips only; no cash stakes

## Setup
1. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Run the Supabase setup SQL files in order in the Supabase SQL Editor.
3. Whenever `supabase/poker_engine.sql` changes, re-run the complete file in the SQL Editor so its functions are updated.
4. Configure the Discord OAuth provider and redirect URLs in Supabase.
5. Run `npm install` and `npm run dev`.

## Current engine scope
The table supports dealing, private hole-card reads, server-validated fold/check/call/bet/raise actions, street progression and basic showdown evaluation. This is an early virtual-chip implementation, not yet a production-certified poker engine. Side-pot accounting, robust all-in runouts, minimum-raise/re-raise rules, timeouts, reconnect recovery and broader concurrency testing still need to be completed before treating it as a full rules-complete game.
