import { inManhattan, rideTouchesManhattan } from './manhattan';

describe('Manhattan scope', () => {
  it('knows the island from its neighbours', () => {
    expect(inManhattan(-73.9855, 40.758)).toBe(true);   // Times Square
    expect(inManhattan(-74.0134, 40.7127)).toBe(true);  // World Trade Center
    expect(inManhattan(-73.9496, 40.7614)).toBe(true);  // Roosevelt Island
    expect(inManhattan(-73.9571, 40.7178)).toBe(false); // Williamsburg
    expect(inManhattan(-73.9442, 40.7489)).toBe(false); // Long Island City
    expect(inManhattan(-74.0431, 40.7178)).toBe(false); // Jersey City
  });

  it('keeps rides that start or end on the island', () => {
    expect(rideTouchesManhattan(-73.9571, 40.7178, -73.9855, 40.758)).toBe(true);
    expect(rideTouchesManhattan(-73.9571, 40.7178, -73.9442, 40.7489)).toBe(false);
  });
});
