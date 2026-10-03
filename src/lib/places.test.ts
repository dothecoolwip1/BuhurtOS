import { describe, expect, it } from 'vitest';
import { mapPlace } from './places';

describe('place -> venue fields', () => {
  it('a named venue fills venue, street, city, province, country and coordinates', () => {
    const d = mapPlace({ displayName: 'Horse In Hand Ranch', formattedAddress: '12345 Township Rd 400, Blackfalds, AB T0M 0J0, Canada', streetNumber: '12345', route: 'Township Rd 400', locality: 'Blackfalds', region: 'AB', country: 'CA', latitude: 52.38, longitude: -113.78 });
    expect(d).toEqual({ venue: 'Horse In Hand Ranch', address: '12345 Township Rd 400', city: 'Blackfalds', region: 'AB', country: 'CA', latitude: 52.38, longitude: -113.78 });
  });
  it('a plain address has no venue name and takes the first line when components are missing', () => {
    const d = mapPlace({ displayName: '', formattedAddress: '4902 50 Ave, Red Deer, AB, Canada', streetNumber: '', route: '', locality: 'Red Deer', region: 'AB', country: 'CA', latitude: null, longitude: null });
    expect(d.venue).toBe('');
    expect(d.address).toBe('4902 50 Ave');
    expect(d.latitude).toBeNull();
  });
  it('does not repeat the venue name as the street', () => {
    const d = mapPlace({ displayName: 'Penney Steamers', formattedAddress: 'Penney Steamers, Lacombe, AB', streetNumber: '', route: '', locality: 'Lacombe', region: 'AB', country: 'CA', latitude: 1, longitude: 2 });
    expect(d.address).toBe('');
  });
});
