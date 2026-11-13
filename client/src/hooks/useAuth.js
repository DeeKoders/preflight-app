import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.get('/auth/me')).user;
      } catch (err) {
        if (err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAuthMutation(kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post(`/auth/${kind}`, body),
    onSuccess: (data) => {
      qc.clear();
      qc.setQueryData(['me'], data.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });
}
