# Roulo Poker

A private Texas Hold’em table lobby built with Next.js, Supabase and Discord sign-in.

## Features
- Discord authentication
- Create public or invite-only poker tables
- Join waiting tables
- Live lobby and seat updates through Supabase Realtime
- Virtual play chips only

## Setup
1. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. Run the Supabase setup SQL files in order in the Supabase SQL Editor.
3. Configure the Discord OAuth provider and redirect URLs in Supabase.
4. Run `npm install` and `npm run dev`.

The current table view is a lobby/seat prototype. Full hand progression, betting actions and showdown settlement are separate poker-engine work and should not be considered complete yet.
