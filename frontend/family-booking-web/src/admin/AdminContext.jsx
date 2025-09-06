import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_BASE, ADMIN_HEADER } from "../config";

const AdminCtx = createContext(null);

export function AdminProvider({ children }) {
  const [passcode, setPasscode] = useState("");     // kept in memory
  const [verified, setVerified] = useState(false);

  // try to restore from sessionStorage (tab-lifetime only)
  useEffect(() => {
    const p = sessionStorage.getItem("admin_pass") || "";
    if (p) verifyWith(p);
  }, []);

  async function verifyWith(code) {
    const trimmed = code.trim();
    const r = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { [ADMIN_HEADER]: trimmed },
    });
    if (r.ok) {
      setPasscode(trimmed);
      setVerified(true);
      sessionStorage.setItem("admin_pass", trimmed);  // remove if you don't want caching
      return true;
    } else {
      setVerified(false);
      setPasscode("");
      sessionStorage.removeItem("admin_pass");
      return false;
    }
  }

  async function signIn(code) {
    const ok = await verifyWith(code);
    if (!ok) alert("Bad passcode ❌");
    return ok;
  }

  function signOut() {
    setVerified(false);
    setPasscode("");
    sessionStorage.removeItem("admin_pass");
  }

  const value = useMemo(() => ({
    passcode, verified, signIn, signOut,
    header() { return { [ADMIN_HEADER]: passcode }; },
  }), [passcode, verified]);

  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminCtx);
  if (!ctx) throw new Error("useAdmin must be used inside <AdminProvider>");
  return ctx;
}
