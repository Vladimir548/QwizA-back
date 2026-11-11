export type MediaKind = "image" | "video" | "audio";
export interface MediaRef {
  id: string;
  kind: MediaKind;
  durationSeconds?: number;
}
export interface GeoPoint {
  lat: number;
  lng: number;
}
export interface ImagePoint {
  x: number;
  y: number;
}
export interface ComparisonOption {
  id: string;
  label: string;
  amount: number;
  media?: MediaRef;
}
export interface MatchingPair {
  element: string;
  fact: string;
  media?: MediaRef;
}
export interface WorkshopQuestion {
  id: string;
  type:
    | "text"
    | "choice"
    | "geo"
    | "image-point"
    | "comparison"
    | "numeric-closest"
    | "puzzle"
    | "spot-difference"
    | "matching"
    | "video-prediction";
  answerMode: "buzzer" | "everyone";
  answerTimeSeconds: number;
  value: number;
  promptText: string;
  questionMedia?: MediaRef;
  answerText: string;
  acceptedAnswers: string[];
  answerMedia?: MediaRef;
  choices: string[];
  correctChoiceIndex: number | null;
  geoMapMode?: "world" | "image";
  geoMapMedia?: MediaRef;
  geoTarget?: GeoPoint;
  geoToleranceKm?: number;
  imageTarget?: ImagePoint;
  imageTolerancePercent?: number;
  comparisonUnit?: string;
  comparisonOptions?: ComparisonOption[];
  numericTarget?: number;
  numericUnit?: string;
  puzzleGridSize?: number;
  differenceMedia?: MediaRef;
  differenceTargets?: ImagePoint[];
  differenceTolerancePercent?: number;
  matchingPairs?: MatchingPair[];
  videoStopSeconds?: number;
}
export interface WorkshopTopic {
  isFinal?: boolean;
  id: string;
  roundIndex: number;
  title: string;
  ordered: boolean;
  direction: "forward" | "reverse";
  questions: WorkshopQuestion[];
}
export interface WorkshopPack {
  id: string;
  title: string;
  description: string;
  published: boolean;
  status?: "draft" | "pending" | "approved" | "rejected";
  revision?: number;
  author?: { id: string; name: string };
  isOfficial?: boolean;
  cover?: MediaRef;
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  rounds: string[];
  topics: WorkshopTopic[];
  createdAt: string;
  updatedAt: string;
}
