/*
 * Tripwire site settings. Edit these before you deploy.
 *
 * rpcUrl     Solana RPC the Quick Scan calls from the visitor's browser.
 *            The free public endpoint works but is heavily rate limited.
 *            For launch, create a free Helius (or Triton/QuickNode) key and
 *            RESTRICT IT TO YOUR DOMAIN in their dashboard, since anything
 *            in this file is visible to visitors.
 * xHandle    The main Tripwire X account, without the @ (used for "Follow on X").
 * siteUrl    Your live domain, no trailing slash (used for share links).
 * tokenCA    Leave empty until $TRIP launches. Once set, it shows in the footer.
 * contact    Email shown on the Terms and Privacy pages.
 * apiUrl     Your Tripwire scan server, e.g. "https://tripwire-bot.up.railway.app".
 *            When set, scans run all eight wires there and the wire labels show "Live now".
 *            Leave empty to run only the three-wire Quick Scan in the browser.
 */
window.TRIPWIRE_CONFIG = {
  apiUrl: "https://tripwire-bot-production.up.railway.app",
  rpcUrl: "https://mainnet.helius-rpc.com/?api-key=11746151-9b56-4160-9df3-cc185ff1bfa5",
  xHandle: "usetripwire",
  siteUrl: "https://usetripwire.com",
  tokenCA: "9Teaq2XGP7EZqdd5vQLJR3kFvyWMy71SpzJLMub8pump",
  contact: "hello@tripwire.example"
};
