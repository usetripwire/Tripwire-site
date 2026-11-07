/*
 * Tripwire site settings. Edit these before you deploy.
 *
 * rpcUrl     Solana RPC the Quick Scan calls from the visitor's browser.
 *            The free public endpoint works but is heavily rate limited.
 *            For launch, create a free Helius (or Triton/QuickNode) key and
 *            RESTRICT IT TO YOUR DOMAIN in their dashboard, since anything
 *            in this file is visible to visitors.
 * xHandle    The bot's X handle, without the @.
 * siteUrl    Your live domain, no trailing slash (used for share links).
 * tokenCA    Leave empty until $TRIP launches. Once set, it shows in the footer.
 * contact    Email shown on the Terms and Privacy pages.
 * apiUrl     Your Tripwire server (the bot folder), e.g. "https://tripwire-bot.up.railway.app".
 *            When set, scans run all eight wires there and the "With X bot" labels flip to "Live now".
 *            Leave empty to run only the three-wire Quick Scan in the browser.
 * botLive    Set to true once @TripwireScan is posting replies, to mark the X bot section as live.
 */
window.TRIPWIRE_CONFIG = {
  apiUrl: "",
  botLive: false,
  rpcUrl: "https://api.mainnet-beta.solana.com",
  xHandle: "TripwireScan",
  siteUrl: "https://tripwire.example",
  tokenCA: "",
  contact: "hello@tripwire.example"
};
