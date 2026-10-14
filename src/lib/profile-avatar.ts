/** Device photos are stored in the app's avatars bucket; NFT picks keep their source URL. */
export function isDeviceAvatar(url: string | null | undefined): boolean {
  return Boolean(url?.includes("/storage/v1/object/public/avatars/"));
}

export function avatarShapeClass(url: string | null | undefined): string {
  return url && !isDeviceAvatar(url) ? "rounded-md" : "rounded-full";
}
