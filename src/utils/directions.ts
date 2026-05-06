export interface DirectionUrls {
  google: string;
  waze: string;
  apple: string;
}

export function buildDirectionUrls(
  dest: { latitude: number; longitude: number },
  origin: { latitude: number; longitude: number } | null | undefined,
  isMobile: boolean,
): DirectionUrls {
  const d = `${dest.latitude},${dest.longitude}`;

  let google: string;
  if (isMobile) {
    google = `https://maps.google.com/maps?daddr=${d}&dirflg=d`;
  } else if (origin) {
    google = `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${d}&travelmode=driving`;
  } else {
    google = `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`;
  }

  const waze = `https://waze.com/ul?ll=${d}&navigate=yes`;

  const apple = origin
    ? `https://maps.apple.com/?saddr=${origin.latitude},${origin.longitude}&daddr=${d}&dirflg=d`
    : `https://maps.apple.com/?daddr=${d}&dirflg=d`;

  return { google, waze, apple };
}
