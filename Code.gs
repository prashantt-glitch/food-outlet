/**
 * Google Sheet backend for the food outlet order site.
 * Paste this into Extensions > Apps Script of your Google Sheet,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */
const ORDERS = "Orders";
const SETTINGS = "Settings";
const HEAD = ["ID", "Token", "Time", "Items", "Total", "Payment", "Status", "Note", "Updated", "ItemsJSON"];

function doGet(e) {
  try {
    return json({ ok: true, orders: readOrders(), settings: readSettings() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse(e.postData.contents);
    if (body.action === "addOrder") return json(addOrder(body.order));
    if (body.action === "updateStatus") return json(updateStatus(body.id, body.status));
    if (body.action === "saveSettings") return json(saveSettings(body.settings));
    return json({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === ORDERS) {
      sh.appendRow(HEAD);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEAD.length).setFontWeight("bold");
      sh.hideColumns(10);
    }
  }
  return sh;
}

function rows() {
  const sh = sheet(ORDERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEAD.length).getValues();
}

function readOrders() {
  return rows().filter(r => r[0]).map(r => ({
    id: String(r[0]),
    token: Number(r[1]),
    time: r[2] instanceof Date ? r[2].getTime() : Number(r[2]) || Date.parse(r[2]),
    items: safeParse(r[9], []),
    total: Number(r[4]),
    payment: String(r[5]),
    status: String(r[6]),
    note: String(r[7] || "")
  }));
}

function addOrder(o) {
  const all = rows();
  const existing = all.find(r => String(r[0]) === o.id);
  if (existing) return { ok: true, token: Number(existing[1]) }; // retry of an order already saved
  let token = Number(o.token);
  const used = all.map(r => Number(r[1]));
  if (used.indexOf(token) !== -1) token = Math.max.apply(null, used) + 1;
  const items = o.items.map(i => i.qty + "x " + i.name).join(", ");
  sheet(ORDERS).appendRow([o.id, token, new Date(o.time), items, o.total, o.payment, o.status, o.note || "", new Date(), JSON.stringify(o.items)]);
  return { ok: true, token: token };
}

function updateStatus(id, status) {
  const all = rows();
  for (let i = 0; i < all.length; i++) {
    if (String(all[i][0]) === id) {
      sheet(ORDERS).getRange(i + 2, 7, 1, 3).setValues([[status, all[i][7], new Date()]]);
      return { ok: true };
    }
  }
  return { ok: true, missing: true };
}

function readSettings() {
  const v = sheet(SETTINGS).getRange("A1").getValue();
  return safeParse(v, {});
}

function saveSettings(s) {
  const sh = sheet(SETTINGS);
  sh.getRange("A1").setValue(JSON.stringify(s));
  sh.getRange("A3").setValue("Settings are managed from the website. Do not edit A1 by hand.");
  return { ok: true };
}

function safeParse(v, d) {
  try { return v ? JSON.parse(v) : d; } catch (e) { return d; }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the tabs. */
function setup() {
  sheet(ORDERS);
  sheet(SETTINGS);
}
