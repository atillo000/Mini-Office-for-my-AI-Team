import { z } from 'zod';
import { Store, offlineWeather } from './db';
import type { Weather } from '../shared/types';
const configSchema = z.object({
  city: z.string().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z
    .string()
    .max(80)
    .refine((s) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid timezone'),
});
const responseSchema = z.object({
  current: z.object({ temperature_2m: z.number(), weather_code: z.number() }),
});
export { configSchema as weatherConfigSchema };
export async function refreshWeather(store: Store, force = false): Promise<Weather> {
  const cached = store.get<Weather>('settings', 'weather');
  if (cached && !force && Date.now() - cached.fetchedAt < 600000) return cached;
  const config = store.get<z.infer<typeof configSchema>>('settings', 'location') || {
    city: 'Manila',
    latitude: Number(process.env.WEATHER_LAT || 14.5995),
    longitude: Number(process.env.WEATHER_LON || 120.9842),
    timezone: 'Asia/Manila',
  };
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: String(config.latitude),
      longitude: String(config.longitude),
      current: 'temperature_2m,weather_code',
      timezone: config.timezone,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Weather unavailable');
    const { current } = responseSchema.parse(await response.json());
    const value: Weather = {
      city: config.city,
      temperature: current.temperature_2m,
      code: current.weather_code,
      condition:
        current.weather_code >= 51 ? 'rainy' : current.weather_code >= 2 ? 'cloudy' : 'sunny',
      fetchedAt: Date.now(),
      source: 'live',
      provider: 'Open-Meteo',
      timezone: config.timezone,
    };
    return store.put('settings', 'weather', value);
  } catch {
    return store.put(
      'settings',
      'weather',
      cached
        ? { ...cached, source: 'cached' as const }
        : { ...offlineWeather, city: config.city, timezone: config.timezone },
    );
  }
}
