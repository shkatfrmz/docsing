import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api.me()
      .then(setUser)
      .catch(() => {
        setToken("");
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(() => ({
    user,
    ready,
    async signup(body) {
      const res = await api.signup(body);
      setToken(res.token);
      setUser(res.user);
      return res.user;
    },
    async login(body) {
      const res = await api.login(body);
      setToken(res.token);
      setUser(res.user);
      return res.user;
    },
    async logout() {
      try { await api.logout(); } catch {}
      setToken("");
      setUser(null);
    },
  }), [user, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
