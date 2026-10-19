export const imageProfiles = {
  thumb: { width: 240, height: 360, quality: 78 },
  card: { width: 768, height: 1152, quality: 82 },
  detail: { width: 1280, height: 1920, quality: 85 },
} as const;
export type ImageProfile = keyof typeof imageProfiles;
export function optimizedPath(original: string, profile: ImageProfile) {
  return `${original}.vanta-${profile}-v1.webp`;
}
export function originalImagePath(path: string) {
  const match = /^(.*)\.vanta-(thumb|card|detail)-v1\.webp$/.exec(path);
  return match
    ? { original: match[1], profile: match[2] as ImageProfile }
    : null;
}
