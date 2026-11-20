(() => {
  "use strict";

  /* ================= Config & menu ================= */
  const CFG = window.APP_CONFIG || {};
  const SCRIPT_URL = (CFG.SCRIPT_URL || "").trim();
  const REMOTE = !!SCRIPT_URL;
  const POLL_MS = CFG.POLL_MS || 4000;
  const IMG = id => `https://images.unsplash.com/${id}?w=800&q=70&auto=format&fit=crop`;

  const MENU = [
    { id: "og", name: "The OG Biriyani", desc: "Biriyani + Raitha + Bread Halwa", uses: { biriyani: 1, halwa: 1 },
      img: IMG("photo-1752673508949-f4aeeaef75f0"), c: "var(--forest)", t: "var(--sun)", tag: "THE CLASSIC" },
    { id: "mass", name: "The Mass Combo", desc: "Biriyani + Raitha + Chicken 65 + Bread Halwa", uses: { biriyani: 1, chick65: 1, halwa: 1 },
      img: IMG("photo-1782541370275-6761522e39d1"), c: "var(--tomato)", t: "var(--sun)", tag: "BEST VALUE" },
    { id: "c65", name: "Chick 65", desc: "Crispy, fiery, curry-leaf fried chicken", uses: { chick65: 1 },
      img: IMG("photo-1786232461126-e27e970b003b"), c: "var(--carrot)", t: "#fff" },
    { id: "badam", name: "Badam Milk", desc: "Chilled almond milk with saffron & cardamom", uses: { badam: 1 },
      img: IMG("photo-1662192511709-e75d67367638"), c: "#6f8a00", t: "#fff", bg: "var(--kiwi)" }
  ];
  const RESOURCES = { biriyani: "Biriyani", chick65: "Chicken 65", halwa: "Bread halwa", badam: "Badam milk" };

  const DEFAULT_SETTINGS = {
    outletName: "OUTLET NAME",
    tagline: "Staff order counter",
    prices: { og: 150, mass: 200, c65: 100, badam: 40 },
    stock: { biriyani: "", chick65: "", halwa: "", badam: "" },
    upiId: "", upiName: "", qrImage: "",
    pin: "1234"
  };

  /* ================= Helpers ================= */
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const pad = n => "#" + String(n).padStart(3, "0");
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clone = o => JSON.parse(JSON.stringify(o));

  function mergeSettings(s) {
    const d = clone(DEFAULT_SETTINGS);
    s = s || {};
    return { ...d, ...s, prices: { ...d.prices, ...(s.prices || {}) }, stock: { ...d.stock, ...(s.stock || {}) } };
  }

  // Morph wrapper: uses View Transitions when the browser supports them
  function morph(fn) {
    if (document.startViewTransition && !reduced) {
      try { return document.startViewTransition(fn); } catch { fn(); }
    } else fn();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ================= State ================= */
  let orders = [];
  let settings = mergeSettings();
  let cart = {};
  let pay = "Cash";
  let view = "counter";
  let unlocked = false;
  let pending = lsGet("fo_pending", []);
  let lastHash = "";
  let knownIds = null;

  function loadInitial() {
    if (REMOTE) {
      const cache = lsGet("fo_cache", null);
      if (cache) { orders = cache.orders || []; settings = mergeSettings(cache.settings); }
      pending.forEach(op => applyOp(op));
    } else {
      orders = lsGet("fo_orders", []);
      settings = mergeSettings(lsGet("fo_settings", {}));
    }
  }

  function applyOp(op) {
    if (op.action === "addOrder") {
      if (!orders.find(o => o.id === op.order.id)) orders.push(clone(op.order));
    } else if (op.action === "updateStatus") {
      const o = orders.find(o => o.id === op.id);
      if (o) o.status = op.status;
    } else if (op.action === "saveSettings") {
      settings = mergeSettings(op.settings);
    }
  }

  function persistLocal() {
    if (REMOTE) lsSet("fo_cache", { orders, settings });
    else { lsSet("fo_orders", orders); lsSet("fo_settings", settings); }
  }

  /* ================= Sync with Google Sheet ================= */
  function setSync(state, label) {
    const p = $("#syncPill");
    p.className = "sync " + state;
    p.querySelector("span").textContent = label;
  }

  function send(op) {
    op.opId = uid();
    applyOp(op);
    persistLocal();
    if (REMOTE) {
      pending.push(op);
      lsSet("fo_pending", pending);
      flush();
    }
  }

  let flushing = false;
  async function flush() {
    if (!REMOTE || flushing || !pending.length) return;
    flushing = true;
    setSync("busy", `Saving ${pending.length}…`);
    try {
      while (pending.length) {
        const op = pending[0];
        const res = await fetch(SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(op)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Save failed");
        if (op.action === "addOrder" && data.token && data.token !== op.order.token) {
          const o = orders.find(o => o.id === op.order.id);
          if (o) o.token = data.token;
          toast(`Token clash: order changed to ${pad(data.token)}`);
        }
        pending.shift();
        lsSet("fo_pending", pending);
      }
      setSync("ok", "Live");
    } catch (e) {
      setSync("err", `Offline · ${pending.length} waiting`);
    }
    flushing = false;
  }

  async function pull() {
    if (!REMOTE) return;
    try {
      const res = await fetch(`${SCRIPT_URL}?action=state&t=${Date.now()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const before = new Set(orders.map(o => o.id));
      orders = data.orders || [];
      settings = mergeSettings(data.settings);
      pending.forEach(op => applyOp(op));
      persistLocal();
      if (!pending.length) setSync("ok", "Live");
      const fresh = orders.filter(o => !before.has(o.id) && o.status === "new");
      refresh(fresh.length > 0);
      if (fresh.length && view === "kitchen") ding();
    } catch (e) {
      setSync("err", pending.length ? `Offline · ${pending.length} waiting` : "Offline");
    }
  }

  /* ================= Stock ================= */
  const live = () => orders.filter(o => o.status !== "cancelled");
  const itemById = id => MENU.find(m => m.id === id);
  const price = id => Number(settings.prices[id]) || 0;

  function usedOf(res, includeCart = true) {
    let n = 0;
    live().forEach(o => o.items.forEach(it => { n += (itemById(it.id)?.uses[res] || 0) * it.qty; }));
    if (includeCart) Object.entries(cart).forEach(([id, q]) => { n += (itemById(id)?.uses[res] || 0) * q; });
    return n;
  }
  function stockOf(res) {
    const v = settings.stock[res];
    return v === "" || v === null || v === undefined ? Infinity : Number(v);
  }
  function remainingRes(res, includeCart = true) { return stockOf(res) - usedOf(res, includeCart); }
  function canAdd(id) {
    const m = itemById(id);
    return Object.entries(m.uses).every(([r, n]) => remainingRes(r) >= n);
  }
  function leftFor(id) {
    const m = itemById(id);
    let left = Infinity;
    Object.entries(m.uses).forEach(([r, n]) => { left = Math.min(left, Math.floor(remainingRes(r, false) / n)); });
    return left;
  }

  const nextToken = () => orders.reduce((m, o) => Math.max(m, Number(o.token) || 0), 0) + 1;
  const cartTotal = () => Object.entries(cart).reduce((s, [id, q]) => s + price(id) * q, 0);
  const cartCount = () => Object.values(cart).reduce((s, q) => s + q, 0);

  /* ================= Counter ================= */
  function buildMenu() {
    $("#menu").innerHTML = MENU.map((m, i) => `
      <article class="item" data-id="${m.id}" style="--i:${i};--c:${m.c}">
        <div class="item-img" data-add="${m.id}" style="${m.bg ? `background:${m.bg}` : ""}">
          <div class="fallback">${esc(m.name)}</div>
          <img src="${m.img}" alt="${esc(m.name)}" loading="eager" onerror="this.remove()">
          ${m.tag ? `<span class="tag">${m.tag}</span>` : ""}
          <span class="left" hidden></span>
        </div>
        <div class="item-body">
          <div class="item-name">${esc(m.name)}</div>
          <div class="item-desc">${esc(m.desc)}</div>
          <div class="item-foot">
            <div class="price"></div>
            <div class="ctrl"></div>
          </div>
        </div>
      </article>`).join("");
  }

  function updateMenu(bumpId) {
    MENU.forEach(m => {
      const card = $(`.item[data-id="${m.id}"]`);
      const q = cart[m.id] || 0;
      const left = leftFor(m.id);
      const soldOut = left <= 0;
      card.classList.toggle("sold", soldOut);
      card.classList.toggle("in-cart", q > 0);
      card.querySelector(".price").innerHTML = `<small>₹</small>${price(m.id)}`;
      const badge = card.querySelector(".left");
      if (Number.isFinite(left) && !soldOut) {
        badge.hidden = false;
        badge.textContent = `${left} left`;
        badge.classList.toggle("low", left <= 5);
      } else badge.hidden = true;
      const ctrl = card.querySelector(".ctrl");
      const btnStyle = `style="color:${m.t}"`;
      const want = q ? "step" : "add";
      if (ctrl.dataset.mode !== want) {
        ctrl.dataset.mode = want;
        ctrl.innerHTML = q
          ? `<div class="stepper"><button data-dec="${m.id}" aria-label="Remove one">−</button><span>${q}</span><button data-add="${m.id}" aria-label="Add one">+</button></div>`
          : `<button class="add-btn" data-add="${m.id}" ${btnStyle}>ADD +</button>`;
      }
      if (q) {
        const span = ctrl.querySelector(".stepper span");
        span.textContent = q;
        if (bumpId === m.id) { span.classList.remove("bump"); void span.offsetWidth; span.classList.add("bump"); }
      }
    });
    $("#nextToken").textContent = pad(nextToken());
  }

  function renderCart() {
    const lines = Object.entries(cart).filter(([, q]) => q > 0);
    $("#cartLines").innerHTML = lines.length
      ? lines.map(([id, q]) => {
          const m = itemById(id);
          return `<div class="line">
            <img src="${m.img}" alt="" onerror="this.style.visibility='hidden'">
            <div><div class="line-name">${esc(m.name)}</div><div class="line-sub">${inr(price(id))} × ${q} = <b>${inr(price(id) * q)}</b></div></div>
            <div class="stepper"><button data-dec="${id}">−</button><span>${q}</span><button data-add="${id}">+</button></div>
          </div>`;
        }).join("")
      : `<div class="empty">Tap an item to start an order</div>`;
    const total = cartTotal();
    $("#cartTotal").textContent = inr(total);
    $("#placeOrder").disabled = !lines.length;
    const fab = $("#cartFab");
    fab.hidden = !lines.length || view !== "counter";
    $("#fabCount").textContent = cartCount();
    $("#fabTotal").textContent = inr(total);
    if (!lines.length) document.body.classList.remove("cart-open");
    renderQR();
  }

  function renderQR() {
    const box = $("#qrBox");
    box.hidden = pay !== "UPI";
    if (pay !== "UPI") return;
    const total = cartTotal();
    $("#qrAmount").textContent = inr(total);
    const qrEl = $("#qrCode");
    if (settings.upiId) {
      const uri = `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.upiName || settings.outletName)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Token " + pad(nextToken()))}`;
      try {
        const qr = qrcode(0, "M");
        qr.addData(uri);
        qr.make();
        qrEl.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch { qrEl.textContent = "QR error"; }
      $("#qrUpi").textContent = settings.upiId + " · amount auto-filled";
    } else if (settings.qrImage) {
      qrEl.innerHTML = `<img src="${esc(settings.qrImage)}" alt="UPI QR">`;
      $("#qrUpi").textContent = "Ask customer to enter the amount";
    } else {
      qrEl.innerHTML = "";
      $("#qrUpi").textContent = "Add your UPI ID in Settings to show a QR";
    }
  }

  function flyToCart(fromEl) {
    if (reduced || !fromEl) return;
    const img = fromEl.closest(".item")?.querySelector("img");
    if (!img) return;
    const mobile = innerWidth <= 900;
    const target = mobile ? $("#fabCount") : $("#cartLines");
    if (!target || target.offsetParent === null && !mobile) return;
    const a = img.getBoundingClientRect();
    const b = (mobile && $("#cartFab").hidden) ? { left: innerWidth / 2, top: innerHeight - 40, width: 0, height: 0 } : target.getBoundingClientRect();
    const f = img.cloneNode();
    f.className = "flyer";
    Object.assign(f.style, { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px" });
    document.body.appendChild(f);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    f.animate([
      { transform: "translate(0,0) scale(1) rotate(0)", opacity: 1, borderRadius: "14px" },
      { transform: `translate(${dx * .45}px, ${dy * .45 - 120}px) scale(.55) rotate(-12deg)`, opacity: 1, offset: .5, borderRadius: "40%" },
      { transform: `translate(${dx}px, ${dy}px) scale(.08) rotate(10deg)`, opacity: .3, borderRadius: "50%" }
    ], { duration: 750, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => {
      f.remove();
      const c = $("#fabCount");
      c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    };
  }

  function addItem(id, srcEl) {
    if (!canAdd(id)) { toast(`${itemById(id).name} is sold out`); return; }
    const first = !cart[id];
    cart[id] = (cart[id] || 0) + 1;
    if (first && srcEl) flyToCart(srcEl);
    updateMenu(id);
    renderCart();
    if (navigator.vibrate) navigator.vibrate(12);
  }
  function decItem(id) {
    if (!cart[id]) return;
    cart[id]--;
    if (!cart[id]) delete cart[id];
    updateMenu(id);
    renderCart();
  }

  function placeOrder() {
    const lines = Object.entries(cart).filter(([, q]) => q > 0);
    if (!lines.length) return;
    // Re-check stock without counting the cart twice
    const saved = cart; cart = {};
    const short = lines.find(([id, q]) => leftFor(id) < q);
    cart = saved;
    if (short) { toast(`Not enough stock for ${itemById(short[0]).name}`); return; }

    const order = {
      id: uid(),
      token: nextToken(),
      time: Date.now(),
      items: lines.map(([id, q]) => ({ id, name: itemById(id).name, qty: q, price: price(id) })),
      total: cartTotal(),
      payment: pay,
      status: "new",
      note: $("#orderNote").value.trim()
    };
    morph(() => {
      send({ action: "addOrder", order });
      cart = {};
      $("#orderNote").value = "";
      pay = "Cash";
      $$("#payToggle button").forEach(x => x.classList.toggle("active", x.dataset.pay === "Cash"));
      $("#payToggle").classList.remove("upi");
      document.body.classList.remove("cart-open");
      showToken(order);
      updateMenu();
      renderCart();
    });
  }

  function showToken(o) {
    $("#tokenNum").textContent = pad(o.token);
    $("#tokenItems").innerHTML = o.items.map(i => `${i.qty} × ${esc(i.name)}`).join("<br>");
    $("#tokenPay").textContent = `${inr(o.total)} · ${o.payment}`;
    $("#tokenOverlay").hidden = false;
    document.body.classList.add("token-open");
    burst();
  }
  function burst() {
    if (reduced) return;
    const colors = ["#d52518", "#f96015", "#18542a", "#9abc05", "#f3e8cc"];
    const b = $("#burst");
    b.innerHTML = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2, d = 120 + Math.random() * 120;
      return `<i style="background:${colors[i % 5]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px;--r:${Math.random() * 720}deg;animation-delay:${200 + Math.random() * 150}ms"></i>`;
    }).join("");
  }

  /* ================= Kitchen ================= */
  const minsAgo = t => Math.max(0, Math.floor((Date.now() - t) / 60000));
  function renderKitchen() {
    const groups = { new: [], preparing: [], ready: [] };
    orders.filter(o => groups[o.status]).sort((a, b) => a.time - b.time).forEach(o => groups[o.status].push(o));
    const btn = { new: "Start preparing →", preparing: "Mark ready ✓", ready: "Handed over" };
    const ticket = o => {
      const m = minsAgo(o.time);
      return `<div class="ticket ${o.status}" style="view-transition-name:t${o.id}">
        <div class="ticket-top"><span class="ticket-token">${pad(o.token)}</span>
        <span class="ticket-time ${m >= 10 && o.status !== "ready" ? "late" : ""}">${m ? m + " min ago" : "just now"}</span></div>
        <ul>${o.items.map(i => `<li><b>${i.qty}×</b>${esc(i.name)}</li>`).join("")}</ul>
        ${o.note ? `<div class="note">📝 ${esc(o.note)}</div>` : ""}
        <button class="advance" data-advance="${o.id}">${btn[o.status]}</button>
      </div>`;
    };
    const fill = (sel, list) => { $(sel).innerHTML = list.length ? list.map(ticket).join("") : `<div class="kempty">Nothing here</div>`; };
    fill("#kNew", groups.new); fill("#kPrep", groups.preparing); fill("#kReady", groups.ready);
    $("#cNew").textContent = groups.new.length;
    $("#cPrep").textContent = groups.preparing.length;
    $("#cReady").textContent = groups.ready.length;
  }
  function advance(id) {
    const o = orders.find(o => o.id === id);
    if (!o) return;
    const next = { new: "preparing", preparing: "ready", ready: "served" }[o.status];
    if (!next) return;
    morph(() => { send({ action: "updateStatus", id, status: next }); renderKitchen(); });
  }

  let audioCtx;
  function ding() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [880, 1320].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * .15;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.3, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
        o.start(t); o.stop(t + .4);
      });
    } catch {}
  }

  /* ================= Orders ================= */
  let armed = null;
  function renderOrders() {
    const q = $("#orderSearch").value.trim().toLowerCase();
    const list = [...orders].sort((a, b) => b.time - a.time).filter(o =>
      !q || pad(o.token).includes(q) || String(o.token) === q.replace("#", "") || o.items.some(i => i.name.toLowerCase().includes(q)) || (o.note || "").toLowerCase().includes(q));
    $("#orderList").innerHTML = list.length ? list.map((o, i) => {
      const time = new Date(o.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      const canCancel = o.status !== "cancelled" && o.status !== "served";
      return `<div class="orow ${o.status}" style="--i:${Math.min(i, 20)}">
        <span class="tok">${pad(o.token)}</span>
        <span class="its">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(", ")}<small>${time}${o.note ? " · " + esc(o.note) : ""}</small></span>
        <span class="amt">${inr(o.total)}</span>
        <span class="chip ${o.payment}">${o.payment}</span>
        <span class="acts"><span class="chip st ${o.status}">${o.status}</span>
        ${canCancel ? ` <button class="mini ${armed === o.id ? "confirm" : ""}" data-cancel="${o.id}">${armed === o.id ? "Tap to confirm" : "Cancel"}</button>` : ""}</span>
      </div>`;
    }).join("") : `<div class="empty">No orders yet</div>`;
  }
  function cancelOrder(id) {
    if (armed !== id) { armed = id; renderOrders(); setTimeout(() => { if (armed === id) { armed = null; renderOrders(); } }, 3000); return; }
    armed = null;
    send({ action: "updateStatus", id, status: "cancelled" });
    toast("Order cancelled. Stock returned.");
    refresh();
  }

  /* ================= Dashboard ================= */
  function countUp(el, value, money) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = value;
    if (reduced || from === value) { el.textContent = money ? inr(value) : value; return; }
    const start = performance.now(), dur = 900;
    const step = now => {
      const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * e;
      el.textContent = money ? inr(v) : Math.round(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function renderDashboard() {
    const L = live();
    const rev = L.reduce((s, o) => s + o.total, 0);
    countUp($("#sRevenue"), rev, true);
    countUp($("#sOrders"), L.length);
    countUp($("#sCash"), L.filter(o => o.payment === "Cash").reduce((s, o) => s + o.total, 0), true);
    countUp($("#sUpi"), L.filter(o => o.payment === "UPI").reduce((s, o) => s + o.total, 0), true);

    const per = {};
    MENU.forEach(m => per[m.id] = { qty: 0, rev: 0 });
    L.forEach(o => o.items.forEach(i => { if (per[i.id]) { per[i.id].qty += i.qty; per[i.id].rev += i.qty * i.price; } }));
    const maxQ = Math.max(1, ...Object.values(per).map(p => p.qty));
    $("#itemBars").innerHTML = MENU.map(m => `
      <div class="bar-row"><span>${esc(m.name)}</span>
      <div class="bar"><i style="--w:${(per[m.id].qty / maxQ) * 100}%;--c:${m.c}"></i></div>
      <em>${per[m.id].qty} · ${inr(per[m.id].rev)}</em></div>`).join("");

    $("#stockList").innerHTML = Object.entries(RESOURCES).map(([r, label]) => {
      const total = stockOf(r), left = remainingRes(r, false);
      const txt = Number.isFinite(total) ? `${left} / ${total}` : `${usedOf(r, false)} used`;
      return `<div class="stock-row"><span>${label}</span><b class="${Number.isFinite(total) && left <= 5 ? "low" : ""}">${txt}</b></div>`;
    }).join("");

    const byHour = {};
    L.forEach(o => { const h = new Date(o.time).getHours(); byHour[h] = (byHour[h] || 0) + 1; });
    const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
    if (!hours.length) { $("#hourChart").innerHTML = `<div class="empty" style="flex:1">No sales yet</div>`; return; }
    const range = []; for (let h = hours[0]; h <= hours[hours.length - 1]; h++) range.push(h);
    const maxH = Math.max(...Object.values(byHour));
    $("#hourChart").innerHTML = range.map(h => {
      const n = byHour[h] || 0;
      const lbl = `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
      return `<div class="hcol"><span>${n}</span><i style="--h:${Math.max(3, (n / maxH) * 100)}%"></i><span>${lbl}</span></div>`;
    }).join("");
  }
  function exportCsv() {
    const rows = [["Token", "Time", "Items", "Total", "Payment", "Status", "Note"]];
    [...orders].sort((a, b) => a.time - b.time).forEach(o => rows.push([
      pad(o.token), new Date(o.time).toLocaleString("en-IN"), o.items.map(i => `${i.qty}x ${i.name}`).join("; "), o.total, o.payment, o.status, o.note || ""
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  /* ================= Settings ================= */
  function fillSettings() {
    const f = $("#settingsForm");
    $("#priceFields").innerHTML = MENU.map(m => `<label class="field"><span>${esc(m.name)}</span><input name="prices.${m.id}" type="number" min="0"></label>`).join("");
    [...f.elements].forEach(el => {
      if (!el.name) return;
      const [a, b] = el.name.split(".");
      el.value = b ? (settings[a][b] ?? "") : (settings[a] ?? "");
    });
  }
  function saveSettings(e) {
    e.preventDefault();
    const s = clone(settings);
    [...e.target.elements].forEach(el => {
      if (!el.name) return;
      const [a, b] = el.name.split(".");
      const v = el.value.trim();
      if (b) s[a][b] = a === "prices" ? Number(v) || 0 : (v === "" ? "" : Number(v));
      else s[a] = v;
    });
    if (!s.pin) s.pin = "1234";
    send({ action: "saveSettings", settings: s });
    toast("Settings saved");
    refresh();
  }
  function tryUnlock(input) {
    const el = $(input);
    if (el.value === String(settings.pin)) {
      unlocked = true; el.value = "";
      morph(() => showLocks());
    } else {
      el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
      toast("Wrong PIN");
    }
  }
  function showLocks() {
    $("#dashLock").hidden = unlocked; $("#dash").hidden = !unlocked;
    $("#setLock").hidden = unlocked; $("#settingsForm").hidden = !unlocked;
    if (unlocked) { renderDashboard(); fillSettings(); }
  }

  /* ================= Views ================= */
  function brand() {
    $("#brandName").textContent = settings.outletName || "OUTLET NAME";
    $("#brandSub").textContent = settings.tagline || "";
    document.title = `${settings.outletName} · Orders`;
  }

  function refresh(newArrivals) {
    const hash = JSON.stringify([orders.map(o => [o.id, o.status, o.token]), settings]);
    const changed = hash !== lastHash;
    lastHash = hash;
    if (!changed) return;
    brand();
    updateMenu();
    renderCart();
    if (view === "kitchen") newArrivals ? morph(renderKitchen) : renderKitchen();
    if (view === "orders") renderOrders();
    if (view === "dashboard" && unlocked) renderDashboard();
  }

  function switchView(next, btn) {
    if (next === view) return;
    if (btn) {
      const r = btn.getBoundingClientRect(), m = $("#main").getBoundingClientRect();
      document.documentElement.style.setProperty("--vx", `${((r.left + r.width / 2 - m.left) / m.width) * 100}%`);
      document.documentElement.style.setProperty("--vy", "0%");
    }
    morph(() => {
      view = next;
      document.body.dataset.view = next;
      $$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === next));
      $$(".view").forEach(v => v.hidden = v.id !== "view-" + next);
      document.body.classList.remove("cart-open");
      if (next === "kitchen") renderKitchen();
      if (next === "orders") renderOrders();
      if (next === "dashboard" || next === "settings") showLocks();
      renderCart();
      scrollTo({ top: 0 });
    });
  }

  /* ================= Events ================= */
  function bind() {
    $("#tabs").addEventListener("click", e => {
      const b = e.target.closest("button[data-view]");
      if (b) switchView(b.dataset.view, b);
    });
    document.addEventListener("click", e => {
      const add = e.target.closest("[data-add]");
      if (add) { addItem(add.dataset.add, add); return; }
      const dec = e.target.closest("[data-dec]");
      if (dec) { decItem(dec.dataset.dec); return; }
      const adv = e.target.closest("[data-advance]");
      if (adv) { advance(adv.dataset.advance); return; }
      const can = e.target.closest("[data-cancel]");
      if (can) { cancelOrder(can.dataset.cancel); return; }
    });
    $("#clearCart").onclick = () => { cart = {}; updateMenu(); renderCart(); };
    $("#payToggle").addEventListener("click", e => {
      const b = e.target.closest("button[data-pay]");
      if (!b) return;
      pay = b.dataset.pay;
      $$("#payToggle button").forEach(x => x.classList.toggle("active", x === b));
      $("#payToggle").classList.toggle("upi", pay === "UPI");
      renderQR();
    });
    $("#placeOrder").onclick = placeOrder;
    $("#cartFab").onclick = () => document.body.classList.add("cart-open");
    document.addEventListener("click", e => {
      if (document.body.classList.contains("cart-open") && !e.target.closest("#cart") && !e.target.closest("#cartFab") && !e.target.closest("[data-add],[data-dec]")) {
        document.body.classList.remove("cart-open");
      }
    });
    $("#newOrder").onclick = () => morph(() => {
      $("#tokenOverlay").hidden = true;
      document.body.classList.remove("token-open");
    });
    $("#orderSearch").addEventListener("input", renderOrders);
    $("#dashUnlock").onclick = () => tryUnlock("#dashPin");
    $("#setUnlock").onclick = () => tryUnlock("#setPin");
    $("#dashPin").addEventListener("keydown", e => e.key === "Enter" && tryUnlock("#dashPin"));
    $("#setPin").addEventListener("keydown", e => e.key === "Enter" && tryUnlock("#setPin"));
    $("#settingsForm").addEventListener("submit", saveSettings);
    $("#exportCsv").onclick = exportCsv;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { pull(); flush(); } });
    addEventListener("online", () => { flush(); pull(); });
    // Keep other tabs on this device in sync (local mode)
    addEventListener("storage", e => {
      if (!REMOTE && (e.key === "fo_orders" || e.key === "fo_settings")) {
        orders = lsGet("fo_orders", []); settings = mergeSettings(lsGet("fo_settings", {})); refresh(true);
      }
    });
  }

  /* ================= Boot ================= */
  loadInitial();
  buildMenu();
  bind();
  lastHash = "";
  refresh();
  if (REMOTE) {
    setSync("busy", "Connecting…");
    pull().then(flush);
    setInterval(() => { pull(); flush(); }, POLL_MS);
  } else {
    setSync("", "This device only");
  }
  setInterval(() => { if (view === "kitchen") renderKitchen(); }, 30000);
})();
