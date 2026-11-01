import "./globals.css";

export const metadata = {
  title: "Roulo Poker",
  description: "Join a private Texas Hold’em table with Roulo Poker.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
