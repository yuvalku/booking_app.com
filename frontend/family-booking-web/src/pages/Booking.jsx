// src/pages/Booking.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { API_BASE } from "../config";
import { toISO, fromISO, addDays, formatDMY } from "../utils/date";

const firstOfThisMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

export default function BookingPage() {
  const [range, setRange] = useState({ from: undefined, to: undefined });
  const [approved, setApproved] = useState([]);
  const [me, setMe] = useState({ name: "", email: "", notes: "" });
  const [status, setStatus] = useState(null);
  const [hover, setHover] = useState(null);
  const [month, setMonth] = useState(firstOfThisMonth());

  const loadApproved = async () => {
    const r = await fetch(`${API_BASE}/api/bookings/approved`);
    setApproved(await r.json());
  };

  useEffect(() => {
    loadApproved();
    const onChanged = () => loadApproved();
    window.addEventListener("bookings:changed", onChanged);
    window.addEventListener("focus", onChanged);
    return () => {
      window.removeEventListener("bookings:changed", onChanged);
      window.removeEventListener("focus", onChanged);
    };
  }, []);

  const bookedRanges = useMemo(
    () =>
      approved.map((b) => ({
        from: fromISO(b.start_date),
        to: addDays(fromISO(b.end_date), -1),
      })),
    [approved]
  );

  const approvedWithNames = useMemo(
    () =>
      approved.map((b) => ({
        from: fromISO(b.start_date),
        to: addDays(fromISO(b.end_date), -1),
        name: b.requester_name,
      })),
    [approved]
  );

  function intersectsApproved(a, b) {
    if (!a || !b) return false;
    const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    for (const r of approvedWithNames) {
      if (end >= r.from && start <= r.to) return true;
    }
    return false;
  }

  function nameOn(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const hit = approvedWithNames.find((r) => d >= r.from && d <= r.to);
    return hit || null;
  }

  function handleDayMouseEnter(day) {
    const hit = nameOn(day);
    setHover(hit);
  }
  function handleDayMouseLeave() {
    setHover(null);
  }

  async function submit(e) {
    e.preventDefault();
    setStatus(null);
    if (!range.from || !range.to) return setStatus("Please select a start and end date.");
    if (!me.name.trim()) return setStatus("Please enter your name.");
    if (!me.email.trim()) return setStatus("Please enter your email.");

    const payload = {
      requester_name: me.name.trim(),
      requester_email: me.email.trim(), // always a string now
      notes: me.notes.trim() || null,
      start_date: toISO(range.from),
      end_date: toISO(addDays(range.to, 1)),
    };

    try {
      const res = await fetch(`${API_BASE}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus("✅ Request sent to Mom for approval.");
      setRange({ from: undefined, to: undefined });
      setMe({ name: "", email: "", notes: "" });
    } catch {
      setStatus("❌ Could not send request. Try again.");
    }
  }

  const selectedLabel =
    range.from && range.to
      ? `${formatDMY(range.from)} → ${formatDMY(addDays(range.to, 1))} (checkout)`
      : "—";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div>
        <DayPicker
          mode="range"
          selected={range}
          onSelect={(r) => {
            const next = r ?? { from: undefined, to: undefined };
            if (next.from && next.to && intersectsApproved(next.from, next.to)) return;
            setRange(next);
          }}
          numberOfMonths={1}
          fixedWeeks
          month={month}
          onMonthChange={setMonth}
          fromMonth={firstOfThisMonth()}
          captionLayout="dropdown-buttons"
          modifiers={{ booked: bookedRanges }}
          modifiersStyles={{ booked: { backgroundColor: "#ef4444", color: "#fff" } }}
          weekStartsOn={0}
          onDayMouseEnter={handleDayMouseEnter}
          onDayMouseLeave={handleDayMouseLeave}
        />

        {hover ? (
          <div style={{ marginTop: 8 }}>
            <b>Booked by:</b> {hover.name}
            <br />
            <b>Dates: </b>
            <span style={{ color: "#666" }}>
              {formatDMY(hover.from)} → {formatDMY(addDays(hover.to, 1))}
            </span>
          </div>
        ) : (
          <small style={{ color: "#666" }}>
            Red blocks are <b>approved</b> (unavailable). End date is your <b>checkout day</b>.
          </small>
        )}
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 10, alignContent: "start" }}>
        <label>
          Your name*
          <input
            value={me.name}
            onChange={(e) => setMe((s) => ({ ...s, name: e.target.value }))}
            placeholder="Your name"
            required
          />
        </label>
        <label>
          Email*
          <input
            type="email"
            value={me.email}
            onChange={(e) => setMe((s) => ({ ...s, email: e.target.value }))}
            placeholder="name@example.com"
            required
          />
        </label>
        <label>
          Notes
          <textarea
            rows={3}
            value={me.notes}
            onChange={(e) => setMe((s) => ({ ...s, notes: e.target.value }))}
            placeholder="Anything Mom should know?"
          />
        </label>

        <div style={{ fontSize: 14 }}>
          <b>Selected:</b> {selectedLabel}
        </div>

        <button type="submit">Send request</button>
        {status && <div style={{ fontSize: 14 }}>{status}</div>}
      </form>
    </div>
  );
}
