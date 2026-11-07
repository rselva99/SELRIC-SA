import { Outlet } from 'react-router-dom';
import { HerdProvider } from './HerdContext';
import { RegistrarProvider } from './RegistrarSheet';

// The providers every /ganaderia page sits in: one herd for all of them, and
// Registrar ready from any page. Its own module so the herd code is fetched
// only when a herd page is opened (main.jsx loads it lazily). The Ganadería
// shell mounts the same providers; these step aside when it has.
export default function HerdRoot() {
  return (
    <HerdProvider><RegistrarProvider><Outlet /></RegistrarProvider></HerdProvider>
  );
}
