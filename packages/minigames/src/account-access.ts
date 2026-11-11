export const ACCOUNT_ROLES = ["user", "media", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function canUseBuiltinMedia(user: { role?: string } | null | undefined) {
  return user?.role === "media" || user?.role === "admin";
}

/** A receiving peer must never negotiate a sending audio/video channel. */
export function isReceiveOnlyMediaSdp(sdp: string) {
  const sections = sdp.split(/\r?\n(?=m=)/);
  const direction = (section: string, fallback: string) => {
    const matches = [...section.matchAll(/^a=(sendrecv|sendonly|recvonly|inactive)\r?$/gm)];
    return matches.length > 1 ? "invalid" : (matches[0]?.[1] ?? fallback);
  };
  const session = direction(sections[0], "sendrecv");
  const media = sections.slice(1);
  return (
    media.length > 0 &&
    media.every((section) => {
      if (!/^m=(audio|video) /.test(section)) return false;
      if (/^m=\w+ 0(?: |\r?\n)/.test(section)) return true;
      return ["recvonly", "inactive"].includes(direction(section, session));
    })
  );
}
