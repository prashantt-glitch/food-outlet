# Food Outlet Order Counter

Staff order site for the college food outlet: Counter, Kitchen screen, Orders, Sales and Settings.

## 1. Connect the Google Sheet (do once)
1. Create a new Google Sheet.
2. Extensions > Apps Script. Delete what is there and paste `Code.gs`. Save.
3. Run `setup` once (allow permissions).
4. Deploy > New deployment > type: Web app. Execute as: Me. Who has access: Anyone. Deploy.
5. Copy the Web app URL and paste it into `config.js` as `SCRIPT_URL`.

If `SCRIPT_URL` is empty, the site works on one device only (saved in the browser).

## 2. On the day
- Settings (PIN 1234 by default): outlet name, prices, stock, UPI ID, new PIN.
- Counter: tap items, pick Cash/UPI, Place order, read out the token.
- Kitchen: open on a second phone/laptop. New > Preparing > Ready > Handed over.
- Sales: revenue, cash vs UPI, item counts, stock left, CSV download.
