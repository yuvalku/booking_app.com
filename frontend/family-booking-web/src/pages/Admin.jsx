import React, { useEffect, useState } from "react";
import { API_BASE } from "../config";
import { useAdmin } from "../admin/AdminContext";
import { fromISO, addDays, formatDMY } from "../utils/date";

export default function AdminPage() {
  const { verified, signIn, signOut, header } = useAdmin();
  const [passInput, setPassInput] = useState("");
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);

  async function load() {
    if (!verified) return;
    if (status === "all") {
      const [a, r] = await Promise.all([
        fetch(`${API_BASE}/api/requests?active=1`, { headers: header() }).then(x => x.json()),
        fetch(`${API_BASE}/api/requests?status=rejected`, { headers: header() }).then(x => x.json()),
      ]);
      setRows([...a, ...r].sort((x, y) => x.start_date.localeCompare(y.start_date) || x.id - y.id));
    } else {
      const res = await fetch(`${API_BASE}/api/requests?status=${status}`, { headers: header() });
      setRows(await res.json());
    }
  }
  useEffect(() => { load(); }, [status, verified]);

  async function decide(id, action) {
    if (!verified) return;
    const r = await fetch(`${API_BASE}/api/requests/${id}/${action}`, { method: "POST", headers: header() });
    if (r.ok) { if (action === "approve") window.dispatchEvent(new Event("bookings:changed")); load(); }
    else alert(await r.text());
  }
  async function cancelBooking(id) {
    if (!verified) return;
    const reason = window.prompt("Cancellation reason (optional):", "") || null;
    const r = await fetch(`${API_BASE}/api/requests/${id}/cancel`, {
      method: "POST", headers: { "Content-Type": "application/json", ...header() }, body: JSON.stringify({ reason }),
    });
    if (r.ok) { window.dispatchEvent(new Event("bookings:changed")); load(); } else alert(await r.text());
  }

  if (!verified) {
    return (
      <div style={{ maxWidth: 420, marginTop: 24 }}>
        <h3>Admin — Sign in</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <input type="password" value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="Admin passcode" />
          <button onClick={() => signIn(passInput)}>Sign in</button>
          <small style={{ color: "#666" }}>Requests are hidden until Mom signs in.</small>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3>Admin — Manage Requests</h3>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <button onClick={signOut}>Sign out</button>
        <div style={{ marginLeft: "auto" }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Who</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Dates</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Status</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Notes</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: "6px 4px" }}>
                <div>{r.requester_name}</div>
                <div style={{ color: "#666", fontSize: 12 }}>{r.requester_email || ""}</div>
              </td>
              <td style={{ padding: "6px 4px" }}>{formatDMY(fromISO(r.start_date))} → {formatDMY(fromISO(r.end_date))}</td>
              <td style={{ padding: "6px 4px" }}>{r.status}</td>
              <td style={{ padding: "6px 4px", whiteSpace: "pre-wrap" }}>{r.notes || ""}</td>
              <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                {r.status === "pending" && (<>
                  <button onClick={() => decide(r.id, "approve")}>Approve</button>{" "}
                  <button onClick={() => decide(r.id, "reject")} style={{ color: "#b33" }}>Reject</button>
                </>)}
                {r.status === "approved" && (
                  <button onClick={() => cancelBooking(r.id)} style={{ color: "#b33" }}>Cancel</button>
                )}
                {r.status === "rejected" && <span>—</span>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} style={{ padding: 12, color: "#666" }}>No items.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}