import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)  // true until /api/me resolves

  useEffect(() => {
    api.get('/me')
      .then(r => setUser(r.data))
      .catch(() => setUser(null))   // 401 = not logged in, that's fine
      .finally(() => setLoading(false))
  }, [])

  const login = async (username, password) => {
    const r = await api.post('/auth/login', { username, password })
    setUser(r.data.user)
    return r.data.user
  }

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {})
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
