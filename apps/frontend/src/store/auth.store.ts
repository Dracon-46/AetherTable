import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { armazenamentoSeguro } from './storage';

interface UserData {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string | null;
}

interface AuthState {
  accessToken: string | null;
  user: UserData | null;
  setAuth: (token: string, user: UserData) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,

      setAuth: (token, user) => set({ accessToken: token, user }),

      logout: () => set({ accessToken: null, user: null }),

      isAuthenticated: () => !!get().accessToken,
    }),
    {
      name: 'aethertable-auth-storage', // Nome da chave no localStorage
      storage: armazenamentoSeguro,
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
    },
  ),
);
