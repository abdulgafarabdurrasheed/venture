import { createContext, useContext } from "react";

export const AuthContext = createContext({
  user: null,
  status: "loading",
  reload: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
