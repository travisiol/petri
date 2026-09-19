/* Dev-only EIP-1193 provider for the local rehearsal. Never holds a key: transactions go out as eth_sendTransaction to
   the local node, which signs for its own unlocked accounts. Add ?devwallet to any page (or set localStorage
   "petri:dev-wallet" to {"rpc":"http://127.0.0.1:8719","address":"0x…"}) — a plain page keeps your real wallet. */
(function () {
  var cfg = null;
  try {
    var q = new URLSearchParams(location.search);
    if (q.has("devwallet")) { cfg = { rpc: q.get("rpc") || "http://127.0.0.1:8719", address: q.get("devwallet") || "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc" }; localStorage.setItem("petri:dev-wallet", JSON.stringify(cfg)); }
    else if (q.has("nodevwallet")) localStorage.removeItem("petri:dev-wallet");
    else { var raw = localStorage.getItem("petri:dev-wallet"); if (raw) cfg = JSON.parse(raw); }
  } catch (e) {}
  if (!cfg) return;
  var id = 1, listeners = {};
  function rpc(method, params) {
    return fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: method, params: params || [] }) })
      .then(function (r) { return r.json(); }).then(function (j) { if (j.error) { var e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; });
  }
  var provider = {
    isMetaMask: true, isPetriDev: true,
    request: function (args) {
      var m = args.method, p = args.params || [];
      if (m === "eth_requestAccounts" || m === "eth_accounts") return Promise.resolve([cfg.address]);
      if (m === "wallet_switchEthereumChain" || m === "wallet_addEthereumChain") return Promise.resolve(null);
      if (m === "wallet_getPermissions" || m === "wallet_requestPermissions") return Promise.resolve([{ parentCapability: "eth_accounts" }]);
      if (m === "eth_sendTransaction") { var tx = Object.assign({}, p[0], { from: cfg.address }); delete tx.gas; return rpc("eth_sendTransaction", [tx]); }
      return rpc(m, p);
    },
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return provider; },
    removeListener: function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); return provider; },
  };
  window.ethereum = provider;
  console.log("[petri] dev wallet provider installed for", cfg.address);
})();
