import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { byDateDesc } from './lib';

// The herd, loaded once for the workspace and shared by every Ganadería page.
// A finca has hundreds of animals and a few thousand events, so both tables
// fit in memory; every write goes to the database and then refreshes.
//
// Writes:
//   saveAnimal(row, id?)   insert or update one lv_animals row
//   deleteAnimal(id)       remove a card (its events go with it)
//   recordEvent(p)         lv_record_event RPC — the event plus what it means
//   recordEvents(ps)       the same for several animals, one after another,
//                          then one refresh; returns { ok, data | error } each
//   deleteEvent(id)        lv_delete_event RPC — undoes it
//
// The Ganadería shell and the /ganaderia routes both mount a provider, so the
// Registrar button works on shared pages (Settings, Team) too. The inner one
// sees the outer and steps aside, so the herd loads once.

const HerdContext = createContext(null);

export function HerdProvider({ children }) {
  const parent = useContext(HerdContext);
  if (parent) return children;
  return <HerdStore>{children}</HerdStore>;
}

function HerdStore({ children }) {
  const { user } = useAuth();
  const [animals, setAnimals] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const userId = user?.id || null;
  const refresh = useCallback(async () => {
    if (!userId) return;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [a, e] = await Promise.all([
        fetchAll(supabase.from('lv_animals').select('*').order('name')),
        fetchAll(supabase.from('lv_events').select('*').order('date', { ascending: false }).order('created_at', { ascending: false })),
      ]);
      setAnimals(a || []);
      setEvents((e || []).slice().sort(byDateDesc));
      setError(null);
    } catch (err) {
      console.error('herd load failed:', err);
      setError(err);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAnimal = useCallback(async (row, id = null) => {
    const q = id
      ? supabase.from('lv_animals').update(row).eq('id', id).select().single()
      : supabase.from('lv_animals').insert(row).select().single();
    const { data, error: err } = await q;
    if (err) throw err;
    await refresh();
    return data;
  }, [refresh]);

  const deleteAnimal = useCallback(async (id) => {
    const { error: err } = await supabase.from('lv_animals').delete().eq('id', id);
    if (err) throw err;
    await refresh();
  }, [refresh]);

  const recordEvent = useCallback(async (p) => {
    const { data, error: err } = await supabase.rpc('lv_record_event', { p });
    if (err) throw err;
    await refresh();
    return data;
  }, [refresh]);

  const recordEvents = useCallback(async (ps) => {
    const results = [];
    for (const p of ps) {
      const { data, error: err } = await supabase.rpc('lv_record_event', { p });
      results.push(err ? { ok: false, error: err } : { ok: true, data });
    }
    await refresh();
    return results;
  }, [refresh]);

  const deleteEvent = useCallback(async (id) => {
    const { error: err } = await supabase.rpc('lv_delete_event', { p_id: id });
    if (err) throw err;
    await refresh();
  }, [refresh]);

  const value = useMemo(() => {
    const byId = Object.fromEntries(animals.map((a) => [a.id, a]));
    const bySlug = Object.fromEntries(animals.map((a) => [a.slug, a]));
    const eventsByAnimal = {};
    for (const ev of events) (eventsByAnimal[ev.animal_id] ||= []).push(ev);
    const lots = [...new Set(animals.map((a) => a.lot).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    return { animals, events, byId, bySlug, eventsByAnimal, lots, loading, error, refresh, saveAnimal, deleteAnimal, recordEvent, recordEvents, deleteEvent };
  }, [animals, events, loading, error, refresh, saveAnimal, deleteAnimal, recordEvent, recordEvents, deleteEvent]);

  return <HerdContext.Provider value={value}>{children}</HerdContext.Provider>;
}

export function useHerd() {
  const ctx = useContext(HerdContext);
  if (!ctx) throw new Error('useHerd must be used within HerdProvider');
  return ctx;
}
