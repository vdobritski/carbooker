import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import SignIn from './pages/SignIn'
import Trips from './pages/Trips'
import TripDetail from './pages/TripDetail'
import CarDetail from './pages/CarDetail'
import CarForm from './pages/CarForm'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import JoinGroup from './pages/JoinGroup'
import Profile from './pages/Profile'
import Admin from './pages/Admin'

// HashRouter, not BrowserRouter: GitHub Pages has no rewrite rule, so refreshing on a
// deep path would 404.
export default function AppRoutes() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<SignIn />} />
        <Route element={<RequireAuth />}>
          <Route path="/trips" element={<Trips />} />
          <Route path="/trips/:id" element={<TripDetail />} />
          <Route path="/trips/:id/cars/new" element={<CarForm />} />
          <Route path="/trips/:id/cars/:carId" element={<CarDetail />} />
          <Route path="/trips/:id/cars/:carId/edit" element={<CarForm />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/join/:token" element={<JoinGroup />} />
          <Route path="/me" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
