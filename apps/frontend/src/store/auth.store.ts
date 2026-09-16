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
  /**
   * Substitui SÓ o token, mantendo o usuário.
   *
   * Existe para a troca de senha: o servidor corta todas as sessões da conta e
   * devolve um token novo para esta aba. `setAuth` exigiria repassar o usuário
   * junto — que não mudou e que a rota não devolve —, e montar um objeto de
   * usuário ali seria a chance de gravar um dado desatualizado por cima do bom.
   */
  setAccessToken: (token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,

      setAuth: (token, user) => set({ accessToken: token, user }),

      setAccessToken: (accessToken) => set({ accessToken }),

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
