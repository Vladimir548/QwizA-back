export interface PlayerMediaSource {
  kind: "embed" | "video" | "audio";
  url: string;
}

export interface PlayerMediaState {
  camera: boolean;
  microphone: boolean;
  source: PlayerMediaSource | null;
}

export interface PlayerMediaPeer extends PlayerMediaState {
  participantId: string;
  connectionId: string;
}

export interface PlayerMediaConnection {
  url: string;
  token: string;
}

export function playerMediaIdentity(participantId: string, connectionId: string) {
  return `${participantId}~${connectionId}`;
}

export const emptyPlayerMedia: PlayerMediaState = {
  camera: false,
  microphone: false,
  source: null,
};

export function parsePlayerMediaSource(value: unknown): PlayerMediaSource | null {
  if (!value || typeof value !== "object" || !("kind" in value) || !("url" in value)) return null;
  if (!["embed", "video", "audio"].includes(String(value.kind)) || typeof value.url !== "string")
    return null;
  try {
    const url = new URL(value.url.trim());
    if (url.href.length > 2048 || url.protocol !== "https:" || url.username || url.password)
      return null;
    if (isVdoNinja(url) && (!url.searchParams.get("view") || url.searchParams.has("push")))
      return null;
    return { kind: value.kind as PlayerMediaSource["kind"], url: url.href };
  } catch {
    return null;
  }
}

export function isVdoNinja(url: URL): boolean {
  return ["vdo.ninja", "www.vdo.ninja", "obs.ninja", "www.obs.ninja"].includes(url.hostname);
}

export function parsePlayerMediaState(value: unknown): PlayerMediaState | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("camera" in value) ||
    !("microphone" in value) ||
    !("source" in value)
  )
    return null;
  if (typeof value.camera !== "boolean" || typeof value.microphone !== "boolean") return null;
  const source = value.source === null ? null : parsePlayerMediaSource(value.source);
  if (value.source !== null && !source) return null;
  // An external broadcast replaces the built-in capture rather than transmitting twice.
  if (source && (value.camera || value.microphone)) return null;
  return { camera: value.camera, microphone: value.microphone, source };
}
